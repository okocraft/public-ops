"""Deterministic fake GitHub API tests; these never publish actual releases."""

import hashlib
import sys
import tempfile
import unittest
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "core"))

from discovery import prepare
from publish import publish
from request import ReleaseError, ReleaseRequest

SHA = "b" * 40


class FakeGitHub:
    def __init__(self):
        self.tags = {}
        self.release = None
        self.assets = {}
        self.next_id = 100
        self.actions = []

    def call(self, method, path, body=None, *, upload=False):
        self.actions.append((method, path, upload))
        root = "/repos/okocraft/Yaminabe"
        if (method, path) == ("GET", root):
            return {"full_name": "okocraft/Yaminabe"}
        if method == "GET" and path == f"{root}/git/commits/{SHA}":
            return {"sha": SHA}
        if method == "GET" and path.startswith(f"{root}/git/ref/tags/"):
            tag = urllib.parse.unquote(path.rsplit("/", 1)[1])
            return {"object": {"type": "commit", "sha": self.tags[tag]}} if tag in self.tags else None
        if method == "POST" and path == f"{root}/git/refs":
            self.tags[body["ref"].split("/")[-1]] = body["sha"]
            return {"ref": body["ref"]}
        if method == "GET" and path.startswith(f"{root}/releases/tags/"):
            return self.release
        if method == "POST" and path == f"{root}/releases":
            self.release = {"id": 7, "draft": True, "html_url": "https://github.com/okocraft/Yaminabe/releases/tag/v0.1.0"}
            return self.release
        if method == "PATCH" and path == f"{root}/releases/7":
            self.release["draft"] = body["draft"]
            return self.release
        if method == "GET" and path == f"{root}/releases/7/assets?per_page=100":
            return list(self.assets.values())
        if method == "POST" and path.startswith(f"{root}/releases/7/assets?name="):
            name = urllib.parse.unquote(path.split("name=", 1)[1])
            self.assets[name] = {
                "name": name,
                "state": "uploaded",
                "size": len(body),
                "digest": "sha256:" + hashlib.sha256(body).hexdigest(),
            }
            return self.assets[name]
        raise AssertionError(f"Unexpected GitHub API request: {method} {path}")


class PublishingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        source = root / "source"
        source.mkdir()
        (source / "gradlew").write_text("#!/bin/sh\n")
        (source / "build.gradle.kts").write_text("plugins {}\n")
        (source / "gradle.properties").write_text("version=0.1.0\n")
        import zipfile
        destination = source / "build" / "libs" / "Yaminabe-Paper-0.1.0.jar"
        destination.parent.mkdir(parents=True)
        with zipfile.ZipFile(destination, "w") as jar:
            jar.writestr("paper-plugin.yml", "name: Yaminabe\nversion: 0.1.0\n")
        request = ReleaseRequest.parse({
            "schema_version": 1,
            "repository": "okocraft/Yaminabe",
            "version": "0.1.0",
            "target_sha": SHA,
        })
        self.bundle = root / "bundle"
        self.manifest = prepare(source, request, self.bundle)
        self.fake = FakeGitHub()

    def test_success_publishes_after_uploading_all_assets(self):
        url = publish(self.bundle, self.fake)
        self.assertEqual(url, "https://github.com/okocraft/Yaminabe/releases/tag/v0.1.0")
        self.assertEqual(self.fake.tags["v0.1.0"], SHA)
        self.assertFalse(self.fake.release["draft"])
        self.assertEqual(set(self.fake.assets), {"Yaminabe-Paper-0.1.0.jar", "checksums.txt"})
        paths = [path for method, path, _ in self.fake.actions if method == "PATCH"]
        self.assertEqual(paths, ["/repos/okocraft/Yaminabe/releases/7"])

    def test_wrong_existing_tag_is_rejected_before_any_mutation(self):
        self.fake.tags["v0.1.0"] = "a" * 40
        with self.assertRaisesRegex(ReleaseError, "different commit"):
            publish(self.bundle, self.fake)
        self.assertFalse(any(method != "GET" for method, _, _ in self.fake.actions))

    def test_already_published_release_is_never_overwritten(self):
        self.fake.tags["v0.1.0"] = SHA
        self.fake.release = {"id": 7, "draft": False}
        with self.assertRaisesRegex(ReleaseError, "already published"):
            publish(self.bundle, self.fake)
        self.assertFalse(any(method != "GET" for method, _, _ in self.fake.actions))

    def test_existing_mismatching_asset_is_rejected(self):
        self.fake.tags["v0.1.0"] = SHA
        self.fake.release = {"id": 7, "draft": True}
        self.fake.assets["Yaminabe-Paper-0.1.0.jar"] = {
            "name": "Yaminabe-Paper-0.1.0.jar",
            "size": 1,
            "state": "uploaded",
            "digest": "sha256:" + "0" * 64,
        }
        with self.assertRaisesRegex(ReleaseError, "differs"):
            publish(self.bundle, self.fake)
        self.assertFalse(any(method in ("PATCH", "POST") for method, _, _ in self.fake.actions))

    def test_matching_draft_can_resume(self):
        self.fake.tags["v0.1.0"] = SHA
        self.fake.release = {"id": 7, "draft": True, "html_url": "https://github.com/okocraft/Yaminabe/releases/tag/v0.1.0"}
        jar = self.manifest["assets"][0]
        self.fake.assets[jar["name"]] = {
            "name": jar["name"], "size": jar["size"],
            "digest": "sha256:" + jar["sha256"], "state": "uploaded",
        }
        publish(self.bundle, self.fake)
        uploaded = [p for m, p, u in self.fake.actions if m == "POST" and u]
        self.assertEqual(len(uploaded), 1)
        self.assertIn("checksums.txt", uploaded[0])

    def test_tampered_bundle_does_not_touch_github(self):
        (self.bundle / "checksums.txt").write_text("not the checksum")
        with self.assertRaises(ReleaseError):
            publish(self.bundle, self.fake)
        self.assertFalse(self.fake.actions)


if __name__ == "__main__":
    unittest.main()
