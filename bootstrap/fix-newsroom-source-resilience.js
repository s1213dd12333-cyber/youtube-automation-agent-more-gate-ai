'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const runtimePath = path.join(upstream, 'utils', 'global-news-radar-v121.js');

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function write(file, value) {
  fs.writeFileSync(file, value.replace(/\r\n/g, '\n'), 'utf8');
}

function replaceOnce(source, from, to, label) {
  if (source.includes(to)) return source;
  const index = source.indexOf(from);
  if (index === -1) throw new Error(`Newsroom resilience anchor not found: ${label}`);
  return source.slice(0, index) + to + source.slice(index + from.length);
}

function insertBefore(source, anchor, block, label) {
  if (source.includes(block.trim())) return source;
  const index = source.indexOf(anchor);
  if (index === -1) throw new Error(`Newsroom resilience anchor not found: ${label}`);
  return source.slice(0, index) + block + source.slice(index);
}

let source = read(runtimePath);

source = replaceOnce(
  source,
  "    this.timeoutMs = clamp(options.timeoutMs || process.env.NEWSROOM_HTTP_TIMEOUT_MS, 1500, 30000, 9000);\n",
  "    this.timeoutMs = clamp(options.timeoutMs || process.env.NEWSROOM_HTTP_TIMEOUT_MS, 1000, 30000, 4500);\n",
  'short fail-fast discovery timeout'
);

source = replaceOnce(
  source,
  "    this.rssSources = options.rssSources || parseJsonEnv('NEWSROOM_RSS_SOURCES_JSON', []);\n",
  `    const defaultRssSources = [\n      { id: 'rss_bbc_world', name: 'BBC News World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', region: 'Global', language: 'English', maxRecords: 60 },\n      { id: 'rss_aljazeera_all', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', region: 'Global', language: 'English', maxRecords: 60 },\n      { id: 'rss_npr_world', name: 'NPR World', url: 'https://feeds.npr.org/1004/rss.xml', region: 'Global', language: 'English', maxRecords: 50 },\n      { id: 'rss_guardian_world', name: 'The Guardian World', url: 'https://www.theguardian.com/world/rss', region: 'Global', language: 'English', maxRecords: 60 },\n      { id: 'rss_sky_world', name: 'Sky News World', url: 'https://feeds.skynews.com/feeds/rss/world.xml', region: 'Global', language: 'English', maxRecords: 50 }\n    ];\n    this.rssSources = options.rssSources || parseJsonEnv('NEWSROOM_RSS_SOURCES_JSON', defaultRssSources);\n    this.sourceHealth = new Map();\n    this.sourceFailureThreshold = clamp(options.sourceFailureThreshold || process.env.NEWSROOM_SOURCE_FAILURE_THRESHOLD, 1, 12, 2);\n    this.sourceCircuitOpenMinutes = clamp(options.sourceCircuitOpenMinutes || process.env.NEWSROOM_SOURCE_CIRCUIT_OPEN_MINUTES, 1, 120, 15);\n    this.maxConcurrentSources = clamp(options.maxConcurrentSources || process.env.NEWSROOM_SOURCE_MAX_CONCURRENCY, 1, 12, 4);\n`,
  'default RSS fallbacks and source resilience state'
);

source = replaceOnce(
  source,
  "      autoPromote: this.autoPromote,\n",
  "      autoPromote: this.autoPromote,\n      httpTimeoutMs: this.timeoutMs,\n      sourceFailureThreshold: this.sourceFailureThreshold,\n      sourceCircuitOpenMinutes: this.sourceCircuitOpenMinutes,\n      maxConcurrentSources: this.maxConcurrentSources,\n",
  'source resilience config exposure'
);

source = replaceOnce(
  source,
  "    const latest = await this.db.getRow(`SELECT * FROM global_news_scans WHERE status IN ('completed','partial') ORDER BY completed_at DESC LIMIT 1`);\n",
  "    const latest = await this.db.getRow(`SELECT * FROM global_news_scans WHERE status IN ('completed','partial','failed') AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1`);\n",
  'failed scans respect normal scan interval'
);

