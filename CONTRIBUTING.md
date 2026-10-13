# Contributing a template

Templates are the fastest way to grow motion-forge. Each featured template ships with a demo in the gallery.

1. `node skills/motion-forge/scripts/scaffold.mjs base my-template` and build your composition. Keep visuals a pure function of `t` (see `references/rendering.md`).
2. Content goes in `data.json` and is read with `MF.data()`. Colours and fonts come from `--mf-*` variables, so brand kits and `directions.mjs` work.
3. Add `templates/<name>/template.json`: `{ "summary": "…", "defaults": { "width", "height", "fps", "duration", "title" } }`.
4. It must pass: `render.mjs index.html --stills auto --score` with no HIGH or CRITICAL issues, plus the determinism check.
5. Add a case to `scripts/run-evals.mjs` (copy a G-case) and a ≤ 1 MB demo GIF at `docs/<name>.gif`.
6. Open a PR with a contact sheet. Original work only: no copied brand assets, characters or fonts without an embedding licence.
