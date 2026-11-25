#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 2 || ( "$1" != development && "$1" != held-out ) ]]; then
  echo "Usage: bash scripts/reading-os/demo.sh {development|held-out} <new-output-directory>" >&2
  exit 2
fi
stage=$1
out=$2
mkdir -p "$out"
database="$out/$stage.sqlite"
if [[ -e "$database" ]]; then
  echo "Use a fresh output directory for a live evaluation." >&2
  exit 2
fi

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
python3 "$here/eval/freeze.py"
python3 - "$here/eval" "$out/sources" "$stage" <<'PY'
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

eval_dir, destination, stage = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
fixtures = ("crossval-132", "crossval-142") if stage == "development" else ("threshold-161",)
destination.mkdir(parents=True, exist_ok=True)
for fixture in fixtures:
    spec = json.loads((eval_dir / f"{fixture}.json").read_text())
    path = destination / f"{fixture}.txt"
    if not path.exists():
        with urllib.request.urlopen(spec["url"], timeout=30) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != spec["sha256"]:
            raise SystemExit(f"Source hash mismatch: {fixture}")
        path.write_bytes(data)
PY

compile() {
  bun "$here/run.ts" compile "$database" "$1" "$out/sources" > "$out/$2.json"
}
if [[ "$stage" == development ]]; then
  compile crossval-132 crossval-132
  compile crossval-142 crossval-142
  compile crossval-142 replay
else
  compile threshold-161 threshold-161
fi
bun "$here/run.ts" inspect "$database" > "$out/$stage-store.json"
echo "Model artifacts and SQLite store: $out"
