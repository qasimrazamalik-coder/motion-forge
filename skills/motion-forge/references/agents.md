# Agents, model tiers, context contracts

Subagents are installed to `~/.claude/agents/` by `install.sh` (preflight shows which exist). If missing, do the work
yourself — never block on an agent.

## Routing

| Agent | Tier (model) | Trigger | Purpose | Never for |
|---|---|---|---|---|
| mf-scout | FAST (haiku) | L3–4, or repo > ~50 files, or unknown asset dirs | inventory repo/assets/deps/tooling via scripts; report constraints | design decisions |
| mf-reference-analyst | STANDARD (sonnet) | user supplied reference images/videos | CreativeFingerprint: transferable principles, not copies | implementation |
| mf-engineer | STANDARD (sonnet) | scoped implementation: one scene/shader/system; parallel independent scenes; mechanical refactors | build/fix code to a written contract; run stills for its scope | art direction |
| mf-visual-critic | STANDARD (sonnet) → MAX (opus) on escalation | L3–4 finals, or when unsure about quality | skeptical scorecard from rendered frames | writing code |
| mf-perf-auditor | STANDARD (sonnet) | interactive/hero targets, or perf gate fails | measured ranked findings | offline-only work |
| mf-tech-qa | FAST (haiku) | a gate failed with many issues / long logs | triage reports → root causes, smallest fixes | creative judgement |
| mf-critic-lite | FAST (haiku) | every contact sheet on L2+, before any sonnet/opus critique | one-glance defect screen → CLEAN / DEFECTS / UNSURE | taste, code |
| mf-editor | STANDARD (sonnet) | Reels/TikTok/Shorts edit from footage + transcript | hook line, 3 hook titles, emphasis words, style → command lines | rendering, UI work |
| mf-nle-operator | STANDARD (sonnet), computer use | UI-only steps in Resolve / Premiere / CapCut after export-nle | exact step list under an action budget; verify by the exported file | edit decisions, anything a file or script can do |
| mf-prompt-coach | FAST (haiku) | brief scores < ~70 on `prompt-coach.mjs`, or the user wants better prompts | complete brief + 3 intent variants + provider-ready asset prompts | building, rendering |
| mf-auditor | STANDARD (sonnet) | "how can this be better", pre-delivery review, third-party videos | measured audit + ranked fix-now / level-up plan with verify commands | editing files |
| mf-asset-producer | FAST (haiku) | ≥ 2 generated assets (images, plates, VO, SFX, music) | runs assets.mjs under a cost cap, checks files, returns provenance | art direction, prompt invention |
| mf-sound-designer | FAST (haiku) | the piece needs a soundtrack and the mood is decided | cues + bed + ducking + −14 LUFS master + stems | picture changes |
| mf-runner | FAST (haiku) | ≥ 3 mechanical steps: stills/renders/variants/batch/golden/evals runs, exact copy/colour/timing edits | execute, read reports, return a ≤150-word verdict | decisions, debugging, design |

MAX tier (opus, or pass `model: "opus"` on the Agent call) only for: high-level creative direction on L4, novel motion
systems, difficult shader/rendering bugs after two failed fixes, design-vs-engineering arbitration, final creative
verdict on flagship work. The Master Director (main session) inherits the user's model.

## Token economics: when to delegate

A subagent costs a fixed overhead (its own system prompt + re-reading the files it needs, ~5–15k tokens) but returns
only its summary. So:

| Task | Do it yourself | Delegate |
|---|---|---|
| 1–2 tool calls, tiny output (one stills run, a one-line fix) | ✓ | |
| ≥ 3 mechanical steps, or output you won't need verbatim (render batches, variants × aspects, golden runs, evals) | | mf-runner (haiku) |
| many issues / long logs to triage | | mf-tech-qa (haiku) |
| independent scenes or systems to build | | mf-engineer (sonnet), in parallel |
| judging rendered frames on L3–4 | | mf-visual-critic |
| planning a social edit from a transcript | | mf-editor (sonnet), then mf-runner runs it |
| vague brief (prompt-coach < 70) | ask ≤ 2 questions yourself if it's quick | mf-prompt-coach (haiku) |
| "is this good / how to improve it" on an existing piece | | mf-auditor (sonnet) |
| several AI/procedural assets to generate | | mf-asset-producer (haiku) |
| soundtrack: cues, bed, ducking, mastering | | mf-sound-designer (haiku) |
| clicking through an editing app (CapCut assembly, Resolve subtitles) | | mf-nle-operator, with a step list + budget |

Keep your own context lean as well:
- Read `contact-sheet.png`, not individual frames. Open one full frame only to check a specific doubt. Use `--thumb 320` for quick checks: half the image tokens.
- Render output is already compact. For details, read only the fields you need from the report JSON, e.g. `node -e 'console.log(require("./out/frames/report.json").issues.map(i=>i.code+" "+i.el))'`. Never cat whole reports.
- References: load only the section you need (`grep -n "^## " references/x.md`, then Read with offset/limit).
- `lessons.mjs recall` returns 5 by default; use `--limit 3` on L1–2.
- Never paste file contents into a delegation; pass paths.
- Name a recipe instead of a command list: `recipes.mjs check|draft|final|formats|debug|layers|nle <comp>` (mf-runner understands "recipe final on <path>").
- Digest reports with `report.mjs <report.json>` (one line + worst 5). Load reference sections with `refs.mjs <file> <section>`.
- Critique ladder: mf-critic-lite (haiku) screens the sheet → escalate to mf-visual-critic (sonnet) only on DEFECTS/UNSURE or L3–4 finals → MAX only per the rules below.
- Prompt caching: SKILL.md, references and agent prompts are static, so keep them that way and put per-task details (paths, brief excerpt) at the END of delegations. Repeated sessions and parallel agents then reuse the cached prefix.

## Escalation (start cheap)

Escalate one tier only if: confidence low · a validation gate still fails after 2 reasonable fixes · the decision has
big architectural consequences · the visual judgement is genuinely hard · the graphics problem needs deeper reasoning.
Never escalate because a task *sounds* sophisticated. Never spawn agents for L1.

## Delegation contract (send exactly this, nothing else)

```
OBJECTIVE: <one sentence>
RELEVANT CONTEXT: <MotionSpec excerpt / decision already made — max ~15 lines>
RELEVANT FILES: <paths>  (workers read files themselves; never paste file contents)
CONSTRAINTS: <tokens, palette, timing, do-not-touch list, determinism rules>
EXPECTED OUTPUT: Finding / Evidence / Recommended action / Confidence   (≤ ~400 words; large outputs → write a file, return its path)
STOP CONDITION: <when to return>
```

Parallelize only independent work (e.g. two scenes in separate files; scout + reference analysis). Sequential when one
depends on another's output. Don't pass the conversation; don't ask workers to restate the brief or narrate reasoning.
