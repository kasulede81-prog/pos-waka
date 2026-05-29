# From project root:  .\cap.ps1 open android  → full build + sync + Studio
Set-Location $PSScriptRoot
if ($args.Count -ge 2 -and $args[0] -eq "open" -and $args[1] -eq "android") {
  node "$PSScriptRoot\scripts\android-open.mjs"
  exit $LASTEXITCODE
}
& "$PSScriptRoot\node_modules\.bin\cap.ps1" @args
