#!/usr/bin/env python3
"""CLI for unprivileged staging and separately authorized publication."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from discovery import prepare, verify_bundle
from publish import publish_with_environment
from request import ReleaseError, ReleaseRequest


def main() -> int:
    parser = argparse.ArgumentParser(description="OKOCRAFT GitHub Release core")
    sub = parser.add_subparsers(dest="command", required=True)
    validate = sub.add_parser("validate-request")
    validate.add_argument("--request", type=Path, required=True)
    stage = sub.add_parser("prepare")
    stage.add_argument("--request", type=Path, required=True)
    stage.add_argument("--workspace", type=Path, required=True)
    stage.add_argument("--bundle", type=Path, required=True)
    verify = sub.add_parser("verify-bundle")
    verify.add_argument("--bundle", type=Path, required=True)
    release = sub.add_parser("publish")
    release.add_argument("--bundle", type=Path, required=True)
    args = parser.parse_args()

    try:
        if args.command == "validate-request":
            print(json.dumps(ReleaseRequest.load(args.request).to_dict(), indent=2))
        elif args.command == "prepare":
            request = ReleaseRequest.load(args.request)
            head = subprocess.run(
                ["git", "-C", str(args.workspace), "rev-parse", "HEAD"],
                text=True, capture_output=True, check=True,
            ).stdout.strip()
            if head != request.target_sha:
                raise ReleaseError("Checked out commit does not match release request")
            print(json.dumps(prepare(args.workspace, request, args.bundle), indent=2))
        elif args.command == "verify-bundle":
            print(json.dumps(verify_bundle(args.bundle), indent=2))
        elif args.command == "publish":
            print(publish_with_environment(args.bundle))
    except (ReleaseError, subprocess.CalledProcessError, OSError) as exc:
        print(f"releaser: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
