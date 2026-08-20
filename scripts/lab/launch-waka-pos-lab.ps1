# WAKA POS RS-4D lab launcher. Does not bake transport=lab into the EXE.
# Usage:
#   .\launch-waka-pos-lab.ps1 -PosExe "C:\path\WAKA-POS-Portable-1.0.12.exe" -EnvFile "C:\WAKA\remote-support-lab\waka-lab.env"
param(
  [Parameter(Mandatory = $true)]
  [string]$PosExe,
  [string]$EnvFile = "C:\WAKA\remote-support-lab\waka-lab.env"
)

$ErrorActionPreference = "Stop"
$PublicMarkers = @("rustdesk.com", "rs-ny.rustdesk.com", "rs-sg.rustdesk.com", "rs-cn.rustdesk.com")

function Assert-NotPublicHost([string]$name, [string]$value) {
  $hostValue = ([string]$value).Trim().ToLowerInvariant()
  if (-not $hostValue) { throw "$name is empty" }
  foreach ($marker in $PublicMarkers) {
    if ($hostValue -eq $marker -or $hostValue.EndsWith(".$marker")) {
      throw "$name rejects public RustDesk host: $value"
    }
  }
}

if (-not (Test-Path -LiteralPath $PosExe)) { throw "POS EXE not found: $PosExe" }
if (-not (Test-Path -LiteralPath $EnvFile)) { throw "Lab env file not found: $EnvFile" }

Get-Content -LiteralPath $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#") -or $line -notmatch "=") { return }
  $idx = $line.IndexOf("=")
  $key = $line.Substring(0, $idx).Trim()
  $val = $line.Substring($idx + 1).Trim()
  if ($key) { Set-Item -Path "Env:$key" $val }
}

$transport = ([string]$env:WAKA_REMOTE_SUPPORT_TRANSPORT).Trim().ToLowerInvariant()
if ($transport -ne "lab") {
  throw "Refusing launch: WAKA_REMOTE_SUPPORT_TRANSPORT must be lab (got '$transport'). Default remains off."
}

$labDir = ([string]$env:WAKA_REMOTE_SUPPORT_LAB_DIR).Trim()
if (-not $labDir -or $labDir.Contains("..") -or -not [System.IO.Path]::IsPathRooted($labDir)) {
  throw "WAKA_REMOTE_SUPPORT_LAB_DIR must be an absolute path with no .."
}
if (-not (Test-Path -LiteralPath $labDir)) { throw "Lab dir does not exist: $labDir" }

$exe = ([string]$env:WAKA_RUSTDESK_EXECUTABLE_PATH).Trim()
if (-not $exe) { $exe = Join-Path $labDir "rustdesk.exe" }
$name = [System.IO.Path]::GetFileName($exe).ToLowerInvariant()
if ($name -notin @("rustdesk.exe", "rustdesk")) { throw "Executable filename must be rustdesk.exe or rustdesk" }
if (-not $exe.StartsWith($labDir, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "rustdesk path must be inside WAKA_REMOTE_SUPPORT_LAB_DIR"
}
if (-not (Test-Path -LiteralPath $exe)) { throw "rustdesk.exe not found: $exe" }

Assert-NotPublicHost "WAKA_RUSTDESK_ID_SERVER" $env:WAKA_RUSTDESK_ID_SERVER
$relay = if (([string]$env:WAKA_RUSTDESK_RELAY_SERVER).Trim()) { $env:WAKA_RUSTDESK_RELAY_SERVER } else { $env:WAKA_RUSTDESK_ID_SERVER }
Assert-NotPublicHost "WAKA_RUSTDESK_RELAY_SERVER" $relay
$key = ([string]$env:WAKA_RUSTDESK_KEY).Trim()
if ($key.Length -lt 16 -or $key.StartsWith("REPLACE_")) { throw "WAKA_RUSTDESK_KEY is missing or still a placeholder" }

Write-Host "Launching WAKA POS in lab transport mode"
Write-Host "POS: $PosExe"
Write-Host "Lab dir: $labDir"
Write-Host "RustDesk: $exe"
Start-Process -FilePath $PosExe