const helperMethods = `  sourceHealthKey(source = {}) {\n    if (source.type === 'gdelt') return 'backend:gdelt';\n    return \`source:\${source.type || 'unknown'}:\${source.definition?.id || source.definition?.url || 'unknown'}\`;\n  }\n\n  getSourceHealth(source = {}) {\n    const key = this.sourceHealthKey(source);\n    return this.sourceHealth.get(key) || { key, consecutiveFailures: 0, circuitOpenUntil: 0, lastError: null, lastSuccessAt: null, lastFailureAt: null };\n  }\n\n  sourceHealthSnapshot() {\n    return [...this.sourceHealth.values()].map(item => ({\n      key: item.key,\n      consecutiveFailures: item.consecutiveFailures || 0,\n      circuitState: Number(item.circuitOpenUntil || 0) > Date.now() ? 'open' : 'closed',\n      retryAt: Number(item.circuitOpenUntil || 0) > Date.now() ? new Date(item.circuitOpenUntil).toISOString() : null,\n      lastError: item.lastError || null,\n      lastSuccessAt: item.lastSuccessAt || null,\n      lastFailureAt: item.lastFailureAt || null\n    }));\n  }\n\n  markSourceSuccess(source = {}) {\n    const key = this.sourceHealthKey(source);\n    this.sourceHealth.set(key, { key, consecutiveFailures: 0, circuitOpenUntil: 0, lastError: null, lastSuccessAt: new Date().toISOString(), lastFailureAt: this.sourceHealth.get(key)?.lastFailureAt || null });\n  }\n\n  markSourceFailure(source = {}, error) {\n    const current = this.getSourceHealth(source);\n    const consecutiveFailures = Number(current.consecutiveFailures || 0) + 1;\n    const shouldOpen = consecutiveFailures >= this.sourceFailureThreshold;\n    const multiplier = shouldOpen ? Math.min(4, Math.pow(2, Math.max(0, consecutiveFailures - this.sourceFailureThreshold))) : 0;\n    const circuitOpenUntil = shouldOpen ? Date.now() + this.sourceCircuitOpenMinutes * 60000 * multiplier : 0;\n    const next = {\n      ...current,\n      key: current.key,\n      consecutiveFailures,\n      circuitOpenUntil,\n      lastError: clean(error?.message || error || 'source_failed', 300),\n      lastFailureAt: new Date().toISOString()\n    };\n    this.sourceHealth.set(current.key, next);\n    return next;\n  }\n\n  async fetchSourceWithResilience(source = {}) {\n    const start = Date.now();\n    const health = this.getSourceHealth(source);\n    if (Number(health.circuitOpenUntil || 0) > Date.now()) {\n      return {\n        id: source.definition?.id || source.type,\n        type: source.type,\n        ok: false,\n        skipped: true,\n        reason: 'circuit_open',\n        retryAt: new Date(health.circuitOpenUntil).toISOString(),\n        articleCount: 0,\n        durationMs: 0,\n        articles: []\n      };\n    }\n    try {\n      const articles = source.type === 'gdelt'\n        ? await this.fetchGdeltLane(source.definition)\n        : await this.fetchRssSource(source.definition);\n      this.markSourceSuccess(source);\n      return { id: source.definition?.id || source.type, type: source.type, ok: true, skipped: false, articleCount: articles.length, durationMs: Date.now() - start, articles };\n    } catch (error) {\n      const next = this.markSourceFailure(source, error);\n      return {\n        id: source.definition?.id || source.type,\n        type: source.type,\n        ok: false,\n        skipped: false,\n        articleCount: 0,\n        durationMs: Date.now() - start,\n        error: clean(error.message, 300),\n        circuitOpened: Number(next.circuitOpenUntil || 0) > Date.now(),\n        retryAt: Number(next.circuitOpenUntil || 0) > Date.now() ? new Date(next.circuitOpenUntil).toISOString() : null,\n        articles: []\n      };\n    }\n  }\n\n  async fetchSourcesResilient(sources = []) {\n    const queue = sources.map((source, index) => ({ source, index }));\n    const results = new Array(queue.length);\n    let cursor = 0;\n    const workerCount = Math.max(1, Math.min(this.maxConcurrentSources, queue.length || 1));\n    const workers = Array.from({ length: workerCount }, async () => {\n      while (true) {\n        const position = cursor;\n        cursor += 1;\n        if (position >= queue.length) return;\n        const item = queue[position];\n        results[item.index] = await this.fetchSourceWithResilience(item.source);\n      }\n    });\n    await Promise.all(workers);\n    return results.filter(Boolean);\n  }\n\n`;
source = insertBefore(source, "  dedupeArticles(articles) {\n", helperMethods, 'resilient source fetch helpers');

