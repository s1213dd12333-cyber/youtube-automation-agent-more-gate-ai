$ErrorActionPreference = 'Stop'

$DarkzSeoCommit = 'a6270c512bb338e8251c363656f93891a9afa671'
$UpstreamCommit = '260d7a94ab2d5bb2a98ce6620bfda7efd56ebd6b'

# Always start from the pinned upstream so materialization is deterministic.
git submodule update --init --recursive
if ($LASTEXITCODE -ne 0) { throw 'git submodule update failed' }
Push-Location upstream
try {
    git reset --hard $UpstreamCommit
    if ($LASTEXITCODE -ne 0) { throw 'upstream reset failed' }
    git clean -fd
    if ($LASTEXITCODE -ne 0) { throw 'upstream clean failed' }
} finally {
    Pop-Location
}

$BootstrapPreflight = @(
    '.\bootstrap\materialize.js',
    '.\bootstrap\fix-readiness-nvidia.js',
    '.\bootstrap\fix-strategy-context.js',
    '.\bootstrap\harden-production.js',
    '.\bootstrap\fix-script-shape.js',
    '.\bootstrap\fix-production-tts-shape.js',
    '.\bootstrap\fix-production-audio-captions.js',
    '.\bootstrap\phase1-contracts.js',
    '.\bootstrap\phase2-scene-pipeline.js',
    '.\bootstrap\phase3-audio-timing.js',
    '.\bootstrap\phase4-provider-usage.js',
    '.\bootstrap\phase5-research-evidence.js',
    '.\bootstrap\verify-phase1-contracts.js',
    '.\bootstrap\verify-phase2-scenes.js',
    '.\bootstrap\verify-phase2-scenes-v3.js',
    '.\bootstrap\verify-phase3-audio.js',
    '.\bootstrap\verify-phase4-provider-usage.js',
    '.\bootstrap\verify-phase5-research-evidence.js',
    '.\bootstrap\templates\content-contracts.js',
    '.\bootstrap\templates\scene-pipeline-v2.js',
    '.\bootstrap\templates\scene-narration-v3.js',
    '.\bootstrap\templates\ai-gateway-v4.js',
    '.\bootstrap\templates\research-evidence-v5.js'
)
foreach ($script in $BootstrapPreflight) {
    node --check $script
    if ($LASTEXITCODE -ne 0) { throw "Bootstrap syntax preflight failed: $script" }
}
Write-Host 'Bootstrap syntax preflight passed.' -ForegroundColor Green

$PatchScripts = @(
    '.\bootstrap\materialize.js',
    '.\bootstrap\fix-readiness-nvidia.js',
    '.\bootstrap\fix-strategy-context.js',
    '.\bootstrap\harden-production.js',
    '.\bootstrap\fix-script-shape.js',
    '.\bootstrap\fix-production-tts-shape.js',
    '.\bootstrap\fix-production-audio-captions.js',
    '.\bootstrap\phase1-contracts.js',
    '.\bootstrap\phase2-scene-pipeline.js',
    '.\bootstrap\phase3-audio-timing.js',
    '.\bootstrap\phase4-provider-usage.js',
    '.\bootstrap\phase5-research-evidence.js'
)
foreach ($script in $PatchScripts) {
    node $script
    if ($LASTEXITCODE -ne 0) { throw "$script failed" }
}

# DarkzSEO is pinned so review results do not depend on an untracked local version.
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
    # npm 11+/12 can block native dependency install scripts unless approved.
    npm pkg set "allowScripts.sqlite3=true" --json
    if ($LASTEXITCODE -ne 0) { throw 'npm pkg set allowScripts.sqlite3 failed' }

    $RuntimeChecks = @(
        'index.js',
        'database\db.js',
        'agents\content-strategy-agent.js',
        'agents\script-writer-agent.js',
        'agents\production-management-agent.js',
        'utils\ai-video-generator.js',
        'utils\operator-service.js',
        'utils\ai-text-service.js',
        'utils\ai-gateway-v4.js',
        'utils\credential-manager.js',
        'utils\production-readiness-service.js',
        'utils\generation-recovery-service.js',
        'utils\content-contracts.js',
        'utils\scene-pipeline-v2.js',
        'utils\scene-narration-v3.js',
        'utils\research-evidence-v5.js',
        'utils\provenance-service.js',
        'dashboard\app.js',
        'dashboard\enhance.js',
        'walkthrough.js'
    )
    foreach ($file in $RuntimeChecks) {
        node --check $file
        if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $file" }
    }

    $RegressionChecks = @(
        @{ Path = '..\bootstrap\verify-phase1-contracts.js'; Error = 'Phase 1 content contract regression checks failed' },
        @{ Path = '..\bootstrap\verify-phase2-scenes-v3.js'; Error = 'Phase 2 scene pipeline regression checks failed under Phase 3' },
        @{ Path = '..\bootstrap\verify-phase3-audio.js'; Error = 'Phase 3 audio timing regression checks failed' },
        @{ Path = '..\bootstrap\verify-phase4-provider-usage.js'; Error = 'Phase 4 provider router/usage regression checks failed' },
        @{ Path = '..\bootstrap\verify-phase5-research-evidence.js'; Error = 'Phase 5 research/evidence regression checks failed' }
    )
    foreach ($check in $RegressionChecks) {
        node $check.Path
        if ($LASTEXITCODE -ne 0) { throw $check.Error }
    }

    python ..\darkzseo\darkzseo.py --help *> $null
    if ($LASTEXITCODE -ne 0) { throw 'DarkzSEO 1.4 smoke check failed' }

    Write-Host 'AgentTube materializado com NVIDIA NIM, GroqCloud, Cerebras e sqlite3 compativel com Node 24.' -ForegroundColor Green
    Write-Host 'FASE 1 ativa: Strategy/Script Contracts v1, normalizacao central, validacao e migracao de checkpoints.' -ForegroundColor Green
    Write-Host 'FASE 2 ativa: pipeline scene-first, estados persistentes por cena, resume granular e rebuild seletivo.' -ForegroundColor Green
    Write-Host 'FASE 3 ativa: TTS persistente por chunks, retry seletivo, duracao real do audio e captions scene-timed.' -ForegroundColor Green
    Write-Host 'FASE 4 ativa: AI Provider Router, circuit breaker, tokens/quotas, budgets e Usage Center.' -ForegroundColor Green
    Write-Host 'FASE 5 ativa: Research Agent, Evidence Desk, evidence packs, claim gate e auditoria persistente.' -ForegroundColor Green
    Write-Host 'Production hardening ativo: provenance, anti-hallucination, local visuals, quota breaker e duplicate guard.' -ForegroundColor Green
    Write-Host 'DarkzSEO 1.4 pinned e validado localmente.' -ForegroundColor Green
    Write-Host 'sqlite3 install scripts approved for this project.' -ForegroundColor Green
    Write-Host 'Execute: npm install' -ForegroundColor Cyan
    Write-Host 'Depois execute: npm run test:contracts; npm run test:scenes; npm run test:audio-scenes; npm run test:ai-usage; npm run test:evidence' -ForegroundColor Cyan
    Write-Host 'Depois execute: npx playwright install chromium' -ForegroundColor Cyan
} finally {
    Pop-Location
}
