"""Unit tests for unprivileged zero-config binary selection."""

import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "core"))

from discovery import check_source_version, discover, prepare, verify_bundle
from request import ReleaseError, ReleaseRequest, is_prerelease


SHA = "a" * 40


def request(version="0.1.0"):
    return ReleaseRequest.parse({
        "schema_version": 1,
        "repository": "okocraft/Yaminabe",
        "version": version,
        "target_sha": SHA,
    })


def jar(path, *, platform="paper", version="0.1.0"):
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("com/example/Plugin.class", b"\xca\xfe\xba\xbe")
        if platform == "paper":
            archive.writestr("paper-plugin.yml", f"name: Plugin\nversion: '{version}'\n")
        elif platform == "velocity":
            archive.writestr("velocity-plugin.json", json.dumps({"id": "plugin", "version": version}))


def gradle(root, *, version="0.1.0", platforms=("paper", "velocity")):
    (root / "gradlew").write_text("#!/bin/sh\n", encoding="utf-8")
    (root / "build.gradle.kts").write_text("plugins {}\n", encoding="utf-8")
    (root / "gradle.properties").write_text(f"version={version}\n", encoding="utf-8")
    (root / "settings.gradle.kts").write_text(
        "\n".join(f'addProject("{platform}")' for platform in platforms), encoding="utf-8"
    )
    for platform in platforms:
        jar(root / "build" / "libs" / f"Yaminabe-{platform.title()}-{version}.jar",
            platform=platform, version=version)


class ReleaseContractTests(unittest.TestCase):
    def test_release_version_formats(self):
        for version in ("1.4", "0.1.0", "6.0.0-rc.4", "4.4-folia-1.20.4"):
            self.assertEqual(request(version).version, version)

    def test_reject_untrusted_fields(self):
        with self.assertRaises(ReleaseError):
            ReleaseRequest.parse({**request().to_dict(), "build_arguments": "rm -rf /"})

    def test_reject_invalid_sha(self):
        with self.assertRaises(ReleaseError):
            ReleaseRequest.parse({**request().to_dict(), "target_sha": "main"})

    def test_qualifier_is_not_automatically_prerelease(self):
        self.assertFalse(is_prerelease("4.4-folia-1.20.4"))
        self.assertTrue(is_prerelease("6.0.0-rc.4"))


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "source"
        self.root.mkdir()
        self.bundle = Path(self.temp.name) / "bundle"

    def test_gradle_multimodule_binary_selection_and_verify(self):
        gradle(self.root)
        jar(self.root / "build" / "libs" / "common-0.1.0.jar", platform="library")
        staged = prepare(self.root, request(), self.bundle)
        self.assertEqual(staged["build_tool"], "gradle")
        self.assertEqual(
            {asset["name"] for asset in staged["assets"]},
            {"Yaminabe-Paper-0.1.0.jar", "Yaminabe-Velocity-0.1.0.jar", "checksums.txt"},
        )
        self.assertEqual(verify_bundle(self.bundle), staged)

    def test_tampered_jar_fails(self):
        gradle(self.root)
        prepare(self.root, request(), self.bundle)
        (self.bundle / "Yaminabe-Paper-0.1.0.jar").write_bytes(b"malicious")
        with self.assertRaisesRegex(ReleaseError, "Asset mismatch"):
            verify_bundle(self.bundle)

    def test_extra_file_fails(self):
        gradle(self.root)
        prepare(self.root, request(), self.bundle)
        (self.bundle / "unexpected.jar").write_bytes(b"extra")
        with self.assertRaisesRegex(ReleaseError, "unexpected"):
            verify_bundle(self.bundle)

    def test_missing_platform_binary_fails(self):
        gradle(self.root)
        (self.root / "build" / "libs" / "Yaminabe-Velocity-0.1.0.jar").unlink()
        with self.assertRaisesRegex(ReleaseError, "Missing expected"):
            prepare(self.root, request(), self.bundle)

    def test_duplicate_platform_fails(self):
        gradle(self.root)
        jar(self.root / "build" / "libs" / "Other-Paper-0.1.0.jar")
        with self.assertRaisesRegex(ReleaseError, "Ambiguous"):
            prepare(self.root, request(), self.bundle)

    def test_bad_metadata_version_fails(self):
        gradle(self.root)
        jar(self.root / "build" / "libs" / "Yaminabe-Paper-0.1.0.jar", version="9.9.9")
        with self.assertRaisesRegex(ReleaseError, "Plugin version mismatch"):
            prepare(self.root, request(), self.bundle)

    def test_snapshot_source_fails(self):
        gradle(self.root, version="0.1.0-SNAPSHOT")
        with self.assertRaises(ReleaseError):
            check_source_version(self.root, request("0.1.0-SNAPSHOT"))

    def test_maven_plugin_jar(self):
        (self.root / "pom.xml").write_text(
            '<project xmlns="http://maven.apache.org/POM/4.0.0">'
            '<version>1.4</version></project>', encoding="utf-8"
        )
        jar(self.root / "target" / "Hugs-1.4.jar", platform="paper", version="1.4")
        result = prepare(self.root, request("1.4"), self.bundle)
        self.assertEqual(result["build_tool"], "maven")
        self.assertEqual(result["assets"][0]["name"], "Hugs-1.4.jar")
        verify_bundle(self.bundle)

    def test_mixed_build_tools_fail_closed(self):
        gradle(self.root)
        (self.root / "pom.xml").write_text("<project/>", encoding="utf-8")
        with self.assertRaisesRegex(ReleaseError, "Exactly one"):
            prepare(self.root, request(), self.bundle)

    def test_no_distribution_fails_closed(self):
        gradle(self.root, platforms=("paper",))
        (self.root / "build" / "libs" / "Yaminabe-Paper-0.1.0.jar").unlink()
        with self.assertRaisesRegex(ReleaseError, "No distributable"):
            prepare(self.root, request(), self.bundle)

    def test_reused_output_directory_is_rejected(self):
        gradle(self.root)
        self.bundle.mkdir()
        with self.assertRaisesRegex(ReleaseError, "must not already exist"):
            prepare(self.root, request(), self.bundle)


if __name__ == "__main__":
    unittest.main()
