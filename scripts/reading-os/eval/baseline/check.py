#!/usr/bin/env python3
"""Run model-free fixture comparisons against immutable upstream source bytes."""
import argparse
import hashlib
import json
import re
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def read_json(name):
    return json.loads((ROOT / name).read_text(encoding="utf-8"))


def verified_sources(manifest, cache, fetch):
    cache.mkdir(parents=True, exist_ok=True)
    texts = {}
    for source in manifest:
        sid = source["id"]
        path = cache / f"{sid}.txt"
        if not path.is_file() and fetch:
            with urllib.request.urlopen(source["raw_url"], timeout=30) as response:
                data = response.read()
        elif path.is_file():
            data = path.read_bytes()
        else:
            raise SystemExit(f"Missing {sid}. Supply --fetch or a populated --cache.")
        if hashlib.sha256(data).hexdigest() != source["sha256"]:
            raise SystemExit(f"Source SHA-256 mismatch: {sid}")
        if not path.is_file():
            path.write_bytes(data)
        texts[sid] = data.decode("utf-8")
    return texts


def normalized(text):
    return re.sub(r"\s+", "", unicodedata.normalize("NFC", text).casefold())


def counts(predicted, expected):
    tp = sum(p and e for p, e in zip(predicted, expected, strict=True))
    fp = sum(p and not e for p, e in zip(predicted, expected, strict=True))
    fn = sum(not p and e for p, e in zip(predicted, expected, strict=True))
    tn = sum(not p and not e for p, e in zip(predicted, expected, strict=True))
    return {
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": round(tp / (tp + fp), 4) if tp + fp else None,
        "recall": round(tp / (tp + fn), 4) if tp + fn else None,
        "f1": round(2 * tp / (2 * tp + fp + fn), 4) if 2 * tp + fp + fn else None,
    }


def compare_dedup(cases, atoms):
    expected, literal, slot, scope = [], [], [], []
    for case in cases:
        a, b = atoms[case["left"]], atoms[case["right"]]
        text_a = case.get("comparison_text", a["claim_zh"])
        text_b = case.get("variant", b["claim_zh"])
        same_slot = (a["entity_id"], a["slot"]) == (b["entity_id"], b["slot"])
        expected.append(case["expected"] == "merge_evidence")
        literal.append(normalized(text_a) == normalized(text_b))
        slot.append(same_slot)
        scope.append(same_slot and a["label"] == case.get("variant_polarity", b["label"]))
    return {
        "NFC_casefold_literal": counts(literal, expected),
        "labeled_entity_and_slot": counts(slot, expected),
        "plus_labeled_polarity": counts(scope, expected),
    }


def compare_citations(cases, atoms, sources, texts):
    expected, global_quote, source_quote, line_and_scope = [], [], [], []
    for case in cases:
        wanted = atoms[case["claim"]]
        given = atoms[case["provided"]]
        sid = case.get("source_override", given["source_id"])
        quote = case.get("quote_override", given["locator"]["quote"])
        line = case.get("line_override", given["locator"]["line"] + case.get("line_delta", 0))
        original_hash = sources[given["source_id"]]["sha256"]
        claimed_hash = case.get("hash_override", original_hash)
        lines = texts[sid].splitlines()
        authorized_evidence = case["provided"] == wanted["id"] or case.get("alternative_evidence", False)
        expected.append(case["expect"])
        global_quote.append(any(quote in text for text in texts.values()))
        source_quote.append(quote in texts[sid])
        line_and_scope.append(
            bool(case.get("visible", True))
            and authorized_evidence
            and sid == given["source_id"]
            and claimed_hash == sources[sid]["sha256"]
            and line == given["locator"]["line"]
            and 1 <= line <= len(lines)
            and quote in lines[line - 1]
        )
    return {
        "whole_corpus_literal": counts(global_quote, expected),
        "cited_document_literal": counts(source_quote, expected),
        "hash_line_visible_and_approved_span": counts(line_and_scope, expected),
    }


def update_gate(events, use_scope):
    if events.get("source_hash_mismatch"):
        return "reject"
    if "current_revision" in events and events["previous_revision"] != events["current_revision"]:
        return "retry_rebase"
    if events.get("same_run"):
        return "noop"
    if events.get("source_revoked"):
        return "recompute_support"
    if events.get("verified_supersession"):
        return "supersede_keep_history"
    if use_scope and (events.get("disjoint_scope") or events.get("different_condition")):
        return "keep_scoped"
    if events.get("same_scope_contradiction") or events.get("disjoint_scope") or events.get("different_condition"):
        return "review_conflict"
    if events.get("equivalent"):
        return "append_evidence"
    return "add_atom"


def score_updates(cases, use_scope):
    misses = [case["id"] for case in cases if update_gate(case["input"], use_scope) != case["expected"]]
    return {"exact": len(cases) - len(misses), "total": len(cases), "misses": misses}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=ROOT / "source-cache")
    parser.add_argument("--fetch", action="store_true", help="Download missing pinned public documents")
    parser.add_argument("--emit-inputs", type=Path, help="Write extraction inputs as JSONL, without gold claims or exact gold lines")
    args = parser.parse_args()
    manifest = read_json("sources.json")
    sources = {source["id"]: source for source in manifest}
    atoms = {atom["id"]: atom for atom in read_json("atoms.json")}
    cases = read_json("cases.json")
    texts = verified_sources(manifest, args.cache, args.fetch)
    for atom in atoms.values():
        line = atom["locator"]["line"]
        assert atom["locator"]["quote"] in texts[atom["source_id"]].splitlines()[line - 1], atom["id"]
    if args.emit_inputs:
        with args.emit_inputs.open("w", encoding="utf-8") as stream:
            for atom in atoms.values():
                sid = atom["source_id"]
                lo, hi = atom["locator"]["context_window"]
                lines = texts[sid].splitlines()
                item = {
                    "id": atom["id"], "source_id": sid, "edition": sources[sid]["edition"],
                    "split": atom["split"], "source_start_line": lo,
                    "passage": "\n".join(lines[lo - 1:hi]),
                }
                stream.write(json.dumps(item, ensure_ascii=False) + "\n")
    for collection in cases.values():
        assert len({case["id"] for case in collection}) == len(collection)
        for case in collection:
            assert all(aid in atoms for aid in case.get("evidence", [])), case["id"]
    print(json.dumps({
        "verified_source_files": len(sources),
        "verified_gold_anchor_locations": len(atoms),
        "fixture_counts": {"gold_atoms": len(atoms), **{key: len(value) for key, value in cases.items()}},
        "dedup": compare_dedup(cases["dedup"], atoms),
        "citations": compare_citations(cases["citations"], atoms, sources, texts),
        "update": {key: score_updates(cases["updates"], scope) for key, scope in (("no_scope", False), ("with_scope", True))},
        "limits": "Controlled fixtures. Manually assigned entity/slot/polarity, permitted spans and update features. No model or storage ran. No measured human learning effect."
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
