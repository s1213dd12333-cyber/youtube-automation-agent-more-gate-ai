# YouTube Automation Agent — More Gate AI

Camada de evolução do [AgentTube / YouTube Automation Agent](https://github.com/darkzOGx/youtube-automation-agent), com roteamento multi-provider, pesquisa com evidência, pipeline scene-first, áudio/captions, Visual Director/Router, Quality Agents, autonomia segura e um pipeline avançado de cartoons com continuidade de personagens **e ambientes persistentes**.

> **Estado do projeto:** as Fases 1–11.6 já tiveram regressões validadas no Windows deste projeto. As revisões 11.7.1–11.7.6 estão implementadas e publicadas; a validação Windows da cadeia 11.7 está em andamento.

---

## 1. Arquitetura do repositório

Este repositório usa um overlay determinístico sobre o upstream original.

- Upstream: `darkzOGx/youtube-automation-agent`
- Branch upstream: `master`
- Commit fixado: `260d7a94ab2d5bb2a98ce6620bfda7efd56ebd6b`
- Submodule local: `upstream/`
- Bootstrap/versionamento das revisões: `bootstrap/`
- Materializador Windows: `materialize.ps1`

O upstream não é alterado diretamente no repositório original. O materializador parte do commit fixado e reaplica as extensões de forma determinística.

### Atenção com um checkout que já possui produções

O `materialize.ps1` atual executa `git clean -fd` dentro de `upstream/`. Isso pode remover diretórios runtime não rastreados, inclusive `data/production/`. Portanto, **não execute uma materialização completa em um checkout com produção importante sem backup**. Para desenvolvimento incremental, aplique os bootstraps específicos da fase em vez de resetar todo o runtime.

---

## 2. Inicialização

Em uma instalação nova:

```powershell
git clone --recurse-submodules https://github.com/s1213dd12333-cyber/youtube-automation-agent-more-gate-ai.git
cd youtube-automation-agent-more-gate-ai
powershell -ExecutionPolicy Bypass -File .\materialize.ps1
cd upstream
npm start
```

Servidor padrão:

```text
Dashboard: http://localhost:3456
Health:    http://localhost:3456/health
Schedule:  http://localhost:3456/schedule
Analytics: http://localhost:3456/analytics
```

O `PORT` pode sobrescrever a porta padrão.

---

## 3. Providers de IA

O projeto mantém os providers do upstream e adiciona gateways OpenAI-compatible.

### NVIDIA NIM

```text
Base URL: https://integrate.api.nvidia.com/v1
Default:  openai/gpt-oss-20b
Models:
- openai/gpt-oss-20b
- nvidia/llama-3.3-nemotron-super-49b-v1
- z-ai/glm-5.1
- minimaxai/minimax-m3
```

### GroqCloud

```text
Base URL: https://api.groq.com/openai/v1
Default:  openai/gpt-oss-20b
Models:
- openai/gpt-oss-20b
- openai/gpt-oss-120b
- qwen/qwen3.6-27b
- qwen/qwen3.8-27b
```

### Cerebras Inference

```text
Base URL: https://api.cerebras.ai/v1
Default:  gpt-oss-120b
Models:
- gpt-oss-120b
- zai-glm-4.7
```

Exemplo de variáveis:

```env
NVIDIA_API_KEY=
GROQ_API_KEY=
CEREBRAS_API_KEY=

AI_PROVIDER_MODE=explicit
```

Nunca versione chaves reais no Git.

---

## 4. Pipeline principal

Fluxo de produção consolidado:

```text
Topic / Instructions
→ Content Strategy
→ Research + Evidence
→ Script
→ Thumbnail
→ SEO
→ Scene Pipeline
→ Character / Environment planning
→ Visual generation
→ Narration + captions
→ Motion / assembly
→ Quality Agents
→ Human Review
→ Schedule / Publish
```

Publicação continua fail-closed: conteúdo não aprovado ou com gates pendentes não deve ser agendado/publicado automaticamente.

---

# 5. Revisões por fase

## FASE 1 — Content Contracts

Contratos estruturais de conteúdo e regressões determinísticas.

**Windows validado:** `7 regression checks passed`.

## FASE 2 — Scene-first Pipeline

- cenas persistentes;
- IDs estáveis;
- estados por cena;
- manifest v2;
- Resume por cena.

**Windows validado:** `12 regression groups passed`.

## FASE 3 — Scene TTS + Captions

- narração por cena;
- chunking/retry;
- captions sincronizadas;
- Gemini TTS;
- fallback local Windows SAPI quando permitido;
- circuit breaker de quota diária.

Configuração principal:

```env
TTS_SCENE_CHUNK_CHARS=1800
TTS_SCENE_RETRIES=3
TTS_SCENE_RETRY_MS=750
LOCAL_TTS_FALLBACK_ENABLED=true
WINDOWS_TTS_VOICE=
```

**Windows validado:** `20` checks + `12` checks de hardening Gemini TTS.

## FASE 4 — AI Router + Usage Center

- modos `explicit`, `free_first`, `fastest`, `quality`, `balanced`;
- circuit breaker por provider/model;
- SQLite `ai_usage`;
- contexto por job/stage;
- endpoint de usage;
- custo desconhecido permanece `null`, nunca zero inventado.

**Windows validado:** `18 regression checks passed`.

## FASE 5 — Research + Evidence

Fontes integradas:

- Wikipedia;
- Crossref;
- OpenAlex.

Modo estrito:

```env
EVIDENCE_STRICT_MODE=true
RESEARCH_MAX_SOURCES=12
RESEARCH_HTTP_TIMEOUT_MS=8000
EVIDENCE_STANDARD_THRESHOLD=0.24
EVIDENCE_HIGH_THRESHOLD=0.32
```

Claims não verificadas podem bloquear com `EVIDENCE_CLAIMS_UNVERIFIED`.

**Windows validado:** `22 regression checks passed`.

## FASE 6 — Per-video Instructions

Instruções por vídeo atravessam Strategy → Research → Script → Evidence → SEO → Visuals → Review sem poder sobrescrever regras de evidência, segurança, direitos ou aprovação.

```env
SCRIPT_AI_MAX_TOKENS=6144
SCRIPT_AI_RETRY_MAX_TOKENS=12288
```

**Windows validado:** `18 regression checks passed`.

## FASE 7 — Visual Director

- VisualBrief obrigatório;
- especificidade visual;
- generic-AI risk;
- diagramas/mapas/documentary/cartoon;
- renderer local como fallback controlado.

**Windows validado:** `18 regression checks passed`.

## FASE 8 — Visual Router

Source-first para conteúdo factual/documental.

Fontes:

- Wikimedia Commons;
- NASA;
- Library of Congress;
- Internet Archive;
- USGS.

Direitos fail-closed. Autoaceite restrito a Public Domain, CC0 e CC BY explícito.

Cartoons `kids_cartoon_2d` podem ignorar o router documental quando o modo cartoon estiver realmente ativo.

**Windows validado:** `20 regression checks passed`.

## FASE 9 — Quality Agents

Cinco agentes, mantendo exatamente os pesos:

```text
Retention  25
Thumbnail  15
SEO        15
Visual     20
Fact       25
```

Persistência em `quality_agent_reports`.

**Windows validado:** `22 regression checks passed`.

## FASE 10 — Autonomy + Observability + Safe Publication

Inclui:

- prevenção de tópicos próximos/duplicados;
- auto-repair limitado;
- Doctor;
- stuck-job diagnostics;
- upload reconciliation;
- publication blockers;
- aprovação humana obrigatória.

```env
TOPIC_NEAR_DUPLICATE_THRESHOLD=0.72
TOPIC_LIBRARY_WINDOW_DAYS=365
ALLOW_NEAR_DUPLICATE_TOPICS=false
AUTONOMY_AUTO_REPAIR=true
AUTONOMY_AUTO_REPAIR_MAX_ATTEMPTS=1
```

**Windows validado:** `26 regression checks passed`.

---

# 6. FASE 11 — Cartoon Production Pipeline

Objetivo: sair de slideshow genérico e produzir cartoons por shots/keyframes, com continuidade visual, movimento e gates específicos.

```text
Script
→ Character Bible
→ Shot Planner
→ Keyframes
→ Character Continuity
→ Motion Composer
→ Cartoon Quality Gate
→ Environment System 11.7
```

## 11.1 — Character Bible + Style Bible

- detecção `auto/force/off`;
- personagens persistentes;
- identidade visual;
- `kids_cartoon_2d`;
- fingerprints estáveis;
- dashboard Character Bible.

```env
CARTOON_VISUAL_MODE=auto
CARTOON_BIBLE_ENABLED=true
```

**Windows validado:** `31 regression checks passed`.

## 11.2 — Shot Planner

- 3–6 shots por cena por padrão;
- IDs determinísticos;
- wide / medium / close_up / reaction / action / ending;
- duração fecha exatamente com a cena;
- action, camera, emotion, continuity notes.

```env
CARTOON_SHOTS_PER_SCENE_MIN=3
CARTOON_SHOTS_PER_SCENE_MAX=6
```

**Windows validado:** `43 regression checks passed`.

## 11.3 — Keyframe Pipeline

Cada shot recebe exatamente:

```text
start
middle
end
```

Com referências encadeadas e Resume somente do que falta/falhou.

```env
CARTOON_KEYFRAME_GENERATION_ENABLED=true
CARTOON_KEYFRAME_MAX_PER_PRODUCTION=180
```

**Windows validado:** `47 regression checks passed`.

## 11.4 — Character Continuity Engine

Validação perceptual determinística com:

- aspect;
- palette;
- luminance;
- composition grid;
- perceptual hash;
- reference-conditioned generation quando realmente usada pelo provider;
- auto-repair limitado.

```env
CARTOON_CONTINUITY_MIN_SCORE=0.48
CARTOON_CONTINUITY_AUTO_REPAIR=true
CARTOON_CONTINUITY_MAX_REPAIR_ATTEMPTS=1
```

Importante: `referenceConditioned=true` só é persistido quando a imagem de referência foi realmente enviada ao provider.

**Windows validado:** `36 regression checks passed`.

## 11.5 — Motion Composer

Transforma start/middle/end em segmentos e cenas de vídeo usando FFmpeg.

```env
CARTOON_MOTION_ENABLED=true
CARTOON_MOTION_FPS=30
CARTOON_MOTION_WIDTH=1280
CARTOON_MOTION_HEIGHT=720
CARTOON_MOTION_TRANSITION_SECONDS=0.16
```

Inclui fingerprint SHA-256 dos bytes, invalidação de motion após alteração de keyframe e proteção de Resume.

**Windows validado:** `36` checks + `7` checks de hardening.

## 11.6 — Cartoon Quality Gate + Made-for-Kids

O Cartoon Quality Gate é incorporado ao **Visual Agent existente**; não existe um sexto Quality Agent.

Verifica, entre outros:

- Bible;
- 3–6 shots;
- prompts concretos;
- start/middle/end;
- assets reais;
- continuity aceita;
- motion por shot/cena;
- binding do vídeo final;
- duração;
- frames byte-identical;
- generic-AI risk;
- child-safety lexical screen.

Também mapeia cartoon infantil para `selfDeclaredMadeForKids` no upload.

**Windows validado:** `34` checks do gate + `4` checks Made-for-Kids.

---

# 7. FASE 11.7 — Persistent Environment System

A 11.7 resolve o problema de cenários genéricos que mudam a cada frame.

Exemplo de intenção:

```text
"uma casa mobiliada feita em madeira, com sofá bege,
mesa rústica, estante, tapete e janelas grandes"
```

O objetivo é que isso vire uma localização persistente, como:

```text
env_house_<fingerprint>
```

que possa reaparecer de forma reconhecível em vários shots e cenas.

## 11.7.1 — Environment Bible Service

Persiste:

- `environmentId`;
- categoria;
- construção;
- estilo arquitetônico;
- materiais;
- paleta;
- iluminação;
- layout;
- elementos assinatura;
- mudanças proibidas;
- source evidence;
- inferred defaults;
- specificity;
- fingerprint.

Tabela: `environment_bibles`.

**Implementada / validação Windows em andamento.**

## 11.7.2 — Prop Lock Service

Transforma móveis/objetos em identidades persistentes.

Exemplos:

```text
sofa
coffee table
bookshelf
large window
kitchen counter
```

Cada lock possui prioridade, `required`, atributos travados, proveniência e regras de mudança.

Tabela: `prop_locks`.

**Implementada / validação Windows em andamento.**

## 11.7.3 — Master Environment Generator

Cria uma imagem-mestra canônica por ambiente:

```text
data/assets/environments/<production>/<environment>/master.png
```

Por padrão:

```env
MASTER_ENVIRONMENT_GENERATION_ENABLED=true
MASTER_ENVIRONMENT_REQUIRE_PROVIDER=true
```

Um renderer local genérico **não pode virar referência canônica**. Quando isso acontece:

```text
status = fallback_unanchored
canonical = false
masterFramePath = null
```

Tabela: `environment_master_frames`.

**Implementada / validação Windows em andamento.**

## 11.7.4 — Scene-to-Environment Mapping

Liga cada cena a um Environment ID persistente e, quando possível, a uma zona:

```text
Scene 1 → env_house_01 / living_room
Scene 2 → env_house_01 / kitchen
Scene 3 → env_garden_01 / garden
```

Ambiguidade em produções com vários ambientes permanece `unresolved` em vez de inventar um cenário.

Tabela: `scene_environments`.

**Implementada / validação Windows em andamento.**

## 11.7.5 — Environment + Prop Prompt Enrichment

Injeta no shot/keyframe:

- Environment ID;
- zona;
- construção;
- materiais;
- paleta;
- iluminação;
- Prop Locks;
- regras de layout;
- SHA/path do master canônico.

Tabela: `shot_environment_contexts`.

O primeiro `start` de uma cena pode usar o `master.png` canônico como referência real de geração; os keyframes seguintes continuam a cadeia normal de continuidade.

A revisão preserva o `planFingerprint` estrutural da 11.2 para estabilidade de Resume, mas altera o fingerprint visual quando o contexto do ambiente muda.

**Implementada / validação Windows em andamento.**

## 11.7.6 — Environment Continuity Validation

A continuidade de **personagem** continua pertencendo à 11.4.

A continuidade de **ambiente** pertence à 11.7.6.

Cada keyframe de uma cena mapeada é comparado com o Master Environment usando evidência de imagem:

- aspect;
- palette;
- luminance;
- composition grid;
- perceptual hash;
- edge density.

Configuração:

```env
ENVIRONMENT_CONTINUITY_ENABLED=true
ENVIRONMENT_CONTINUITY_REQUIRE_MASTER=true
ENVIRONMENT_CONTINUITY_MIN_SCORE=0.42
ENVIRONMENT_CONTINUITY_MIN_PROP_PROMPT_COVERAGE=1
```

Fail-closed:

```text
ENVIRONMENT_MAPPING_REQUIRED
ENVIRONMENT_MASTER_REQUIRED
ENVIRONMENT_CONTINUITY_FAILED
```

Keyframe rejeitado:

```text
status = environment_continuity_failed
```

Tabela: `environment_continuity_checks`.

A presença visual semântica de um objeto específico ainda **não é inventada**. Enquanto não existir detector visual semântico próprio:

```text
semanticPropPresenceVerified = false
propVerificationMode = prompt-contract-only
```

O Cartoon Quality Gate 11.6 também passa a exigir as decisões de Environment Continuity para shots mapeados.

**Implementada / validação Windows em andamento.**

---

## 8. Estado de regressão conhecido

Última cadeia 1–11.6 validada no Windows:

```text
Phase 1 content contracts OK: 7 regression checks passed.
Phase 2 scene pipeline OK under Phase 3: 12 regression groups passed.
Phase 3 audio timing OK: 20 regression checks passed.
Gemini TTS hardening OK: 12 regression checks passed.
Phase 4 provider router and usage center OK: 18 regression checks passed.
Phase 5 research and evidence desk OK: 22 regression checks passed.
Phase 6 per-video instructions OK: 18 regression checks passed.
Phase 7 Visual Director OK: 18 regression checks passed.
Phase 8 Visual Router OK: 20 regression checks passed.
Phase 9 Quality Agents OK: 22 regression checks passed.
Phase 10 autonomy/observability OK: 26 regression checks passed.
Phase 11.1 Cartoon Bible OK: 31 regression checks passed.
Phase 11.2 Shot Planner OK: 43 regression checks passed.
Phase 11.3 Keyframe Pipeline OK: 47 regression checks passed.
Phase 11.4 Continuity Engine OK: 36 regression checks passed.
Phase 11.5 Motion Composer OK: 36 regression checks passed.
Phase 11.5 Motion Hardening OK: 7 regression checks passed.
Phase 11.6 Made-for-Kids Mapping OK: 4 regression checks passed.
Phase 11.6 Cartoon Quality Gate OK: 34 regression checks passed.
```

Regressões específicas da 11.7 disponíveis:

```powershell
npm run test:environment-bible
npm run test:prop-lock
npm run test:master-environment
npm run test:scene-environments
npm run test:environment-prompts
npm run test:environment-continuity
```

A validação Windows da cadeia 11.7 ainda deve ser concluída antes de marcar essas subfases como runtime-verificadas.

---

## 9. E2E cartoon

O primeiro E2E real utilizado nesta evolução foi:

```text
Benny the Bunny Learns the Colors
```

O pipeline chegou a:

```text
Character Bible
→ Visual Director
→ 7 scenes
→ 41 shots
→ 123 planned keyframes
→ first keyframe generated
```

Esse E2E revelou bugs reais de runtime que os testes estáticos não mostravam, incluindo o caminho de image-reference após circuit breaker de quota. Esses casos geraram hardenings adicionais e reforçaram a estratégia de Resume no mesmo job em vez de recriar produções.

---

## 10. Gemini Images e limitação atual

Em validação real, Gemini Images retornou quota gratuita `0` para o provider de imagem.

Consequência intencional da 11.7:

- fallback local genérico pode ser auditado;
- fallback local genérico **não** se torna Master Environment canônico;
- com `ENVIRONMENT_CONTINUITY_REQUIRE_MASTER=true`, a geração pode parar com `ENVIRONMENT_MASTER_REQUIRED` até existir um master válido.

Isso é preferível a fingir continuidade com imagens genéricas.

---

## 11. TTS Gemini

Exemplo:

```env
GEMINI_API_KEY=
GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview
GEMINI_TTS_VOICE=Kore
```

O projeto possui fallback local no Windows para TTS quando configurado, mas o fallback deve continuar auditável e não deve ser apresentado como Gemini.

---

## 12. Segurança e publicação

Regras que não devem ser enfraquecidas:

- Evidence Strict permanece ativo para fatos verificáveis;
- VisualBrief permanece obrigatório;
- Visual Router source-first/rights fail-closed permanece para conteúdo não-cartoon;
- cartoons só ignoram o router documental quando `kids_cartoon_2d` estiver realmente ativo;
- Phase 9 Quality Agents continuam obrigatórios;
- Cartoon Quality 11.6 continua obrigatório para cartoons;
- Environment Continuity 11.7.6 entra no estado de qualidade;
- scheduling/upload exigem aprovação humana;
- custo desconhecido permanece `null`;
- chaves/API secrets nunca devem aparecer em logs ou commits.

Configuração recomendada:

```env
AI_PROVIDER_MODE=explicit
EVIDENCE_STRICT_MODE=true
VISUAL_ROUTER_ENABLED=true
VISUAL_ROUTER_ALLOW_REVIEW_REQUIRED=false
VISUAL_DIRECTOR_REFRESH_LEGACY_VISUALS=false
```

---

## 13. Resume e jobs

Quando um job falhar depois de já persistir Strategy/Script/Scenes/Shots/Keyframes, prefira **Resume do mesmo job**.

Não reenvie o mesmo tópico como uma geração nova: a FASE 10 pode corretamente bloquear como duplicado dentro da janela configurada.

Endpoint de Resume:

```text
POST /api/jobs/<jobId>/resume
```

---

## 14. Dados persistentes principais

Entre as tabelas adicionadas/expandidas pelas revisões:

```text
ai_usage
quality_agent_reports
cartoon_visual_bibles
scene_shots
shot_keyframes
keyframe_continuity_checks
cartoon_motion_segments
cartoon_motion_scenes
cartoon_quality_reports
environment_bibles
prop_locks
environment_master_frames
scene_environments
shot_environment_contexts
environment_continuity_checks
```

O banco runtime usa SQLite no checkout materializado.

---

## 15. Próximos passos técnicos

Depois da validação completa da 11.7:

1. executar um novo E2E com Master Environment proveniente de provider real;
2. avaliar visualmente a reprodução do mesmo ambiente em vários ângulos;
3. adicionar detecção visual semântica de props, caso se queira comprovar pixel-a-pixel sofá/mesa/janela;
4. considerar image-to-video local (Wan/LTX) para substituir progressivamente o motion baseado em keyframes/FFmpeg por movimento generativo real;
5. manter Human Review antes de qualquer scheduling/publicação.

---

## Licença e upstream

Consulte a licença e os termos do projeto upstream. Este repositório mantém o commit upstream fixado e versiona as extensões por bootstrap/overlay para preservar reprodutibilidade e auditoria.
