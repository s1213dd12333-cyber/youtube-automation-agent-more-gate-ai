'use strict';

const assert = require('assert');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'global-news-radar-v121.js');

function article(title, domain, region, minutesAgo = 5, summary = '') {
  return {
    id: domain + ':' + title,
    title,
    summary,
    url: 'https://' + domain + '/story',
    sourceName: domain,
    sourceDomain: domain,
    sourceRegion: region,
    publishedAt: new Date(Date.now() - minutesAgo * 60000).toISOString(),
    seenAt: new Date().toISOString()
  };
}

(async () => {
  const {
    GlobalNewsRadarServiceV121,
    clusterArticles,
    sourceEvidenceUnits,
    scoreCluster,
    editorDecision,
    tokens,
    eventTokens
  } = require(runtimePath);

  const sameEvent = [
    article('Powerful earthquake strikes northern Japan; tsunami warning issued', 'alpha.example', 'North America', 4),
    article("Tsunami alert after strong quake hits Japan's northern coast", 'bravo.example', 'Europe', 6),
    article('Japan issues tsunami warning following powerful northern earthquake', 'charlie.example', 'East Asia', 8),
    article('Strong quake off northern Japan prompts tsunami advisory', 'delta.example', 'Oceania', 10),
    article('Terremoto forte atinge norte do Japão; alerta de tsunami emitido', 'echo.example', 'Latin America', 12),
    article('Alerta de tsunami en Japón tras fuerte terremoto golpea el norte', 'foxtrot.example', 'Europe', 14)
  ];

  const unrelated = [
    article('Japan central bank raises interest rates as yen weakens', 'rates.example', 'East Asia', 7),
    article('Japanese chipmaker opens new factory for advanced processors', 'chips.example', 'East Asia', 9)
  ];

  const oldSimilar = article(
    'Powerful earthquake strikes northern Japan; tsunami warning issued',
    'old.example',
    'North America',
    24 * 60 + 5
  );

  const clusters = clusterArticles([...sameEvent, ...unrelated, oldSimilar], 0.36, 18);
  const eventCluster = clusters.find(cluster => cluster.articles.some(item => item.sourceDomain === 'alpha.example'));

  assert(eventCluster, 'main Japan earthquake event cluster must exist');
  assert.strictEqual(eventCluster.articles.length, 6, 'six paraphrased/multilingual reports about the same event must cluster together');
  assert(!eventCluster.articles.some(item => item.sourceDomain === 'rates.example'), 'central-bank story must not be merged into earthquake event');
  assert(!eventCluster.articles.some(item => item.sourceDomain === 'chips.example'), 'chip-factory story must not be merged into earthquake event');
  assert(!eventCluster.articles.some(item => item.sourceDomain === 'old.example'), 'same-looking headline outside the temporal guardrail must remain separate');

  assert(tokens('Breaking: Major event changes global markets today').includes('markets'), 'legacy token contract must preserve meaningful title tokens');
  assert(eventTokens('Terremoto forte atinge norte do Japão').includes('earthquake'), 'Portuguese event token must canonicalize for clustering');
  assert(eventTokens('Alerta de tsunami en Japón tras fuerte terremoto').includes('japan'), 'Spanish event token must canonicalize for clustering');

  const scores = scoreCluster(eventCluster, new Date(), 6);
  eventCluster.scores = scores;
  eventCluster.materialChange = { changed: true, reason: 'new_cluster' };

  assert.strictEqual(scores.sourceCount, 6, 'six independent source domains must survive scoring');
  assert.strictEqual(sourceEvidenceUnits(eventCluster.articles), 6, 'six independently worded headlines must count as six evidence units');
  assert(scores.confidenceScore >= 58, 'corroborated event must meet the existing confidence gate');

  const decision = editorDecision(eventCluster, null, {
    minIndependentSources: 3,
    minConfidence: 58,
    breakingThreshold: 82,
    coverThreshold: 66,
    followUpThreshold: 58
  });
  assert(['COVER', 'BREAKING'].includes(decision.action), 'strongly corroborated fast-moving event must become actionable under existing thresholds');

  const service = new GlobalNewsRadarServiceV121(null, {});
  const config = service.getConfig();
  assert.strictEqual(config.clusterMaxGapHours, 18, 'default temporal clustering window must be 18 hours');

  console.log('Newsroom event clustering verification passed: paraphrased multilingual reports correlate, unrelated Japan stories stay separate, old lookalikes are time-isolated, and existing evidence gates remain unchanged.');
})().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
