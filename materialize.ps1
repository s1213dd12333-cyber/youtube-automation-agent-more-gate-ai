$ErrorActionPreference = 'Stop'

git submodule update --init --recursive
Push-Location upstream
try {
    git reset --hard 260d7a94ab2d5bb2a98ce6620bfda7efd56ebd6b
    git clean -fd
    git apply -p2 ../bootstrap/01-env-readme.patch
    git apply -p2 ../bootstrap/02-providers.patch
    git apply -p2 ../bootstrap/03-setup.patch
    node --check utils/ai-text-service.js
    node --check utils/credential-manager.js
    node --check walkthrough.js
    Write-Host 'AgentTube materializado com NVIDIA NIM, GroqCloud e Cerebras.' -ForegroundColor Green
} finally {
    Pop-Location
}
