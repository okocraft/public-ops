"""Zero-config discovery. Run only in a read-only, unprivileged build job."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from request import ASSET_NAME, ReleaseError, ReleaseRequest, default_tag

MAX_ASSET_BYTES = 256 * 1024 * 1024
MAX_ASSETS = 20
IGNORED_SUFFIXES = ("-plain.jar", "-sources.jar", "-javadoc.jar", "-tests.jar", "-test.jar")


def build_tool(workspace: Path) -> str:
    gradle = (
        (workspace / "gradlew").is_file()
        and any((workspace / x).is_file() for x in ("build.gradle", "build.gradle.kts"))
    )
    maven = (workspace / "pom.xml").is_file()
    if gradle == maven:
        raise ReleaseError("Exactly one Gradle or Maven project must be detected")
    return "gradle" if gradle else "maven"


def _gradle_version(workspace: Path) -> str:
    file = workspace / "gradle.properties"
    if not file.is_file():
        raise ReleaseError("Gradle project version in gradle.properties not found")
    values = [
        line.split("=", 1)[1].strip()
        for line in file.read_text(encoding="utf-8").splitlines()
        if re.match(r"^\s*version\s*=", line)
    ]
    if len(values) != 1 or not values[0]:
        raise ReleaseError("Expected one unambiguous version in gradle.properties")
    return values[0]


def _maven_version(workspace: Path) -> str:
    try:
        root = ET.parse(workspace / "pom.xml").getroot()
    except (ET.ParseError, OSError) as exc:
        raise ReleaseError("Cannot read Maven pom.xml") from exc
    ns = {"m": "http://maven.apache.org/POM/4.0.0"}
    version = root.findtext("m:version", namespaces=ns)
    if version is None:
        version = root.findtext("m:parent/m:version", namespaces=ns)
    if not version or "{" in version or "}" in version:
        raise ReleaseError("Maven version must be unambiguously resolved")
    return version.strip()


def check_source_version(workspace: Path, request: ReleaseRequest) -> str:
    tool = build_tool(workspace)
    version = _gradle_version(workspace) if tool == "gradle" else _maven_version(workspace)
    if version != request.version:
        raise ReleaseError(f"Source version {version!r} differs from requested version")
    if "SNAPSHOT" in version.upper():
        raise ReleaseError("Snapshot versions cannot be published")
    return tool


def _metadata_version(jar: Path) -> tuple[str, str] | None:
    try:
        with zipfile.ZipFile(jar) as archive:
            bad = archive.testzip()
            if bad is not None:
                raise ReleaseError(f"Corrupt JAR entry in {jar.name}: {bad}")
            names = set(archive.namelist())
            if "velocity-plugin.json" in names:
                metadata = json.loads(archive.read("velocity-plugin.json"))
                if not isinstance(metadata, dict) or not isinstance(metadata.get("version"), str):
                    raise ReleaseError(f"Invalid Velocity plugin metadata in {jar.name}")
                return "velocity", metadata["version"]
            for filename in ("paper-plugin.yml", "plugin.yml"):
                if filename in names:
                    data = archive.read(filename).decode("utf-8")
                    match = re.search(
                        r"^\s*version\s*:\s*['\"]?([^'\"#\s]+)", data, re.MULTILINE
                    )
                    if not match:
                        raise ReleaseError(f"Missing plugin version in {jar.name}")
                    return "paper", match.group(1)
    except (OSError, zipfile.BadZipFile, UnicodeError, json.JSONDecodeError) as exc:
        raise ReleaseError(f"Invalid JAR {jar.name}: {exc}") from exc
    return None


def _paths(workspace: Path, tool: str) -> list[Path]:
    if tool == "gradle":
        return sorted((workspace / "build" / "libs").glob("*.jar"))
    return sorted((workspace / "target").glob("*.jar")) + sorted(workspace.glob("*/target/*.jar"))


def _expected_platforms(workspace: Path, tool: str) -> set[str]:
    if tool != "gradle":
        return set()
    settings = next(
        (workspace / n for n in ("settings.gradle.kts", "settings.gradle") if (workspace / n).is_file()),
        None,
    )
    if settings is None:
        return set()
    text = settings.read_text(encoding="utf-8")
    expected = set()
    for platform in ("paper", "velocity"):
        if re.search(rf'(?:addProject|include)\(\s*"[^"]*{platform}[^"]*"\s*\)', text):
            expected.add(platform)
    return expected


def discover(workspace: Path, request: ReleaseRequest, tool: str) -> list[Path]:
    candidates: list[Path] = []
    found_platforms: set[str] = set()
    root = workspace.resolve(strict=True)
    for jar in _paths(workspace, tool):
        if any(jar.name.endswith(suffix) for suffix in IGNORED_SUFFIXES):
            continue
        if jar.is_symlink() or not jar.is_file() or not jar.resolve().is_relative_to(root):
            raise ReleaseError(f"Unsafe release candidate: {jar}")
        if not ASSET_NAME.fullmatch(jar.name):
            raise ReleaseError(f"Unsafe JAR basename: {jar.name}")
        size = jar.stat().st_size
        if size == 0 or size > MAX_ASSET_BYTES:
            raise ReleaseError(f"Empty or oversized release candidate: {jar.name}")
        metadata = _metadata_version(jar)
        if metadata is None:
            continue  # Library, sources, test fixture or other non-plugin JAR.
        platform, version = metadata
        if version != request.version:
            raise ReleaseError(f"Plugin version mismatch in {jar.name}: {version!r}")
        found_platforms.add(platform)
        candidates.append(jar)
    if not candidates:
        raise ReleaseError("No distributable plugin JARs found")
    expected = _expected_platforms(workspace, tool)
    if expected and expected != found_platforms:
        raise ReleaseError(f"Missing expected platform binaries: {sorted(expected - found_platforms)}")
    if len(candidates) > MAX_ASSETS:
        raise ReleaseError("Too many release assets")
    names = [p.name.lower() for p in candidates]
    if len(names) != len(set(names)):
        raise ReleaseError("Colliding release asset basenames")
    if len(found_platforms) != len(candidates):
        raise ReleaseError("Ambiguous: multiple binaries claim the same plugin platform")
    return candidates


def _sha256(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def prepare(workspace: Path, request: ReleaseRequest, bundle: Path) -> dict:
    """Inspect and stage exact binaries; must execute without write credentials."""
    if bundle.exists():
        raise ReleaseError("Release bundle directory must not already exist")
    if workspace.resolve() == bundle.resolve():
        raise ReleaseError("Bundle cannot be the source workspace")
    tool = check_source_version(workspace, request)
    jars = discover(workspace, request, tool)
    bundle.mkdir(parents=True)
    assets: list[dict] = []
    for jar in jars:
        destination = bundle / jar.name
        shutil.copyfile(jar, destination)
        assets.append({"name": jar.name, "size": destination.stat().st_size, "sha256": _sha256(destination)})
    checksums = "".join(f"{a['sha256']}  {a['name']}\n" for a in assets)
    checksums_path = bundle / "checksums.txt"
    checksums_path.write_text(checksums, encoding="ascii")
    assets.append({
        "name": "checksums.txt",
        "size": checksums_path.stat().st_size,
        "sha256": _sha256(checksums_path),
    })
    manifest = {
        "schema_version": 1,
        **request.to_dict(),
        "tag": default_tag(request),
        "build_tool": tool,
        "assets": assets,
    }
    (bundle / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return manifest


def verify_bundle(bundle: Path) -> dict:
    """Verify staged bytes without checking out or executing target repository code."""
    manifest_path = bundle / "manifest.json"
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise ReleaseError("Missing trusted manifest.json")
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ReleaseError("Invalid manifest.json") from exc
    if not isinstance(data, dict) or set(data) != {
        "schema_version", "repository", "version", "target_sha", "tag", "build_tool", "assets"
    }:
        raise ReleaseError("Invalid manifest fields")
    request = ReleaseRequest.parse(data)
    if data["tag"] != default_tag(request):
        raise ReleaseError("Tag must match the requested version")
    if data["build_tool"] not in ("gradle", "maven"):
        raise ReleaseError("Invalid manifest build tool")
    assets = data["assets"]
    if not isinstance(assets, list) or not 2 <= len(assets) <= MAX_ASSETS + 1:
        raise ReleaseError("Invalid asset count")
    names: list[str] = []
    root = bundle.resolve(strict=True)
    for asset in assets:
        if not isinstance(asset, dict) or set(asset) != {"name", "size", "sha256"}:
            raise ReleaseError("Invalid asset metadata")
        name = asset["name"]
        if not isinstance(name, str) or not ASSET_NAME.fullmatch(name):
            raise ReleaseError("Unsafe asset name")
        if name.lower() in names:
            raise ReleaseError("Duplicate asset name")
        names.append(name.lower())
        size, digest = asset["size"], asset["sha256"]
        if type(size) is not int or size <= 0 or size > MAX_ASSET_BYTES:
            raise ReleaseError(f"Invalid size for {name}")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ReleaseError(f"Invalid digest for {name}")
        path = bundle / name
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):
            raise ReleaseError(f"Missing or unsafe asset: {name}")
        if path.stat().st_size != size or _sha256(path) != digest:
            raise ReleaseError(f"Asset mismatch: {name}")
    if assets[-1]["name"] != "checksums.txt":
        raise ReleaseError("checksums.txt must be the last asset")
    expected = "".join(f"{a['sha256']}  {a['name']}\n" for a in assets[:-1])
    if (bundle / "checksums.txt").read_text(encoding="ascii") != expected:
        raise ReleaseError("Invalid checksum file")
    if {p.name for p in bundle.iterdir()} != {a["name"] for a in assets} | {"manifest.json"}:
        raise ReleaseError("Bundle contains unexpected files")
    return data
