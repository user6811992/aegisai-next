# AegisAI (next) Windows build script
# Requires: Inno Setup 6 (on PATH, or a standard per-user/machine-wide install)
# Usage: .\installer\build.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$IssFile = Join-Path $PSScriptRoot "aegisai-next.iss"

Write-Host "Building AegisAI (next) Windows installer..." -ForegroundColor Cyan

# Find ISCC: PATH first, then common per-user and machine-wide install locations.
$iscc = Get-Command iscc -ErrorAction SilentlyContinue
if (-not $iscc) {
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            $iscc = Get-Command $candidate -ErrorAction SilentlyContinue
            if ($iscc) { break }
        }
    }
}
if (-not $iscc) {
    Write-Error "Inno Setup 6 not found. Install from https://jrsoftware.org/isinfo.php"
    exit 1
}

# Keep the installer version in sync with package.json (no manual bump needed).
$packageJson = Join-Path $Root "package.json"
$appVersion = (Get-Content $packageJson -Raw | ConvertFrom-Json).version
if (-not $appVersion) { Write-Error "Could not read version from $packageJson"; exit 1 }
Write-Host "Version: $appVersion" -ForegroundColor Cyan

Push-Location $Root
& $iscc.Path $IssFile "/DMyAppVersion=$appVersion"
$compileExit = $LASTEXITCODE
Pop-Location
if ($compileExit -ne 0) {
    Write-Error "Inno Setup compilation failed (exit code $compileExit)"
    exit $compileExit
}

Write-Host "Done. Installer in installer\output\ (version $appVersion)" -ForegroundColor Green
