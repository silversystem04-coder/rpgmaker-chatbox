# M3 recording: run OMORI with TT_ChatChoice + M3 driver, capture the screen with ffmpeg,
# then crop the game window out of the desktop capture and upscale to 1280x960.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File video\record_m3_omori.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File video\record_m3_omori.ps1 -GameDir "D:\OMORI\game" -Seconds 16
#
# Requires: OMORI installed with git layout (<game>\www\...), ffmpeg in ..\..\tools\ffmpeg.exe.
# The script temporarily injects m3-driver.js into www\index.html and removes it afterwards.

param(
    [string]$GameDir = "C:\Users\Lenovo\Desktop\OMORI-73665\game",
    [string]$Out = "",
    [int]$Seconds = 16,
    [double]$TrimSec = 12.2,
    [int]$TimeoutSec = 150
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $here
$pluginSrc = Join-Path $repo "js\plugins\TT_ChatChoice.js"
$driverSrc = Join-Path $here "m3_driver.js"
if (-not $Out) { $Out = Join-Path $here "assets\m3_omori.mp4" }
$raw = Join-Path $here "assets\m3_desktop_raw.mp4"
$ffLog = Join-Path $here "assets\m3_ffmpeg.log"

$www = Join-Path $GameDir "www"
$index = Join-Path $www "index.html"
$exe = Join-Path $GameDir "OMORI.exe"
$log = Join-Path $GameDir "m3.log"
$ffmpeg = Join-Path (Split-Path -Parent $repo) "tools\ffmpeg.exe"
if (-not (Test-Path $ffmpeg)) { $ffmpeg = "ffmpeg" }

function Info($msg) { Write-Host "[M3] $msg" }
function Fail($msg) { Write-Host "[M3] ERROR: $msg" -ForegroundColor Red; exit 1 }

# --- window geometry helpers -------------------------------------------------
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class M3Win {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT p);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@ -ErrorAction SilentlyContinue
[void][M3Win]::SetProcessDPIAware()

function Get-ClientRect($proc) {
    $h = $proc.MainWindowHandle
    if ($h -eq [IntPtr]::Zero) { return $null }
    $r = New-Object M3Win+RECT
    if (-not [M3Win]::GetClientRect($h, [ref]$r)) { return $null }
    $p = New-Object M3Win+POINT
    $p.X = 0; $p.Y = 0
    if (-not [M3Win]::ClientToScreen($h, [ref]$p)) { return $null }
    return [pscustomobject]@{ X = $p.X; Y = $p.Y; W = ($r.Right - $r.Left); H = ($r.Bottom - $r.Top) }
}

# --- preflight ---------------------------------------------------------------
if (-not (Test-Path $www)) { Fail "not a git-layout OMORI install: $www missing" }
if (-not (Test-Path $pluginSrc)) { Fail "plugin missing: $pluginSrc" }
if (-not (Test-Path $driverSrc)) { Fail "driver missing: $driverSrc" }
if (-not (Test-Path $exe)) { Fail "OMORI.exe missing: $exe" }
$assets = Split-Path -Parent $Out
if (-not (Test-Path $assets)) { New-Item -ItemType Directory -Force -Path $assets | Out-Null }

# --- deploy plugin + driver --------------------------------------------------
Copy-Item $pluginSrc (Join-Path $www "js\plugins\TT_ChatChoice.js") -Force
Copy-Item $driverSrc (Join-Path $www "m3-driver.js") -Force
Info "plugin + driver deployed"

# --- patch index.html (idempotent, backup once) ------------------------------
$html = Get-Content $index -Raw
if (-not (Test-Path "$index.bak-m3")) { Copy-Item $index "$index.bak-m3" -Force }
$nl = [Environment]::NewLine
$changed = $false
if ($html -notmatch 'TT_ChatChoice\.js') {
    $html = $html.Replace('</body>', ('  <script src="js/plugins/TT_ChatChoice.js"></script>' + $nl + '</body>'))
    $changed = $true
}
if ($html -notmatch 'm3-driver\.js') {
    $html = $html.Replace('</body>', ('  <script src="m3-driver.js"></script>' + $nl + '</body>'))
    $changed = $true
}
if ($changed) { Set-Content -Path $index -Value $html -NoNewline -Encoding UTF8; Info "index.html patched" } else { Info "index.html already patched" }

# --- launch game -------------------------------------------------------------
Get-Process OMORI -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item $log -ErrorAction SilentlyContinue
Remove-Item $raw -ErrorAction SilentlyContinue
Remove-Item $Out -ErrorAction SilentlyContinue
Remove-Item $ffLog -ErrorAction SilentlyContinue
Info "starting game..."
$gameProc = Start-Process -FilePath $exe -WorkingDirectory $GameDir -PassThru

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$ready = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 400
    if (Test-Path $log) {
        $text = Get-Content $log -Raw -ErrorAction SilentlyContinue
        if ($text -and $text -match 'MAP_READY') { $ready = $true; break }
        if ($text -and $text -match 'SETUP_ERR') { Fail ("driver failed: " + $text) }
    }
    if ($gameProc.HasExited) { Fail "OMORI exited early (code $($gameProc.ExitCode))" }
}
if (-not $ready) { Fail "game did not reach map within $TimeoutSec s" }