const oldFetchLoop = `    const sourceResults = [];\n    const discovered = [];\n    const sources = [\n      ...this.gdeltLanes.map(lane => ({ type: 'gdelt', definition: lane })),\n      ...this.rssSources.map(source => ({ type: 'rss', definition: source }))\n    ];\n    for (const source of sources) {\n      const start = Date.now();\n      try {\n        const articles = source.type === 'gdelt'\n          ? await this.fetchGdeltLane(source.definition)\n          : await this.fetchRssSource(source.definition);\n        discovered.push(...articles);\n        sourceResults.push({ id: source.definition.id || source.type, type: source.type, ok: true, articleCount: articles.length, durationMs: Date.now() - start });\n      } catch (error) {\n        sourceResults.push({ id: source.definition.id || source.type, type: source.type, ok: false, articleCount: 0, durationMs: Date.now() - start, error: clean(error.message, 300) });\n        this.logger.warn(\`Newsroom source \${source.definition.id || source.type} failed: \${error.message}\`);\n      }\n    }\n`;
const newFetchLoop = `    const sourceResults = [];\n    const discovered = [];\n    const sources = [\n      ...this.gdeltLanes.map(lane => ({ type: 'gdelt', definition: lane })),\n      ...this.rssSources.map(source => ({ type: 'rss', definition: source }))\n    ];\n    const fetchedSources = await this.fetchSourcesResilient(sources);\n    for (const result of fetchedSources) {\n      if (result.ok) discovered.push(...(result.articles || []));\n      const { articles, ...publicResult } = result;\n      sourceResults.push(publicResult);\n      if (!result.ok && !result.skipped) this.logger.warn(\`Newsroom source \${result.id} failed: \${result.error}\`);\n    }\n`;
source = replaceOnce(source, oldFetchLoop, newFetchLoop, 'bounded concurrent source collection');

source = replaceOnce(
  source,
  "    const failedSources = sourceResults.filter(item => !item.ok);\n",
  "    const failedSources = sourceResults.filter(item => !item.ok && !item.skipped);\n    const skippedSources = sourceResults.filter(item => item.skipped);\n",
  'failed source classification understands open circuits'
);

source = replaceOnce(
  source,
  "    const status = successfulSources.length === 0 ? 'failed' : failedSources.length ? 'partial' : 'completed';\n",
  "    const status = successfulSources.length === 0 ? 'failed' : (failedSources.length || skippedSources.length) ? 'partial' : 'completed';\n",
  'partial status understands open circuits'
);

source = replaceOnce(
  source,
  "    const error = successfulSources.length === 0 ? failedSources.map(item => \`\${item.id}: \${item.error}\`).join('; ').slice(0, 1000) : null;\n",
  "    const unavailable = [...failedSources, ...skippedSources];\n    const error = successfulSources.length === 0 ? unavailable.map(item => \`\${item.id}: \${item.error || item.reason || 'unavailable'}\`).join('; ').slice(0, 1000) : null;\n",
  'failed scan error includes skipped/open-circuit sources'
);

// Do not rewrite status() here. Later Phase 12 materializers add fields to that
// response, so source health stays observable through sourceResults and the
// sourceHealthSnapshot() runtime helper without coupling this hotfix to a stale
// status-object shape.

write(runtimePath, source);

const packagePath = path.join(upstream, 'package.json');
const pkg = JSON.parse(read(packagePath));
pkg.scripts = pkg.scripts || {};
pkg.scripts['test:newsroom-source-resilience'] = 'node ../bootstrap/verify-newsroom-source-resilience.js';
write(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

const envPath = path.join(upstream, '.env.example');
let env = read(envPath);
if (/^NEWSROOM_HTTP_TIMEOUT_MS=/m.test(env)) env = env.replace(/^NEWSROOM_HTTP_TIMEOUT_MS=.*$/m, 'NEWSROOM_HTTP_TIMEOUT_MS=4500');
else env += '\nNEWSROOM_HTTP_TIMEOUT_MS=4500\n';
if (!env.includes('NEWSROOM_SOURCE_FAILURE_THRESHOLD=')) {
  env += [
    '',
    '# Global News Radar source resilience: fail fast, stop retry storms, keep RSS fallbacks alive.',
    'NEWSROOM_SOURCE_FAILURE_THRESHOLD=2',
    'NEWSROOM_SOURCE_CIRCUIT_OPEN_MINUTES=15',
    'NEWSROOM_SOURCE_MAX_CONCURRENCY=4',
    ''
  ].join('\n');
}
write(envPath, env);

console.log('Newsroom source resilience active: failed scans honor cadence, sources fetch concurrently, GDELT has a circuit breaker, and built-in RSS fallbacks prevent a single discovery backend from stopping the newsroom.');
