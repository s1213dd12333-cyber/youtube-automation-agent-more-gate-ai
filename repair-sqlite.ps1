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

    $ignoreScripts = (npm config get ignore-scripts).Trim()
    if ($ignoreScripts -eq 'true') {
        Write-Host 'ignore-scripts=true detectado; desabilitando no projeto.' -ForegroundColor Yellow
        npm config set ignore-scripts false --location=project
    }

    Write-Host 'Aprovando lifecycle scripts do sqlite3...' -ForegroundColor Cyan
    npm install-scripts approve sqlite3

    Write-Host 'Reconstruindo sqlite3 com logs visiveis...' -ForegroundColor Cyan
    npm rebuild sqlite3 --foreground-scripts

    Write-Host 'Validando binding nativo...' -ForegroundColor Cyan
    node -e "const sqlite3=require('sqlite3'); console.log('sqlite3 OK:', sqlite3.VERSION || 'loaded')"

    Write-Host 'sqlite3 reparado com sucesso.' -ForegroundColor Green
} finally {
    Pop-Location
}
