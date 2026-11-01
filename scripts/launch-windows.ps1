# Starts the Mix Cutter server in the background (if it isn't already running)
# and opens the app in the default browser. Used by the Windows shortcut.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

$Port = 4317
$envFile = Join-Path $Root '.env'
if (Test-Path $envFile) {
  $line = Get-Content $envFile | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -Last 1
  if ($line) { $Port = ($line -split '=', 2)[1].Trim().Trim('"', "'") }
}
$Url = "http://localhost:$Port"
$LogDir = Join-Path $env:LOCALAPPDATA 'Mix Cutter'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Show-Error($msg) {
  (New-Object -ComObject WScript.Shell).Popup($msg, 0, 'Mix Cutter', 16) | Out-Null
}
function Test-Running {
  try { Invoke-WebRequest "$Url/api/info" -UseBasicParsing -TimeoutSec 1 | Out-Null; return $true } catch { return $false }
}

if (-not (Test-Running)) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Show-Error 'Node.js is not installed. Install it from https://nodejs.org and try again.'; exit 1
  }
  if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Show-Error 'ffmpeg is not installed. Install it (for example: winget install Gyan.FFmpeg) and try again.'; exit 1
  }
  if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm install' -WorkingDirectory $Root -WindowStyle Hidden -Wait
  }
  Start-Process -FilePath 'node' -ArgumentList 'server/index.js' -WorkingDirectory $Root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $LogDir 'mix-cutter.log') -RedirectStandardError (Join-Path $LogDir 'mix-cutter-error.log')
  for ($i = 0; $i -lt 60 -and -not (Test-Running); $i++) { Start-Sleep -Milliseconds 250 }
  if (-not (Test-Running)) {
    Show-Error "Mix Cutter didn't start. See the logs in $LogDir"; exit 1
  }
}

Start-Process $Url
