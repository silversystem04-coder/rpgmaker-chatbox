#Requires -Version 5.1
<#
.SYNOPSIS
  Install TT_ChatChoice into a local RPG Maker MV / MZ game (e.g. OMORI).

.DESCRIPTION
  Detects how the game loads plugins and installs accordingly:

  A) Normal MV/MZ game  ->  copy the plugin into <js>/plugins/ and append a
     `$plugins.push(...)` line at the END of plugins.js (no regex surgery,
     which previously corrupted files whose parameters contained "];").

  B) Encrypted-plugin game (e.g. OMORI, whose plugin loader maps every name to
     a `.OMORI` file)  ->  plugin entry in plugins.js cannot work; instead inject
     `<script src="js/plugins/TT_ChatChoice.js"></script>` into index.html right
     after rpg_windows.js, and let the plugin self-install its hooks.

  Safe to run twice: if already installed it does nothing.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\install-omori.ps1 -GameDir "C:\Users\Lenovo\Desktop\OMORI-73665\game"
#>
param(
  [Parameter(Mandatory = $true)][string]$GameDir,
  [string]$PluginPath = ""
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $PluginPath) {
  $PluginPath = Join-Path (Split-Path -Parent $here) 'js\plugins\TT_ChatChoice.js'
}

function Fail($msg) {
  Write-Host "[ERROR] $msg" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path -LiteralPath $GameDir)) { Fail "GameDir not found: $GameDir" }
$GameDir = (Resolve-Path -LiteralPath $GameDir).Path
if (-not (Test-Path -LiteralPath $PluginPath)) { Fail "Plugin not found: $PluginPath" }

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$tag = '{"name":"TT_ChatChoice","status":true,"description":"","parameters":{}}'
$scriptTag = '<script src="js/plugins/TT_ChatChoice.js"></script>'

# --- locate js dir: MV = <game>\www\js, MZ = <game>\js
$candidates = @(
  (Join-Path $GameDir 'www\js'),
  (Join-Path $GameDir 'js')
)
$jsDir = $null
foreach ($c in $candidates) {
  if (Test-Path -LiteralPath (Join-Path $c 'plugins.js')) { $jsDir = $c; break }
}
if (-not $jsDir) {
  Fail "plugins.js not found. Pass the game ROOT folder (the one containing www\js\plugins.js)."
}

$webDir = Split-Path -Parent $jsDir
$pluginsJs = Join-Path $jsDir 'plugins.js'
$pluginDir = Join-Path $jsDir 'plugins'
$indexHtml = Join-Path $webDir 'index.html'
if (-not (Test-Path -LiteralPath $pluginDir)) { Fail "plugin folder not found: $pluginDir" }
if (-not (Test-Path -LiteralPath $indexHtml)) { Fail "index.html not found: $indexHtml" }
$targetJs = Join-Path $pluginDir 'TT_ChatChoice.js'

$encrypted = @(Get-ChildItem -LiteralPath $pluginDir -File | Where-Object { $_.Extension -eq '.OMORI' }).Count -gt 0
$mode = if ($encrypted) { 'html-inject' } else { 'plugins-js' }

Write-Host "Game    : $GameDir"
Write-Host "WebRoot : $webDir"
Write-Host "Plugins : $pluginDir"
Write-Host "Loader  : $mode$(if ($encrypted) { '  (encrypted .OMORI plugins detected)' })"

function CopyPlugin() {
  Copy-Item -LiteralPath $PluginPath -Destination $targetJs -Force
  Write-Host "[OK] copied: $targetJs"
}

if ($mode -eq 'html-inject') {
  $html = [System.IO.File]::ReadAllText($indexHtml)
  if ($html -match 'js/plugins/TT_ChatChoice\.js') {
    Write-Host "[SKIP] index.html already references TT_ChatChoice.js" -ForegroundColor Yellow
    if (-not (Test-Path -LiteralPath $targetJs)) { CopyPlugin }
  } else {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = "$indexHtml.bak-$stamp"
    Copy-Item -LiteralPath $indexHtml -Destination $backup -Force
    Write-Host "[OK] backup: $backup"
    CopyPlugin

    # insert after rpg_windows.js; fallback before </body>
    if ($html -match '(?s)(<script[^>]*rpg_windows\.js[^>]*>\s*</script>)') {
      $patched = $html -replace [regex]::Escape($Matches[1]), ($Matches[1] + "`r`n  " + $scriptTag)
    } elseif ($html -match '</body>') {
      $patched = $html -replace '</body>', ("  " + $scriptTag + "`r`n</body>")
    } else {
      Fail "Could not find rpg_windows.js or </body> in index.html. Restore: $backup"
    }
    [System.IO.File]::WriteAllText($indexHtml, $patched, $utf8NoBom)

    $check = [System.IO.File]::ReadAllText($indexHtml)
    if ($check -notmatch 'js/plugins/TT_ChatChoice\.js') { Fail "Patch verification failed. Restore: $backup" }
    Write-Host "[OK] index.html patched (script tag injected)" -ForegroundColor Green
    Write-Host "Restore: copy '$backup' back over index.html"
  }
} else {
  $content = [System.IO.File]::ReadAllText($pluginsJs)
  if ($content -match '"name"\s*:\s*"TT_ChatChoice"') {
    Write-Host "[SKIP] TT_ChatChoice already listed in plugins.js" -ForegroundColor Yellow
    if (-not (Test-Path -LiteralPath $targetJs)) { CopyPlugin }
  } else {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = "$pluginsJs.bak-$stamp"
    Copy-Item -LiteralPath $pluginsJs -Destination $backup -Force
    Write-Host "[OK] backup: $backup"
    CopyPlugin

    # append after the existing $plugins array (no regex rewrite of the array body)
    $append = "`r`n`$plugins.push($tag);`r`n"
    [System.IO.File]::AppendAllText($pluginsJs, $append, $utf8NoBom)

    $check = [System.IO.File]::ReadAllText($pluginsJs)
    if ($check -notmatch '"name"\s*:\s*"TT_ChatChoice"') { Fail "Patch verification failed. Restore: $backup" }
    Write-Host "[OK] plugins.js patched (push appended)" -ForegroundColor Green
    Write-Host "Restore: copy '$backup' back over plugins.js"
  }
}

Write-Host ""
Write-Host "Next: launch the game. When a choice appears the chat box should show up."
Write-Host "  F9      toggle plugin"
Write-Host "  Esc     fall back to the original choice"
Write-Host "  F8/F12  console -> TT.VERSION  (should print 0.1.2)"
