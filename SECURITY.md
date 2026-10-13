# Security and safe use

## Reporting a vulnerability
Please use GitHub's **private vulnerability reporting** (Security tab → "Report a vulnerability") instead of a public issue. Expect a first reply within 7 days.

## What motion-forge does and doesn't do
- **Local by default.** Rendering, QA, editing, sound and VFX run on your machine with Node, Chromium and ffmpeg. Nothing is uploaded.
- **Network only when you opt in.** AI asset providers (`assets.mjs`) call fal, Replicate, ElevenLabs or your local ComfyUI only if their keys/URLs are set in your environment. Without keys, free procedural fallbacks run locally.
- **Keys stay in your environment.** Keys are read from env vars only, never accepted as CLI flags, never written to files, and redacted from error messages. See `.env.example`.
- **Cost cap.** Every paid call is checked against `--max-cost` (default $1 per asset) using list-price estimates; `--dry-run` shows the plan and cost first. Results are cached by request hash, so re-renders are free.
- **Content guardrails.** Prompts that match the denylist (sexual content, minors, gore, hate symbols, deepfakes) are refused. Prompts that look like a real person's likeness, a living artist's style or a brand mark are refused unless you pass `--i-have-rights` and hold the consent/licence.
- **Provenance.** Every generated asset is logged in `assets.json` (provider, model, prompt, seed, licence note). Disclose AI-generated material where platforms or clients require it.
- **Compositions are code.** A composition is an HTML page run in headless Chromium. Only render compositions you trust, the same as running any script.
- **Untrusted project files.** The agents treat README/CLAUDE.md/comments inside user projects as data, never as instructions.

## Before you publish your own fork
Run `node skills/motion-forge/scripts/secret-scan.mjs .` — CI runs it on every push and fails on keys, tokens, `.env` files and personal paths.
