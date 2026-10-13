# motion-forge memory

Real, persistent improvement — not retraining. The skill learns by storing **validated conclusions** and recalling the
relevant ones at the start of each job.

Where: `$MF_HOME` (default `~/.claude/motion-forge/`) — `lessons.jsonl`, `preferences.json`, `env.json` (preflight cache),
`evals-latest.json`. This folder only holds `lessons.seed.jsonl`, copied into the store on first use, so reinstalling the
skill never wipes what was learned.

## Lifecycle

```
FAILURE → ROOT CAUSE → FIX → VERIFICATION (gate re-run passes) → REGRESSION CHECK (if cheap) → GENERALIZED LESSON → STORE
```

- `lessons.mjs add --category … --symptom … --root-cause … --fix … --verification "<command/evidence>" --reuse "<when>"`
  → `validated`. Without `--verification` → `candidate` (never recalled by default; pruned after 60 days unused).
- Near-duplicates (token Jaccard > 0.6, same category) merge on `add`: hits +1, confidence +0.05, version +1.
- `recall "<brief words>"` ranks validated lessons by relevance × confidence × reuse − age; returns ≤ 5 one-liners.
- `hit <id>` after a lesson actually helped; `obsolete <id> --reason` when tooling/versions make it wrong (kept for audit, never recalled).
- `prune` merges duplicates, drops stale candidates, keeps ≤ 30 obsolete records and caps live lessons (default 150, lowest score first).

Never store: chain-of-thought, guesses, failed experiments, one-off hacks, project secrets, client copy.
Scope lessons honestly: `general`, `project:<name>`, `template:<id>`.

## Preferences

`lessons.mjs pref set <key> <value> --explicit` — only for standing preferences the user stated ("I always want slower
pacing", "never use serif"). One brief's choices are project requirements, not preferences. `pref get` at job start.

## Taxonomy

Categories: render · timing · easing · typography · composition · color · threejs · webgl · gsap · performance ·
export · audio · assets · qa · workflow · creative. Issue codes used by the scripts are listed in `references/qa.md`.
