$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$upstream = Join-Path $repoRoot 'upstream'

if (-not (Test-Path $upstream)) {
    throw "Pasta upstream nao encontrada. Execute .\materialize.ps1 primeiro."
}

Push-Location $upstream
try {
    Write-Host "Node: $(node -v)" -ForegroundColor Cyan
    Write-Host "npm:  $(npm -v)" -ForegroundColor Cyan

    npm pkg set "dependencies.sqlite3=^6.0.1"

    if (Test-Path 'node_modules\sqlite3') {
        Remove-Item 'node_modules\sqlite3' -Recurse -Force
    }

    if (Test-Path 'package-lock.json') {
        npm install
    } else {
        npm install
    }

    node -e "const sqlite3=require('sqlite3'); console.log('sqlite3 OK:', sqlite3.VERSION || 'loaded')"
    Write-Host 'sqlite3 reparado com sucesso.' -ForegroundColor Green
} finally {
    Pop-Location
}
