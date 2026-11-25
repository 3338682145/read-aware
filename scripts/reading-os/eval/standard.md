# Reading OS knowledge compiler gate

Baseline records, site-independent model snapshot, sources, and rubrics are fixed in the first commit. The old Python, Git, and Rust records measure rule behavior. They are not used as prompts or scored as model output.

The development slice uses the cross_val_score docstring in scikit-learn 1.3.2 and 1.4.2. The held-out fixture is a different document, Decision Threshold Tuning in 1.6.1. Its gold was written before the compiler and must not be loaded by the generation process. This is a small task-authored holdout. It is neither a secret post-merge benchmark nor independent human annotation.

Each target is one expected assertion with a normalized value, accepted source span, and semantic criteria. A model output is correct only when all three match. Reject invented or duplicate target IDs before a write. Empty/missing outputs count against recall. Unsupported claims, wrong values, and wrong evidence count as precision failures. Report raw counts. A static rules pass does not satisfy the model gate.

Pass criteria for this pilot are all four development targets and at least three of four held-out targets correct, with no unbound accepted evidence, no silent overwrite, and no partial write on invalid output. The demo must commit real SQLite records, attach second-edition evidence to an unchanged assertion, preserve the old scope on changed content, and leave counts unchanged on replay. The holdout uses one run with the frozen seed, apart from the upstream one-shot retry when the structured schema is invalid. An output adjusted on the holdout would require a new holdout.

Targets are reader questions. Source text is supplied as bounded excerpts with span IDs. Gold values and criteria are read only by the scoring command. The developer reviews each generated claim against the actual selected passage. Programmatic scoring checks values and anchors separately from that review.
