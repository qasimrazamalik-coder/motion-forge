#!/usr/bin/env bash
# motion-forge installer: copies the skill + subagents into Claude Code's user scope and runs preflight.
#   ./install.sh                 install/update  (~/.claude/skills/motion-forge, ~/.claude/agents/mf-*.md)
#   ./install.sh --with-hook     also register the optional PostToolUse QA hook in ~/.claude/settings.json
#   ./install.sh --uninstall     remove skill, agents and hook (keeps learned lessons in ~/.claude/motion-forge)
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
DEST="$CLAUDE_DIR/skills/motion-forge"
AGENTS="$CLAUDE_DIR/agents"
SETTINGS="$CLAUDE_DIR/settings.json"
hook_cmd="node \"$DEST/scripts/hook-check.mjs\""

edit_settings() { # $1 = add|remove
  node - "$SETTINGS" "$1" "$hook_cmd" <<'JS'
const fs = require("fs"); const [file, mode, cmd] = process.argv.slice(2);
let s = {}; try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
s.hooks = s.hooks || {}; let list = s.hooks.PostToolUse || [];
list = list.filter((m) => !(m.hooks || []).some((h) => String(h.command || "").includes("motion-forge/scripts/hook-check.mjs")));
if (mode === "add") list.push({ matcher: "Edit|Write|MultiEdit", hooks: [{ type: "command", command: cmd, timeout: 150 }] });
if (list.length) s.hooks.PostToolUse = list; else delete s.hooks.PostToolUse;
if (!Object.keys(s.hooks).length) delete s.hooks;
fs.mkdirSync(require("path").dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
JS
}

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -rf "$DEST"; rm -f "$AGENTS"/mf-*.md; [[ -f "$SETTINGS" ]] && edit_settings remove
  echo "motion-forge removed (lessons kept in $CLAUDE_DIR/motion-forge)"; exit 0
fi

command -v node >/dev/null || { echo "node >= 18 required"; exit 1; }
[[ "$SRC" == "$DEST" ]] || { mkdir -p "$DEST"; rm -rf "$DEST"/*; cp -R "$SRC"/. "$DEST"/; }
mkdir -p "$AGENTS"; cp "$SRC"/agents/mf-*.md "$AGENTS"/
chmod +x "$DEST"/scripts/*.mjs "$DEST"/install.sh 2>/dev/null || true
echo "installed skill  → $DEST"
echo "installed agents → $AGENTS/mf-*.md ($(ls "$SRC"/agents/mf-*.md | wc -l | tr -d ' '))"
if [[ "${1:-}" == "--with-hook" ]]; then edit_settings add; echo "registered PostToolUse QA hook in $SETTINGS (disable with MF_HOOK=0)"; fi
echo; node "$DEST/scripts/preflight.mjs" --fresh || echo "(preflight DEGRADED — see MISSING above; stills/video need ffmpeg + playwright chromium)"
echo; echo "Use it:  /motion-forge <brief>     Self-test:  node $DEST/scripts/run-evals.mjs"
