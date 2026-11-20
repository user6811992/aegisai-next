# AegisAI (next) Windows build script
# Requires: Inno Setup 6 (iscc.exe on PATH)
# Usage: .\installer\build.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$IssFile = Join-Path $PSScriptRoot "aegisai-next.iss"

Write-Host "Building AegisAI (next) Windows installer..." -ForegroundColor Cyan

# Check for Inno Setup
$iscc = Get-Command iscc -ErrorAction SilentlyContinue
if (-not $iscc) {
    $iscc = Get-Command "C:\Program Files (x86)\Inno Setup 6\iscc.exe" -ErrorAction SilentlyContinue
}
if (-not $iscc) {
    Write-Error "Inno Setup 6 not found. Install from https://jrsoftware.org/isinfo.php"
    exit 1
}

Push-Location $Root
& $iscc.Path $IssFile
Pop-Location

Write-Host "Done. Installer in installer\output\" -ForegroundColor Green
