# FASE 11.8 — Semantic Prop & Layout Verification

## Objetivo

A FASE 11.8 fecha a principal lacuna declarada pela 11.7.6: continuidade perceptual de ambiente não é o mesmo que provar semanticamente que um objeto específico continua presente e respeitando atributos travados.

Exemplo:

```text
Environment: casa de madeira
Prop Lock: sofá bege
Prop Lock: mesa de centro de madeira
```

A 11.7.6 consegue comparar paleta, luminância, composição, perceptual hash e estrutura contra o Master Environment. A 11.8 adiciona evidência visual semântica real para responder, a partir dos pixels do frame:

- o sofá está visível?
- o sofá continua bege?
- a mesa está visível?
- a mesa continua de madeira?
- o frame ainda representa o mesmo ambiente?
- o layout continua consistente?

## Regra de verdade

`semanticPropPresenceVerified=true` só pode ser persistido quando um analisador vision realmente recebe a imagem produzida e devolve um contrato estruturado válido com confiança suficiente.

O sistema não promove para `true` usando:

- prompt;
- nome de arquivo;
- metadata;
- fingerprint anterior;
- estado histórico do provider;
- suposição de que o gerador seguiu as instruções.

## Provider

O runtime usa um endpoint vision OpenAI-compatible. Isso permite trabalhar com um serviço local, incluindo servidores que exponham `/v1/chat/completions` com suporte a `image_url`, ou com um provider remoto compatível.

Configuração:

```env
SEMANTIC_PROP_VERIFICATION_ENABLED=true
SEMANTIC_PROP_REQUIRE_VERIFICATION=false
SEMANTIC_PROP_MIN_CONFIDENCE=0.72
SEMANTIC_PROP_VISION_BASE_URL=
SEMANTIC_PROP_VISION_MODEL=
SEMANTIC_PROP_VISION_API_KEY=
SEMANTIC_PROP_VISION_TIMEOUT_MS=30000
```

`SEMANTIC_PROP_REQUIRE_VERIFICATION=false` é intencional enquanto nenhum endpoint vision tiver sido configurado e validado. Nesse estado o sistema permanece auditável, mas não inventa verificação semântica.

Quando um endpoint real estiver validado, pode-se ativar:

```env
SEMANTIC_PROP_REQUIRE_VERIFICATION=true
```

A partir daí, ausência, indisponibilidade ou rejeição da evidência semântica bloqueia Environment Continuity e Cartoon Quality.

## Persistência

Tabela:

```text
semantic_prop_checks
```

Cada decisão registra:

- production / scene / shot / keyframe;
- Environment ID;
- provider mode;
- model;
- provider realmente usado ou não;
- status;
- verified;
- confidence;
- environmentMatches;
- layoutConsistent;
- evidência por Prop Lock;
- props ausentes;
- atributos divergentes;
- reasons;
- prompt fingerprint;
- response fingerprint.

## Integração

```text
Environment Bible 11.7.1
→ Prop Locks 11.7.2
→ Master Environment 11.7.3
→ Scene Mapping 11.7.4
→ Prompt Enrichment 11.7.5
→ Perceptual Environment Continuity 11.7.6
→ Semantic Prop & Layout Verification 11.8
→ Keyframe READY
→ Motion
→ Cartoon Quality
```

A 11.8 não substitui a 11.7.6. Os dois gates observam coisas diferentes:

- 11.7.6: continuidade visual/perceptual da localização;
- 11.8: presença e atributos semânticos de objetos + coerência de layout percebida por vision.

## Estados principais

```text
verified
rejected
unavailable
invalid_response
provider_error
asset_missing
disabled
```

## Quality Gate

Com `SEMANTIC_PROP_REQUIRE_VERIFICATION=true`, Cartoon Quality bloqueia quando um keyframe mapeado não tem evidência 11.8 ou quando a decisão está rejeitada.

Com o modo required desligado, a informação continua no bundle, dashboard e fingerprint de qualidade, mas não bloqueia publicação sozinha.

## Dashboard

O Review Studio recebe o painel:

```text
SEMANTIC PROP & LAYOUT V11.8
Vision-backed object continuity
```

O painel distingue `verified`, `rejected`, `unavailable` e demais estados sem transformar ausência de provider em sucesso.

## Regressão

```powershell
cd upstream
npm run test:semantic-props
```

O verifier cobre respostas estruturadas válidas, prop ausente, baixa confiança, cor/material divergentes, layout divergente, provider não configurado e analisador vision injetado de teste.
