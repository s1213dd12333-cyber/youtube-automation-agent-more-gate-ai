'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const runtime = path.join(upstream, 'utils', 'global-news-radar-v121.js');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function main() {
  childProcess.execFileSync(process.execPath, ['--check', runtime], { stdio: 'inherit' });
  const source = fs.readFileSync(runtime, 'utf8');
  assert(source.includes('fetchSourcesResilient'), 'bounded concurrent source collector must be materialized');
  assert(source.includes("reason: 'circuit_open'"), 'source circuit breaker must be materialized');
  assert(source.includes("status IN ('completed','partial','failed')"), 'failed scans must participate in cadence checks');
  assert(source.includes('rss_bbc_world') && source.includes('rss_aljazeera_all') && source.includes('rss_npr_world'), 'built-in RSS fallbacks must be present');
  assert(source.includes('NEWSROOM_SOURCE_CIRCUIT_OPEN_MINUTES'), 'circuit cooldown must be configurable');

  delete require.cache[require.resolve(runtime)];
  const { GlobalNewsRadarServiceV121 } = require(runtime);

  const previousRss = process.env.NEWSROOM_RSS_SOURCES_JSON;
  delete process.env.NEWSROOM_RSS_SOURCES_JSON;
  const defaults = new GlobalNewsRadarServiceV121(null, { http: { get: async () => ({ data: '' }) } });
  const defaultConfig = defaults.getConfig();
  assert.strictEqual(defaultConfig.httpTimeoutMs, 4500, 'default discovery timeout should fail fast at 4.5s');
  assert(defaultConfig.rssSources.length >= 5, 'radar should have several built-in RSS fallback sources');
  assert.strictEqual(defaultConfig.maxConcurrentSources, 4, 'source collection should use bounded concurrency');
  if (previousRss === undefined) delete process.env.NEWSROOM_RSS_SOURCES_JSON;
  else process.env.NEWSROOM_RSS_SOURCES_JSON = previousRss;

  let gdeltCalls = 0;
  let rssCalls = 0;
  let inFlightGdelt = 0;
  let maxInFlightGdelt = 0;
  const http = {
    async get(url) {
      if (String(url).includes('gdeltproject.org')) {
        gdeltCalls += 1;
        inFlightGdelt += 1;
        maxInFlightGdelt = Math.max(maxInFlightGdelt, inFlightGdelt);
        await sleep(30);
        inFlightGdelt -= 1;
        const error = new Error('timeout of 4500ms exceeded');
        error.code = 'ECONNABORTED';
        throw error;
      }
      if (String(url).includes('fallback.test')) {
        rssCalls += 1;
        return {
          data: `<?xml version="1.0"?><rss><channel><item><title>Fallback world event remains available</title><link>https://publisher.test/world-event</link><pubDate>Thu, 17 Sep 2026 04:00:00 GMT</pubDate><description>Fallback metadata</description></item></channel></rss>`,
          headers: { 'content-type': 'application/rss+xml' }
        };
      }
      throw new Error(`unexpected URL ${url}`);
    }
  };

  const radar = new GlobalNewsRadarServiceV121(null, {
    http,
    timeoutMs: 4500,
    maxConcurrentSources: 4,
    sourceFailureThreshold: 2,
    sourceCircuitOpenMinutes: 15,
    gdeltLanes: [
      { id: 'gdelt_en', query: 'sourcelang:english', language: 'English', maxRecords: 20 },
      { id: 'gdelt_es', query: 'sourcelang:spanish', language: 'Spanish', maxRecords: 20 },
      { id: 'gdelt_pt', query: 'sourcelang:portuguese', language: 'Portuguese', maxRecords: 20 },
      { id: 'gdelt_fr', query: 'sourcelang:french', language: 'French', maxRecords: 20 }
    ],
    rssSources: [
      { id: 'rss_test', name: 'Test fallback', url: 'https://fallback.test/world.xml', region: 'Global', language: 'English' }
    ]
  });

  const first = await radar.scanAndDecide({ autoPromote: false });
  assert.strictEqual(first.status, 'partial', 'RSS success should keep a GDELT outage from failing the whole scan');
  assert.strictEqual(first.articleCount, 1, 'fallback RSS article should still enter the radar');
  assert.strictEqual(gdeltCalls, 4, 'first attempt should probe all configured GDELT lanes');
  assert(maxInFlightGdelt >= 2, 'GDELT lanes should no longer wait sequentially');
  assert.strictEqual(rssCalls, 1, 'fallback RSS should be collected in the same scan');
  const gdeltHealth = radar.sourceHealthSnapshot().find(item => item.key === 'backend:gdelt');
  assert(gdeltHealth && gdeltHealth.circuitState === 'open', 'repeated GDELT failures in one discovery round should open its circuit');

  const beforeSecond = gdeltCalls;
  const second = await radar.scanAndDecide({ autoPromote: false });
  assert.strictEqual(second.status, 'partial', 'open GDELT circuit plus healthy RSS should remain partial, not failed');
  assert.strictEqual(gdeltCalls, beforeSecond, 'open GDELT circuit must prevent another immediate network retry storm');
  assert.strictEqual(rssCalls, 2, 'healthy fallback source should continue running while GDELT circuit is open');
  assert(second.sourceResults.filter(item => item.type === 'gdelt').every(item => item.skipped && item.reason === 'circuit_open'), 'GDELT lanes should report circuit-open skips');

  let dueHttpCalls = 0;
  const dueDb = {
    async getRow(sql) {
      if (String(sql).includes('global_news_scans')) {
        return { id: 'news_scan_failed_recently', status: 'failed', completed_at: new Date().toISOString() };
      }
      return null;
    }
  };
  const dueRadar = new GlobalNewsRadarServiceV121(dueDb, {
    scanIntervalMinutes: 10,
    gdeltLanes: [{ id: 'gdelt_en', query: 'sourcelang:english' }],
    rssSources: [],
    http: { async get() { dueHttpCalls += 1; throw new Error('should not be called'); } }
  });
  const due = await dueRadar.scanIfDue({ autoPromote: false });
  assert.strictEqual(due.skipped, true, 'recent failed scan should suppress the next minute scheduler tick');
  assert.strictEqual(due.reason, 'not_due', 'recent failure should honor normal newsroom cadence');
  assert.strictEqual(dueHttpCalls, 0, 'cadence suppression must happen before any HTTP call');

  console.log('Newsroom source resilience verified: failed scans honor cadence, GDELT runs concurrently and opens a circuit, and RSS fallback continues discovery.');
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
