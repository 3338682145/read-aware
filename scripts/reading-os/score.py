#!/usr/bin/env python3
"""Score model artifacts against frozen gold and a claim-specific semantic review."""
import argparse
import hashlib
import json
from pathlib import Path

EVAL = Path(__file__).resolve().parent / "eval"


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def fingerprint(claims):
    payload = json.dumps(claims, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode()).hexdigest()


def score(actual, gold, semantic_pass):
    by_id = {claim["targetId"]: claim for claim in actual}
    if len(by_id) != len(actual):
        raise ValueError("Duplicate claim IDs in model artifact")
    outcomes = {}
    value_and_anchor = 0
    for expected in gold:
        target = expected["targetId"]
        claim = by_id.pop(target, None)
        if claim is None:
            outcomes[target] = "missing"
        elif claim["value"] != expected["value"] or claim["evidence"]["spanId"] != expected["evidenceId"]:
            outcomes[target] = "value-or-anchor-failure"
        else:
            value_and_anchor += 1
            semantic = semantic_pass.get(target)
            outcomes[target] = (
                "pending-semantic-review" if semantic is None else ("correct" if semantic else "semantic-failure")
            )
    outcomes.update(dict.fromkeys(by_id, "unexpected"))
    correct = sum(x == "correct" for x in outcomes.values())
    return {
        "expected": len(gold),
        "submitted": len(actual),
        "correct": correct,
        "valueAndAnchorCorrect": value_and_anchor,
        "precision": correct / len(actual) if actual else 0,
        "recall": correct / len(gold),
        "outcomes": outcomes,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path)
    parser.add_argument("--review", type=Path)
    args = parser.parse_args()
    run = load(args.artifact)
    fixture = run["fixtureId"]
    if run["replayed"] or not run["attempts"]:
        raise SystemExit("Scoring requires a fresh inference artifact")
    review = load(args.review) if args.review else {}
    claims = run["claims"]
    digest = fingerprint(claims)
    if args.review and (review["fixtureId"] != fixture or review["claimsSha256"] != digest):
        raise SystemExit("Semantic review does not describe this model artifact")
    gold = (
        load(EVAL / "held-out/gold.json")["scored"]
        if fixture == "threshold-161"
        else load(EVAL / "development-gold.json")[fixture]
    )
    result = score(claims, gold, review.get("semanticPass", {}))
    threshold = 3 if fixture == "threshold-161" else len(gold)
    gate = result["correct"] >= threshold and "pending-semantic-review" not in result["outcomes"].values()
    print(json.dumps({
        "fixtureId": fixture, "claimsSha256": digest, "gatePassed": gate, **result,
    }, indent=2))
    if args.review and not gate:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
