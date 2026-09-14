$ErrorActionPreference = 'Stop'

git submodule update --init --recursive
Push-Location upstream
try {
    git reset --hard 260d7a94ab2d5bb2a98ce6620bfda7efd56ebd6b
    git clean -fd
} finally {
    Pop-Location
}

# Apply the deterministic overlay, then focused idempotent runtime fixes.
node .\bootstrap\materialize.js
if ($LASTEXITCODE -ne 0) { throw 'bootstrap/materialize.js failed' }
node .\bootstrap\fix-readiness-nvidia.js
if ($LASTEXITCODE -ne 0) { throw 'bootstrap/fix-readiness-nvidia.js failed' }
node .\bootstrap\fix-strategy-context.js
if ($LASTEXITCODE -ne 0) { throw 'bootstrap/fix-strategy-context.js failed' }

Push-Location upstream
try {
    # npm 11+ can block dependency install scripts unless explicitly approved.
    # sqlite3 requires its install script to download/build the native binding.
    npm pkg set "allowScripts.sqlite3=true" --json
    if ($LASTEXITCODE -ne 0) { throw 'npm pkg set allowScripts.sqlite3 failed' }

    node --check index.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: index.js' }
    node --check utils/ai-text-service.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: utils/ai-text-service.js' }
    node --check utils/credential-manager.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: utils/credential-manager.js' }
    node --check utils/production-readiness-service.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: utils/production-readiness-service.js' }
    node --check walkthrough.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: walkthrough.js' }
    node --check ..\bootstrap\materialize.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: bootstrap/materialize.js' }
    node --check ..\bootstrap\fix-readiness-nvidia.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: bootstrap/fix-readiness-nvidia.js' }
    node --check ..\bootstrap\fix-strategy-context.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: bootstrap/fix-strategy-context.js' }

    Write-Host 'AgentTube materializado com NVIDIA NIM, GroqCloud, Cerebras e sqlite3 compativel com Node 24.' -ForegroundColor Green
    Write-Host 'NVIDIA NIM GPT-OSS configurado para walkthrough e production-readiness.' -ForegroundColor Green
    Write-Host 'Generation strategyContext protegido contra valores null.' -ForegroundColor Green
    Write-Host 'sqlite3 install scripts approved for this project.' -ForegroundColor Green
    Write-Host 'Execute: npm install' -ForegroundColor Cyan
} finally {
    Pop-Location
}
