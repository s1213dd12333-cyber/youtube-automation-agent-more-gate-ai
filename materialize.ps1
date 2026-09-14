$ErrorActionPreference = 'Stop'

git submodule update --init --recursive
Push-Location upstream
try {
    git reset --hard 260d7a94ab2d5bb2a98ce6620bfda7efd56ebd6b
    git clean -fd
} finally {
    Pop-Location
}

node .\bootstrap\materialize.js

Push-Location upstream
try {
    # npm 11+ can block dependency install scripts unless explicitly approved.
    # sqlite3 requires its install script to download/build the native binding.
    npm pkg set "allowScripts.sqlite3=true" --json

    node --check utils/ai-text-service.js
    node --check utils/credential-manager.js
    node --check walkthrough.js
    node --check ..\bootstrap\materialize.js
    Write-Host 'AgentTube materializado com NVIDIA NIM, GroqCloud, Cerebras e sqlite3 compatível com Node 24.' -ForegroundColor Green
    Write-Host 'sqlite3 install scripts approved for this project.' -ForegroundColor Green
    Write-Host 'Execute: npm install' -ForegroundColor Cyan
} finally {
    Pop-Location
}
