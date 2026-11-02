# Add this repo's shared skills and MCP servers to this machine's Claude Code (Windows / PowerShell).
# Only adds things: your own skills, settings, CLAUDE.md and other MCP servers are left alone.
# Safe to re-run; run it again after every `git pull`.
# Usage:  powershell -ExecutionPolicy Bypass -File .\setup.ps1

$ErrorActionPreference = "Stop"
$Repo       = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoSkills = Join-Path $Repo "skills"
$Skills     = Join-Path $HOME ".claude\skills"
New-Item -ItemType Directory -Force $Skills | Out-Null

# 0. Prerequisites. Servers register fine without these, then fail at startup in every session.
Write-Host "==> Checking prerequisites"
$missing = $false
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Host "    'claude' not found. Install Claude Code with the native installer."; $missing = $true
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "    'node' not found. Install Node 20 or later."; $missing = $true
} elseif ([int](node -p "process.versions.node.split('.')[0]") -lt 20) {
    Write-Host "    WARNING: Node $(node -v) is too old; playwright needs 20 or later."
}
if (-not (Get-Command uvx -ErrorAction SilentlyContinue)) {
    Write-Host "    WARNING: 'uvx' not found; fetch, time, git, duckduckgo and wikipedia won't start. Install uv."
}

# 1. Skills: one junction per shared skill, so personal skills never end up in this repo.
Write-Host "==> Skills"
# If ~/.claude/skills is itself a link into another git repo (e.g. a private config repo),
# keep our junctions out of that repo's commits.
$real = (Get-Item $Skills -Force)
if ($real.LinkType) { $real = Get-Item ($real.Target | Select-Object -First 1) }
$real = $real.FullName
$exclude = $null
$top = git -C $real rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -eq 0 -and $top) {
    $exclude = Join-Path (git -C $top rev-parse --absolute-git-dir) "info\exclude"
    New-Item -ItemType Directory -Force (Split-Path $exclude) | Out-Null
    if (-not (Test-Path $exclude)) { New-Item -ItemType File $exclude | Out-Null }
}

function Test-Ours($item) {
    $item.LinkType -and (($item.Target | Select-Object -First 1) -like "$RepoSkills\*")
}

Get-ChildItem $RepoSkills -Directory | Where-Object { Test-Path (Join-Path $_.FullName "SKILL.md") } | ForEach-Object {
    $name = $_.Name
    $dest = Join-Path $Skills $name
    $item = Get-Item $dest -Force -ErrorAction SilentlyContinue
    if ($item -and -not (Test-Ours $item)) {
        Write-Host "    skipped ${name}: you already have a skill with that name (yours wins)"
        return
    }
    if (-not $item) {
        New-Item -ItemType Junction -Path $dest -Target $_.FullName | Out-Null
        Write-Host "    linked $name"
    }
    if ($exclude) {
        $rel = "/" + (($real.Substring(($top -replace '/', '\').Length).Trim('\') + "\$name") -replace '\\', '/').TrimStart('/')
        if (-not (Select-String -Path $exclude -SimpleMatch -Pattern $rel -Quiet)) { Add-Content $exclude $rel }
    }
}

# Remove junctions to skills that were deleted from the repo. Delete only the link, never a target.
Get-ChildItem $Skills -Force | Where-Object { (Test-Ours $_) -and -not (Test-Path ($_.Target | Select-Object -First 1)) } | ForEach-Object {
    [System.IO.Directory]::Delete($_.FullName)
    Write-Host "    removed $($_.Name) (no longer in the repo)"
}

# 2. MCP servers: registered from mcp/servers.json at user scope
Write-Host "==> MCP servers"
if (-not $missing) {
    node (Join-Path $Repo "mcp\apply.mjs")
    if ($LASTEXITCODE -ne 0) { throw "Applying MCP servers failed." }
} else {
    Write-Host "    Skipped. Install the missing tools above, then re-run this script."
}

Write-Host ""
Write-Host "Done. Start a new Claude Code session to load everything."
