# Reading OS knowledge compiler prototype

This prototype runs from the ReadAware v0.6.12 worktree. It shares ReadAware's Pi provider registry, custom OpenAI transport, structured one-shot inference, and inference receipts. Its CLI uses versioned source files and a dedicated Bun SQLite database. It does not require a model key or send the documents to a cloud service. The reader UI, Tauri plugin storage and CFI binding are outside this headless prototype. The evidence links point to exact lines in authenticated-by-hash upstream documents.

## Freeze and test

Install the existing workspace dependencies with Bun 1.4.4. The upstream lockfile fixes Pi AI and Pi Agent Core at 1.5.0.

```sh
bun install --frozen-lockfile
python3 scripts/reading-os/eval/freeze.py --replay --fetch --cache .eval/reading-os-source-cache
bun test scripts/reading-os/compiler.test.ts
(cd scripts/reading-os && python3 -B -m unittest test_score.py)
bun run typecheck:repo
```

## Run the demo

The sources are fetched and checked against the frozen manifests. The two development inputs use the actual scikit-learn cross_val_score docstring. The held-out input uses the separate decision-threshold guide. Label files are only read by the scoring command.

Start llama.cpp b7400 with the pinned Qwen3-4B-Instruct-2507 Q4_K_M GGUF. Compare the downloaded archives and weights with the SHA-256 values in [model-v2.json](eval/model-v2.json) before running the server. [llama.cpp release](https://github.com/ggml-org/llama.cpp/releases/tag/b7400) · [Qwen weights](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/tree/a06e946bb6b655725eafa393f4a9745d460374c9)

```sh
llama-server -m /path/to/Qwen3-4B-Instruct-2507-Q4_K_M.gguf \
  --alias reading-os-qwen3-4b --host 127.0.0.1 --port 18883 \
  --threads 8 --ctx-size 4096 --parallel 1
```

In a separate terminal, use new output directories for live runs.

```sh
bash scripts/reading-os/demo.sh development .eval/reading-os-dev
bun scripts/reading-os/run.ts inspect .eval/reading-os-dev/development.sqlite
python3 scripts/reading-os/score.py .eval/reading-os-dev/crossval-142.json
bash scripts/reading-os/demo.sh held-out .eval/reading-os-blind
python3 scripts/reading-os/score.py .eval/reading-os-blind/threshold-161.json
```

The development demo compiles both releases and replays the newer one. An inspected database should show one canonical metric-limit atom, two supporting observations and both scoped group argument values. Replay performs no inference or writes. Wrong or external evidence IDs are rejected before any knowledge writes. Schema, evidence, type validation and semantic review are separate.

To complete scoring, inspect each claim and its exact source range, write a review with `fixtureId`, `claimsSha256` from the scorer output, and `semanticPass` mapping the target IDs to booleans. Run the scorer with `--review <file>`. It verifies that the review is tied to those claims. [Pilot gate and review rubric](eval/standard.md)
