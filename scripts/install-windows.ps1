# Creates "Mix Cutter" shortcuts (Start Menu + Desktop) with the Mix Cutter icon.
# Usage: npm run install-app
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Launcher = Join-Path $Root 'scripts\launch-windows.ps1'
$Icon = Join-Path $Root 'assets\icon.ico'
$Shell = New-Object -ComObject WScript.Shell

$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Mix Cutter.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Mix Cutter.lnk')
)
foreach ($path in $targets) {
  $s = $Shell.CreateShortcut($path)
  $s.TargetPath = 'powershell.exe'
  $s.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Launcher`""
  $s.WorkingDirectory = $Root
  $s.IconLocation = "$Icon,0"
  $s.Description = 'Cut band practice recordings into songs'
  $s.WindowStyle = 7  # minimized
  $s.Save()
  Write-Host "Created: $path"
}
Write-Host 'Open Mix Cutter from the Start Menu or Desktop. Right-click it > Pin to taskbar to keep it handy.'
