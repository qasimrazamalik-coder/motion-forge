# motion-forge installer for Windows PowerShell (mirrors install.sh).
#   .\install.ps1               install/update  (%USERPROFILE%\.claude\skills\motion-forge, agents\mf-*.md)
#   .\install.ps1 -WithHook     also register the optional PostToolUse QA hook
#   .\install.ps1 -Uninstall    remove skill, agents and hook (keeps learned lessons)
param([switch]$WithHook, [switch]$Uninstall)
$ErrorActionPreference = "Stop"
$Src = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClaudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE ".claude" }
$Dest = Join-Path $ClaudeDir "skills\motion-forge"
$Agents = Join-Path $ClaudeDir "agents"
$Settings = Join-Path $ClaudeDir "settings.json"
$HookCmd = "node `"$Dest\scripts\hook-check.mjs`""

function Edit-Settings([string]$Mode) {
  $js = @'
const fs = require("fs"); const [file, mode, cmd] = process.argv.slice(2);
let s = {}; try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
s.hooks = s.hooks || {}; let list = s.hooks.PostToolUse || [];
list = list.filter((m) => !(m.hooks || []).some((h) => String(h.command || "").includes("hook-check.mjs")));
if (mode === "add") list.push({ matcher: "Edit|Write|MultiEdit", hooks: [{ type: "command", command: cmd, timeout: 150 }] });
if (list.length) s.hooks.PostToolUse = list; else delete s.hooks.PostToolUse;
if (!Object.keys(s.hooks).length) delete s.hooks;
fs.mkdirSync(require("path").dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
'@
  node -e $js $Settings $Mode $HookCmd
}

if ($Uninstall) {
  if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
  Get-ChildItem -Path $Agents -Filter "mf-*.md" -ErrorAction SilentlyContinue | Remove-Item -Force
  if (Test-Path $Settings) { Edit-Settings "remove" }
  Write-Host "motion-forge removed (lessons kept in $ClaudeDir\motion-forge)"; exit 0
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error "node >= 18 required"; exit 1 }
if ((Resolve-Path $Src).Path -ne $Dest) {
  if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  Copy-Item -Recurse -Force (Join-Path $Src "*") $Dest
}
New-Item -ItemType Directory -Force -Path $Agents | Out-Null
Copy-Item -Force (Join-Path $Src "agents\mf-*.md") $Agents
Write-Host "installed skill  -> $Dest"
Write-Host "installed agents -> $Agents\mf-*.md"
if ($WithHook) { Edit-Settings "add"; Write-Host "registered PostToolUse QA hook in $Settings (disable with `$env:MF_HOOK=0)" }
node "$Dest\scripts\preflight.mjs" --fresh
Write-Host "`nUse it:  /motion-forge <brief>     Self-test:  node `"$Dest\scripts\run-evals.mjs`""
