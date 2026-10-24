"""Strict release request contract. Safe to import in unprivileged or publishing jobs."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

REPOSITORY = re.compile(r"^okocraft/[A-Za-z0-9][A-Za-z0-9._-]*$", re.ASCII)
VERSION = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*))?"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$",
    re.ASCII,
)
SHA = re.compile(r"^[0-9a-f]{40}$", re.ASCII)
ASSET_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.+-]{0,199}$", re.ASCII)


class ReleaseError(ValueError):
    """The release is unsafe or its input is not supported."""


@dataclass(frozen=True)
class ReleaseRequest:
    repository: str
    version: str
    target_sha: str

    @classmethod
    def parse(cls, data: object) -> "ReleaseRequest":
        if not isinstance(data, dict):
            raise ReleaseError("Release request must be a JSON object")
        if set(data) != {"schema_version", "repository", "version", "target_sha"}:
            raise ReleaseError("Release request has missing or unsupported fields")
        if type(data["schema_version"]) is not int or data["schema_version"] != 1:
            raise ReleaseError("Unsupported release request schema version")
        for key, regex, max_length in (
            ("repository", REPOSITORY, 110),
            ("version", VERSION, 100),
            ("target_sha", SHA, 40),
        ):
            value = data[key]
            if not isinstance(value, str) or len(value) > max_length or not regex.fullmatch(value):
                raise ReleaseError(f"Invalid {key}")
        return cls(data["repository"], data["version"], data["target_sha"])

    @classmethod
    def load(cls, path: Path) -> "ReleaseRequest":
        try:
            return cls.parse(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ReleaseError(f"Could not read release request: {exc}") from exc

    def to_dict(self) -> dict:
        return {
            "schema_version": 1,
            "repository": self.repository,
            "version": self.version,
            "target_sha": self.target_sha,
        }


def default_tag(request: ReleaseRequest) -> str:
    """MVP tag convention, until unambiguous tag-history discovery is implemented."""
    return f"v{request.version}"


def is_prerelease(version: str) -> bool:
    """Do not treat platform qualifiers (e.g. -folia-) as prereleases."""
    return bool(re.search(r"(?:^|-)(?:alpha|beta|rc|pre|preview)\.?[0-9]*(?:[.-]|$)", version, re.I))
