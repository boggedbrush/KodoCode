# Prompt enhance

Checks the shipped Enhance prompt and the Codex text generation path on synthetic drafts. Run from `evals/` with a configured Codex login:

```sh
pnpm prompt-enhance --model <model> --out runs/enhance
pnpm prompt-enhance --model <model> --out runs/enhance-new --baseline runs/enhance/results.json
```

Use `--case <id> --samples 1` for a smoke run. By default seven cases (code, ask, plan and review modes) run three times each (twenty-one short model calls). `results.json` carries one hard check, `droppedReferences`, which must be 0: the app refuses a rewrite that loses a context link, @mention or $skill. Read `review.json` against each rubric before opening the answer key. Add cases to `cases.ts` when a real rewrite goes wrong.
