"""Authenticated GitHub publication. Never run code from the target checkout here."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from discovery import verify_bundle
from request import ReleaseError, is_prerelease

API_ROOT = "https://api.github.com"
UPLOAD_ROOT = "https://uploads.github.com"


class GitHubAPI:
    def __init__(self, token: str):
        if not token:
            raise ReleaseError("Missing GH_TOKEN or GITHUB_TOKEN")
        self.token = token

    def call(self, method: str, path: str, body: object = None, *, upload: bool = False) -> object:
        # URLs are constructed exclusively from already validated request fields
        # and numeric IDs returned by GitHub. Do not follow arbitrary upload_url.
        if not path.startswith("/") or "//" in path:
            raise ReleaseError("Invalid GitHub API path")
        root = UPLOAD_ROOT if upload else API_ROOT
        if isinstance(body, bytes):
            content = body
            content_type = "application/octet-stream"
        elif body is not None:
            content = json.dumps(body).encode("utf-8")
            content_type = "application/vnd.github+json"
        else:
            content = None
            content_type = "application/vnd.github+json"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "okocraft-releaser",
            "Content-Type": content_type,
        }
        req = urllib.request.Request(root + path, data=content, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                data = res.read()
                return json.loads(data) if data else {}
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            raise ReleaseError(f"GitHub API {method} failed with HTTP {exc.code}") from exc
        except (OSError, UnicodeError, ValueError) as exc:
            raise ReleaseError(f"GitHub API {method} failed: {type(exc).__name__}") from exc


def _tag_commit(api: GitHubAPI, repo_path: str, tag: str) -> str | None:
    obj = api.call("GET", f"{repo_path}/git/ref/tags/{urllib.parse.quote(tag)}")
    if obj is None:
        return None
    if not isinstance(obj, dict) or not isinstance(obj.get("object"), dict):
        raise ReleaseError("Unexpected GitHub tag reference")
    pointer = obj["object"]
    for _ in range(4):
        if pointer.get("type") == "commit":
            sha = pointer.get("sha")
            if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
                raise ReleaseError("Invalid commit behind tag")
            return sha
        if pointer.get("type") != "tag":
            raise ReleaseError("Unsupported Git tag type")
        annotated = api.call("GET", f"{repo_path}/git/tags/{pointer['sha']}")
        if not isinstance(annotated, dict) or not isinstance(annotated.get("object"), dict):
            raise ReleaseError("Cannot resolve annotated tag")
        pointer = annotated["object"]
    raise ReleaseError("Tag resolution exceeded recursion limit")


def _verify_uploaded(existing: dict, expected: dict) -> None:
    if (
        existing.get("name") != expected["name"]
        or existing.get("state") != "uploaded"
        or existing.get("size") != expected["size"]
        or existing.get("digest") != f"sha256:{expected['sha256']}"
    ):
        raise ReleaseError(f"Release asset differs from checked build: {expected['name']}")


def _assets(api: GitHubAPI, repo_path: str, release_id: int) -> dict[str, dict]:
    response = api.call("GET", f"{repo_path}/releases/{release_id}/assets?per_page=100")
    if not isinstance(response, list):
        raise ReleaseError("Cannot list release assets")
    assets = {}
    for item in response:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str):
            raise ReleaseError("Malformed release asset")
        if item["name"] in assets:
            raise ReleaseError("Duplicate uploaded asset")
        assets[item["name"]] = item
    return assets


def publish(bundle: Path, api: GitHubAPI) -> str:
    """Publish a complete, checked Release or resume a compatible draft.

    Safe to retry. Published releases or mismatched assets are never replaced.
    The caller must hold a per-repository/tag concurrency lock.
    """
    manifest = verify_bundle(bundle)
    repo = manifest["repository"]
    version = manifest["version"]
    sha = manifest["target_sha"]
    tag = manifest["tag"]
    repo_path = f"/repos/{repo}"

    repository = api.call("GET", repo_path)
    if not isinstance(repository, dict) or repository.get("full_name", "").lower() != repo.lower():
        raise ReleaseError("Target repository could not be independently verified")

    commit = api.call("GET", f"{repo_path}/git/commits/{sha}")
    if not isinstance(commit, dict) or commit.get("sha") != sha:
        raise ReleaseError("Requested target commit does not exist")

    current_tag = _tag_commit(api, repo_path, tag)
    if current_tag is not None and current_tag != sha:
        raise ReleaseError(f"Existing tag {tag} points to a different commit")

    release = api.call("GET", f"{repo_path}/releases/tags/{urllib.parse.quote(tag)}")
    if release is not None and (not isinstance(release, dict) or not release.get("draft")):
        raise ReleaseError("The GitHub Release is already published; refusing to overwrite it")

    if current_tag is None:
        api.call("POST", f"{repo_path}/git/refs", {"ref": f"refs/tags/{tag}", "sha": sha})
        if _tag_commit(api, repo_path, tag) != sha:
            raise ReleaseError("Created tag does not resolve to requested commit")

    if release is None:
        release = api.call("POST", f"{repo_path}/releases", {
            "tag_name": tag,
            "target_commitish": sha,
            "name": tag,
            "draft": True,
            "prerelease": is_prerelease(version),
            "generate_release_notes": True,
        })
    if not isinstance(release, dict) or not release.get("draft"):
        raise ReleaseError("Could not create or load a draft Release")
    release_id = release.get("id")
    if type(release_id) is not int or release_id < 1:
        raise ReleaseError("Invalid release ID")

    uploaded = _assets(api, repo_path, release_id)
    expected_names = {asset["name"] for asset in manifest["assets"]}
    if set(uploaded) - expected_names:
        raise ReleaseError("Draft contains unexpected release assets")

    for expected in manifest["assets"]:
        name = expected["name"]
        if name in uploaded:
            _verify_uploaded(uploaded[name], expected)
            continue
        filename = urllib.parse.quote(name, safe="")
        payload = (bundle / name).read_bytes()  # guarded by MAX_ASSET_BYTES and verify_bundle
        created = api.call(
            "POST",
            f"{repo_path}/releases/{release_id}/assets?name={filename}",
            payload,
            upload=True,
        )
        if not isinstance(created, dict):
            raise ReleaseError(f"Asset upload failed: {name}")
        _verify_uploaded(created, expected)

    final_assets = _assets(api, repo_path, release_id)
    if set(final_assets) != expected_names:
        raise ReleaseError("Release assets incomplete")
    for expected in manifest["assets"]:
        _verify_uploaded(final_assets[expected["name"]], expected)

    result = api.call("PATCH", f"{repo_path}/releases/{release_id}", {"draft": False})
    if not isinstance(result, dict) or result.get("draft"):
        raise ReleaseError("GitHub did not publish the Release")
    published = api.call("GET", f"{repo_path}/releases/tags/{urllib.parse.quote(tag)}")
    if not isinstance(published, dict) or published.get("draft"):
        raise ReleaseError("Published Release could not be verified")
    if _tag_commit(api, repo_path, tag) != sha:
        raise ReleaseError("Published tag no longer points to requested commit")
    for expected in manifest["assets"]:
        _verify_uploaded(_assets(api, repo_path, release_id)[expected["name"]], expected)
    url = published.get("html_url")
    if not isinstance(url, str) or not url.startswith(f"https://github.com/{repo}/releases/"):
        raise ReleaseError("Invalid published Release URL")
    return url


def publish_with_environment(bundle: Path) -> str:
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    return publish(bundle, GitHubAPI(token or ""))
