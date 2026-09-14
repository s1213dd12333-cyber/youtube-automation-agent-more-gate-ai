$ErrorActionPreference = 'Stop'

$DarkzSeoCommit = 'a6270c512bb338e8251c363656f93891a9afa671'

git submodule update --init --recursive
Push-Location upstream
try {
    git reset --hard 260d7a94ab2d5bb2a98ce6620bfda7efd56ebd6b
    git clean -fd
} finally {
    Pop-Location
}

# Apply the deterministic overlay, focused runtime fixes, then editorial/production hardening.
node .\bootstrap\materialize.js
if ($LASTEXITCODE -ne 0) { throw 'bootstrap/materialize.js failed' }
node .\bootstrap\fix-readiness-nvidia.js
if ($LASTEXITCODE -ne 0) { throw 'bootstrap/fix-readiness-nvidia.js failed' }
node .\bootstrap\fix-strategy-context.js
if ($LASTEXITCODE -ne 0) { throw 'bootstrap/fix-strategy-context.js failed' }
node .\bootstrap\harden-production.js
if ($LASTEXITCODE -ne 0) { throw 'bootstrap/harden-production.js failed' }
node .\bootstrap\fix-script-shape.js
if ($LASTEXITCODE -ne 0) { throw 'bootstrap/fix-script-shape.js failed' }
node .\bootstrap\fix-production-tts-shape.js
if ($LASTEXITCODE -ne 0) { throw 'bootstrap/fix-production-tts-shape.js failed' }
node .\bootstrap\fix-production-audio-captions.js
if ($LASTEXITCODE -ne 0) { throw 'bootstrap/fix-production-audio-captions.js failed' }
node .\bootstrap\phase1-contracts.js
if ($LASTEXITCODE -ne 0) { throw 'bootstrap/phase1-contracts.js failed' }

# DarkzSEO 1.4 is an optional local advisory engine upstream, but we materialize
# a pinned copy so Review Studio does not depend on a separately installed module.
if (-not (Test-Path .\darkzseo\.git)) {
    git clone https://github.com/darkzOGx/darkzseo.git .\darkzseo
    if ($LASTEXITCODE -ne 0) { throw 'DarkzSEO clone failed' }
}
Push-Location .\darkzseo
try {
    git fetch --quiet origin
    if ($LASTEXITCODE -ne 0) { throw 'DarkzSEO fetch failed' }
    git checkout --quiet $DarkzSeoCommit
    if ($LASTEXITCODE -ne 0) { throw 'DarkzSEO checkout failed' }
} finally {
    Pop-Location
}

python -c "import bs4, colorama"
if ($LASTEXITCODE -ne 0) {
    python -m pip install -r .\darkzseo\requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'DarkzSEO Python dependency install failed' }
}

Push-Location upstream
try {
    # npm 11+ can block dependency install scripts unless explicitly approved.
    # sqlite3 requires its install script to download/build the native binding.
    npm pkg set "allowScripts.sqlite3=true" --json
    if ($LASTEXITCODE -ne 0) { throw 'npm pkg set allowScripts.sqlite3 failed' }

    node --check index.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: index.js' }
    node --check agents/content-strategy-agent.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: agents/content-strategy-agent.js' }
    node --check agents/script-writer-agent.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: agents/script-writer-agent.js' }
    node --check agents/production-management-agent.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: agents/production-management-agent.js' }
    node --check utils/ai-video-generator.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: utils/ai-video-generator.js' }
    node --check utils/operator-service.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: utils/operator-service.js' }
    node --check utils/ai-text-service.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: utils/ai-text-service.js' }
    node --check utils/credential-manager.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: utils/credential-manager.js' }
    node --check utils/production-readiness-service.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: utils/production-readiness-service.js' }
    node --check utils/generation-recovery-service.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: utils/generation-recovery-service.js' }
    node --check utils/content-contracts.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: utils/content-contracts.js' }
    node --check walkthrough.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: walkthrough.js' }
    node --check ..\bootstrap\materialize.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: bootstrap/materialize.js' }
    node --check ..\bootstrap\fix-readiness-nvidia.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: bootstrap/fix-readiness-nvidia.js' }
    node --check ..\bootstrap\fix-strategy-context.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: bootstrap/fix-strategy-context.js' }
    node --check ..\bootstrap\harden-production.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: bootstrap/harden-production.js' }
    node --check ..\bootstrap\fix-script-shape.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: bootstrap/fix-script-shape.js' }
    node --check ..\bootstrap\fix-production-tts-shape.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: bootstrap/fix-production-tts-shape.js' }
    node --check ..\bootstrap\fix-production-audio-captions.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: bootstrap/fix-production-audio-captions.js' }
    node --check ..\bootstrap\phase1-contracts.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: bootstrap/phase1-contracts.js' }
    node --check ..\bootstrap\verify-phase1-contracts.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: bootstrap/verify-phase1-contracts.js' }
    node --check ..\bootstrap\templates\content-contracts.js
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed: bootstrap/templates/content-contracts.js' }

    node ..\bootstrap\verify-phase1-contracts.js
    if ($LASTEXITCODE -ne 0) { throw 'Phase 1 content contract regression checks failed' }

    python ..\darkzseo\darkzseo.py --help *> $null
    if ($LASTEXITCODE -ne 0) { throw 'DarkzSEO 1.4 smoke check failed' }

    Write-Host 'AgentTube materializado com NVIDIA NIM, GroqCloud, Cerebras e sqlite3 compativel com Node 24.' -ForegroundColor Green
    Write-Host 'NVIDIA NIM GPT-OSS configurado para walkthrough e production-readiness.' -ForegroundColor Green
    Write-Host 'Generation strategyContext protegido contra valores null.' -ForegroundColor Green
    Write-Host 'ScriptWriter protegido contra arrays/campos opcionais ausentes nas respostas da IA.' -ForegroundColor Green
    Write-Host 'Production TTS protegido contra variacoes de estrutura do roteiro.' -ForegroundColor Green
    Write-Host 'Gemini TTS longo dividido em chunks e captions protegidas contra conclusion sem recap.' -ForegroundColor Green
    Write-Host 'FASE 1 ativa: Strategy/Script Contracts v1, normalizacao central, validacao e migracao de checkpoints.' -ForegroundColor Green
    Write-Host 'Production hardening ativo: research, provenance, anti-hallucination, local visuals, quota breaker e duplicate guard.' -ForegroundColor Green
    Write-Host 'DarkzSEO 1.4 pinned e validado localmente.' -ForegroundColor Green
    Write-Host 'sqlite3 install scripts approved for this project.' -ForegroundColor Green
    Write-Host 'Execute: npm install' -ForegroundColor Cyan
    Write-Host 'Depois execute: npx playwright install chromium' -ForegroundColor Cyan
} finally {
    Pop-Location
}
