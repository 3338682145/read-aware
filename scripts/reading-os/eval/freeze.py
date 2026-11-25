#!/usr/bin/env python3
"""Validate frozen inputs or reproduce the exploratory rule baseline."""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--replay", action="store_true")
    parser.add_argument("--cache", type=Path, default=ROOT / "source-cache")
    parser.add_argument("--fetch", action="store_true")
    args = parser.parse_args()
    manifest = json.loads((ROOT / "freeze.json").read_text())
    for path, want in manifest["sha256"].items():
        got = hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
        if got != want:
            raise SystemExit(f"Frozen input differs: {path}")
    atoms = json.loads((ROOT / "baseline/atoms.json").read_text())
    cases = json.loads((ROOT / "baseline/cases.json").read_text())
    if len(atoms) != 36 or len(atoms) + sum(map(len, cases.values())) != 120:
        raise SystemExit("Frozen dataset size differs")
    print(f"Frozen: 120 records, 36 anchors, {len(manifest['sha256'])} hashed files")
    if args.replay:
        command = [sys.executable, str(ROOT / "baseline/check.py"), "--cache", str(args.cache)]
        if args.fetch:
            command.append("--fetch")
        result = json.loads(subprocess.check_output(command, text=True))
        expected = json.loads((ROOT / "baseline/results.json").read_text())
        if result != expected:
            raise SystemExit("Baseline rules no longer reproduce the frozen output")
        print("Baseline reproduction is equal to the frozen result")


if __name__ == "__main__":
    main()