$gameProc.Refresh()
$rect = Get-ClientRect $gameProc
if (-not $rect) { Fail "cannot read OMORI window rect" }
Info ("game window client rect: x=" + $rect.X + " y=" + $rect.Y + " w=" + $rect.W + " h=" + $rect.H)

[void][M3Win]::ShowWindow($gameProc.MainWindowHandle, 9)
[void][M3Win]::SetForegroundWindow($gameProc.MainWindowHandle)
Start-Sleep -Milliseconds 600
Info "map ready, starting capture"

# --- capture the game window region for $Seconds ----------------------------
$capW = $rect.W - ($rect.W % 2)
$capH = $rect.H - ($rect.H % 2)
$ffArgs = @(
    "-y", "-f", "gdigrab", "-framerate", "30", "-draw_mouse", "0",
    "-video_size", ($capW.ToString() + "x" + $capH.ToString()),
    "-offset_x", "$($rect.X)", "-offset_y", "$($rect.Y)",
    "-i", "desktop",
    "-t", "$Seconds",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p",
    $raw
)
$ffProc = Start-Process -FilePath $ffmpeg -ArgumentList $ffArgs -PassThru -WindowStyle Hidden `
    -RedirectStandardError $ffLog -RedirectStandardOutput (Join-Path $assets "m3_ffmpeg.out")
Info ("capturing " + $Seconds + "s desktop -> " + $raw)

# --- wait for driver timeline ------------------------------------------------
$deadline = (Get-Date).AddSeconds(60)
$done = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 300
    if (Test-Path $log) {
        $text = Get-Content $log -Raw -ErrorAction SilentlyContinue
        if ($text -and $text -match 'DONE') { $done = $true; break }
    }
    if ($ffProc.HasExited) { break }
}

# --- stop game, wait ffmpeg --------------------------------------------------
Get-Process OMORI -ErrorAction SilentlyContinue | Stop-Process -Force
if (-not $ffProc.HasExited) { $ffProc.WaitForExit(30000) | Out-Null }
if (-not $ffProc.HasExited) { $ffProc.Kill(); Info "ffmpeg killed after timeout" }
Info ("driver done=" + $done)

# --- upscale the captured game window to 1280x960 ---------------------------
if (-not (Test-Path $raw)) {
    Fail ("no capture; ffmpeg log: " + (Get-Content $ffLog -Raw -ErrorAction SilentlyContinue))
}
$scale = "scale=1280:960:flags=lanczos"
$oldEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $ffmpeg -y -i $raw -t $TrimSec -vf $scale -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart $Out 2>&1 |
    Select-Object -Last 2 | ForEach-Object { Write-Host "  $_" }
$ErrorActionPreference = $oldEap

# --- cleanup temporary injection, keep the plugin itself --------------------
$html = Get-Content $index -Raw
$html = $html -replace '\s*<script src="m3-driver\.js"></script>', ''
Set-Content -Path $index -Value $html -NoNewline -Encoding UTF8
Remove-Item (Join-Path $www "m3-driver.js") -ErrorAction SilentlyContinue

# --- report ------------------------------------------------------------------
if (Test-Path $log) {
    Info "---- m3.log ----"
    Get-Content $log | ForEach-Object { Write-Host "  $_" }
}
if (Test-Path $Out) {
    $size = [math]::Round((Get-Item $Out).Length / 1024.0, 1)
    Info ("OK " + $Out + " (" + $size + " KB)")
} else {
    Fail "no output video produced"
}
