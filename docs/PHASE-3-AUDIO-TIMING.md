# FASE 3 — TTS e captions por cena

A FASE 3 torna a narração scene-based da FASE 2 resiliente a falhas de provider e usa a duração medida do áudio como fonte de verdade para a timeline.

## Fluxo

```text
scene.scriptText
  -> sentence-aware chunks
  -> TTS chunk 1..N
  -> retry/backoff apenas em falhas transitórias
  -> manifest.json persistente
  -> FFmpeg concat
  -> duração real medida pelo áudio
  -> scene.duration
  -> timeline visual
  -> scene-aware SRT
```

## Persistência e resume

Cada cena grava um manifesto em `data/audio/scenes/<productionId>/<sceneId>/manifest.json`. O manifesto inclui hash do texto, hashes dos chunks, estado, tentativas, provider/model e arquivos gerados. Ao retomar a mesma produção, chunks válidos e já concluídos são reutilizados.

Mudança no texto altera o hash e invalida o manifesto anterior. Uma cena nova da FASE 2 também recebe outro `sceneId`, mantendo isolamento entre revisões do roteiro.

## Retry

Por padrão:

- `TTS_SCENE_CHUNK_CHARS=1800`
- `TTS_SCENE_RETRIES=3`
- `TTS_SCENE_RETRY_MS=750`

O backoff é exponencial para erros transitórios. Erros de autenticação/validação e quota explicitamente zerada não são repetidos inutilmente.

## Timing

Após concatenar os chunks, FFmpeg mede a duração do arquivo final. Esse valor atualiza `production_scenes.duration`; portanto a montagem visual, o mix final e as captions usam a duração observada da narração, e não apenas uma estimativa do roteiro.

As captions desta fase são sincronizadas exatamente nos limites de cada cena e distribuídas proporcionalmente dentro da cena. Alinhamento fonema/palavra via Whisper ou forced alignment fica como melhoria posterior e não é tratado como implementado nesta fase.

## Teste

```powershell
npm run test:audio-scenes
```

O teste cobre chunking, retry de falha transitória, reuse do manifesto, medição de duração, política de erros não-retriáveis e marcadores de integração no pipeline.
