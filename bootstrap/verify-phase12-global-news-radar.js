'use strict';

const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const read = rel => fs.readFileSync(path.join(upstream, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

let checks = 0;
function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(`Phase 12.1 regression: ${message}`);
}

function article(domain, title, country, minutesAgo = 5, language = 'English') {
  return {
    url: `https://${domain}/world/${encodeURIComponent(title.toLowerCase().replace(/\s+/g, '-'))}`,
    title,
    domain,
    sourcecountry: country,
    language,
    seendate: new Date(Date.now() - minutesAgo * 60000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  };
}

async function main() {
  const runtime = require(path.join(upstream, 'utils', 'global-news-radar-v121.js'));
  const {
    VERSION, GlobalNewsRadarServiceV121, canonicalUrl, normalizeTitle, tokens, countryRegion,
    parseRss, clusterArticles, sourceEvidenceUnits, scoreCluster, materialChange, editorDecision
  } = runtime;

  assert(VERSION === '12.1', 'runtime version must be 12.1');
  assert(canonicalUrl('https://example.com/a?utm_source=x&keep=1#frag') === 'https://example.com/a?keep=1', 'tracking params/hash must be stripped');
  assert(normalizeTitle('Major event changes global markets — Example News') === 'Major event changes global markets', 'publisher suffix should normalize away');
  assert(tokens('Breaking: Major event changes global markets today').includes('markets'), 'meaningful title tokens must survive');
  assert(!tokens('Breaking news update today').includes('breaking'), 'generic breaking/news tokens must not drive clusters');
  assert(countryRegion('Brazil') === 'Latin America', 'Brazil must map to Latin America');
  assert(countryRegion('Japan') === 'East Asia', 'Japan must map to East Asia');
  assert(countryRegion('Nigeria') === 'Africa', 'Nigeria must map to Africa');

  const rss = parseRss(`<?xml version="1.0"?><rss><channel><item><title><![CDATA[Global storm disrupts flights]]></title><link>https://feed.example/story?utm_source=rss</link><description>Short metadata summary.</description><pubDate>Wed, 16 Sep 2026 10:00:00 GMT</pubDate></item></channel></rss>`, { id: 'fixture', name: 'Fixture', country: 'Canada', language: 'English' });
  assert(rss.length === 1, 'RSS parser must parse one item');
  assert(rss[0].url === 'https://feed.example/story', 'RSS URL must be canonicalized');
  assert(rss[0].sourceRegion === 'North America', 'RSS source geography must normalize');
  assert(rss[0].summary === 'Short metadata summary.', 'RSS should keep only feed-provided summary metadata');

  const now = new Date();
  const storyArticles = [
    ['alpha.example', 'Powerful storm disrupts major Atlantic flight routes', 'United States'],
    ['bravo.example', 'Major Atlantic flight routes disrupted by powerful storm', 'United Kingdom'],
    ['charlie.example', 'Powerful Atlantic storm disrupts international flight routes', 'Brazil'],
    ['delta.example', 'International flight routes disrupted as powerful Atlantic storm grows', 'Japan'],
    ['echo.example', 'Powerful storm grows and disrupts Atlantic flight routes', 'Nigeria'],
    ['foxtrot.example', 'Atlantic flight routes face disruption from powerful storm', 'India'],
    ['golf.example', 'Powerful Atlantic storm causes widespread flight route disruption', 'France'],
    ['hotel.example', 'Flight routes disrupted across Atlantic by powerful storm', 'Australia']
  ].map(([domain, title, country], index) => ({
    id: `a${index}`, url: `https://${domain}/story/${index}`, title, sourceDomain: domain,
    sourceName: domain, sourceCountry: country, sourceRegion: countryRegion(country), language: 'English',
    publishedAt: new Date(now.getTime() - (5 + index) * 60000).toISOString(), seenAt: now.toISOString()
  }));
  const distinct = {
    id: 'other', url: 'https://other.example/tech', title: 'Chipmaker launches new mobile processor architecture',
    sourceDomain: 'other.example', sourceName: 'other.example', sourceCountry: 'South Korea', sourceRegion: 'East Asia', language: 'English',
    publishedAt: new Date(now.getTime() - 8 * 60000).toISOString(), seenAt: now.toISOString()
  };
  const clustered = clusterArticles([...storyArticles, distinct], 0.36);
  assert(clustered.length >= 2, 'unrelated technology story must not merge into storm story');
  const storm = clustered.sort((a, b) => b.articles.length - a.articles.length)[0];
  assert(storm.articles.length >= 7, 'headline variants of the same event must cluster together');

  const copies = ['one.example','two.example','three.example','four.example'].map((domain, index) => ({
    sourceDomain: domain, title: 'Wire Service: Central bank holds rates unchanged', publishedAt: new Date(now.getTime() - index * 60000).toISOString()
  }));
  assert(sourceEvidenceUnits(copies) === 1, 'exact syndicated headline copies must count as one independent evidence unit');
  assert(sourceEvidenceUnits(storyArticles) >= 3, 'meaningfully different outlet headlines must provide multiple coverage evidence units');

  const scored = scoreCluster(storm, now, 6);
  assert(scored.globalScore >= 0 && scored.globalScore <= 100, 'global repercussion score must be bounded');
  assert(scored.confidenceScore >= 0 && scored.confidenceScore <= 100, 'coverage-confidence score must be bounded');
  assert(scored.sourceCount >= 7, 'source breadth must count independent domains');
  assert(scored.regionCount >= 4, 'geographic diversity must count source regions');
  assert(scored.velocityScore >= 65, 'rapid fixture must register high coverage velocity');
  assert(scored.freshnessScore >= 90, 'fresh fixture must register high freshness');
  assert(scored.sourceBreadthScore > 0 && scored.geographyScore > 0 && scored.volumeScore > 0, 'component scores must be reported');

  storm.scores = scored;
  storm.materialChange = { changed: true, reason: 'new_cluster' };
  const strongDecision = editorDecision(storm, null, { minIndependentSources: 3, minConfidence: 50, breakingThreshold: 82, coverThreshold: 60, followUpThreshold: 55 });
  assert(['COVER','BREAKING'].includes(strongDecision.action), 'fresh globally broad multi-source event must be actionable');
  assert(strongDecision.rationale.includes('Global repercussion'), 'editor rationale must expose auditable score language');

  const weakCluster = { ...storm, scores: { ...scored, globalScore: 70, confidenceScore: 20, independentEvidenceUnits: 1, sourceCount: 1, regionCount: 1, velocityScore: 20, velocityLevel: 'stable' } };
  const weakDecision = editorDecision(weakCluster, null, { minIndependentSources: 3, minConfidence: 58, coverThreshold: 60, followUpThreshold: 50 });
  assert(weakDecision.action === 'WAIT', 'single-source high-looking story must wait instead of becoming actionable');

  const prior = { status: 'assigned', topic_tokens_json: JSON.stringify(storm.topicTokens), global_score: scored.globalScore, article_count: scored.articleCount };
  const unchanged = materialChange(prior, storm.topicTokens, scored);
  assert(unchanged.changed === false, 'same material fingerprint semantics must not invent an update');
  const existingUnchanged = editorDecision({ ...storm, materialChange: unchanged }, prior, { minIndependentSources: 3, minConfidence: 50, breakingThreshold: 82, coverThreshold: 60, followUpThreshold: 50 });
  assert(existingUnchanged.action === 'IGNORE', 'already assigned story with no material change must not create duplicate coverage');

  const changedTokens = [...storm.topicTokens, 'evacuation', 'airport', 'closure', 'emergency'];
  const changedScores = { ...scored, globalScore: Math.max(84, scored.globalScore), articleCount: scored.articleCount + 5 };
  const changed = materialChange(prior, changedTokens, changedScores);
  assert(changed.changed === true, 'substantive new terms/coverage acceleration must register material change');
  const updateDecision = editorDecision({ ...storm, topicTokens: changedTokens, materialChange: changed, scores: changedScores }, prior, { minIndependentSources: 3, minConfidence: 50, breakingThreshold: 82, coverThreshold: 60, followUpThreshold: 50 });
  assert(['UPDATE','FOLLOW_UP'].includes(updateDecision.action), 'material development on an assigned story must become update/follow-up');

  let calls = 0;
  let release;
  const blockingHttp = { get: async () => { calls += 1; await new Promise(resolve => { release = resolve; }); return { data: { articles: [] } }; } };
  const lockedService = new GlobalNewsRadarServiceV121(null, { http: blockingHttp, gdeltLanes: [{ id: 'lock', query: 'sourcelang:english', maxRecords: 10 }], rssSources: [], autoPromote: false });
  const firstScan = lockedService.scanAndDecide({ autoPromote: false });
  await new Promise(resolve => setTimeout(resolve, 10));
  const overlap = await lockedService.scanIfDue({ autoPromote: false });
  assert(overlap.skipped === true && overlap.reason === 'scan_in_progress', 'overlapping scan must fail safe as scan_in_progress');
  assert(calls === 1, 'single-flight lock must prevent a second outbound source request');
  release();
  await firstScan;

  const gdeltArticles = storyArticles.map((item, index) => article(item.sourceDomain, item.title, item.sourceCountry, 3 + index));
  const partialHttp = {
    get: async (url, options) => {
      if (String(url).includes('broken.example')) throw new Error('fixture RSS offline');
      return { data: { articles: gdeltArticles } };
    }
  };
  const service = new GlobalNewsRadarServiceV121(null, {
    http: partialHttp,
    gdeltLanes: [{ id: 'fixture-global', query: 'sourcelang:english', maxRecords: 30 }],
    rssSources: [{ id: 'fixture-rss', url: 'https://broken.example/feed.xml', country: 'Canada', language: 'English' }],
    autoPromote: false,
    coverThreshold: 55,
    minConfidence: 45
  });
  const scan = await service.scanAndDecide({ autoPromote: false });
  assert(scan.status === 'partial', 'one healthy and one failed discovery source must degrade to partial, not crash');
  assert(scan.articleCount === gdeltArticles.length, 'successful discovery lane must still contribute articles during partial scan');
  assert(scan.clusterCount >= 1, 'scan must produce clusters from successful source');
  assert(Array.isArray(scan.topClusters), 'scan must return inspectable ranked clusters');
  assert(scan.sourceResults.some(item => item.ok === false), 'source failures must be auditable in scan result');

  const dbSource = read('database/db.js');
  for (const table of ['global_news_scans','global_news_articles','global_news_clusters','global_news_editor_decisions','global_news_assignments']) {
    assert(dbSource.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `database must materialize ${table}`);
  }
  assert(dbSource.includes('CHECK(action IN (\'COVER\',\'WAIT\',\'IGNORE\',\'UPDATE\',\'BREAKING\',\'FOLLOW_UP\'))'), 'editor action enum must be constrained in SQLite');
  assert(dbSource.includes('decision_fingerprint TEXT NOT NULL UNIQUE'), 'editor decisions must be idempotent by fingerprint');

  const index = read('index.js');
  assert(index.includes("const { GlobalNewsRadarServiceV121 } = require('./utils/global-news-radar-v121');"), 'main runtime must import newsroom service');
  assert(index.includes('this.globalNewsRadarService = new GlobalNewsRadarServiceV121(this.db'), 'newsroom service must initialize against real database');
  assert(index.includes('newsroom: this.globalNewsRadarService'), 'scheduler must receive newsroom service');
  for (const route of [
    "'/api/newsroom/config', protect", "'/api/newsroom/status', protect", "'/api/newsroom/scan', protect",
    "'/api/newsroom/clusters', protect", "'/api/newsroom/clusters/:clusterId', protect",
    "'/api/newsroom/decisions', protect", "'/api/newsroom/decisions/:decisionId/promote', protect"
  ]) assert(index.includes(route), `protected newsroom API missing: ${route}`);

  const scheduler = read('schedules/daily-automation.js');
  assert(scheduler.includes("this.scheduledTasks.set('global-news-radar'"), 'scheduler must install global-news-radar task');
  assert(scheduler.includes("cron.schedule('* * * * *'"), 'scheduler wake-up cadence must support due-gated scans');
  assert(scheduler.includes('await this.newsroom.scanIfDue({ autoPromote: true })'), 'scheduler must use due-gated newsroom scan');
  assert(scheduler.includes("this.logger.error('Global News Radar failed:'"), 'scheduler must contain newsroom failures instead of crashing process');

  const serviceSource = read('utils/global-news-radar-v121.js');
  assert(serviceSource.includes('this.activeScan = null;'), 'runtime must hold single-flight scan state');
  assert(serviceSource.includes("reason: 'scan_in_progress'"), 'runtime must expose non-fatal overlap result');
  assert(serviceSource.includes("'https://api.gdeltproject.org/api/v2/doc/doc'"), 'default discovery adapter must point at GDELT DOC API');
  assert(serviceSource.includes("mode: 'ArtList'"), 'GDELT adapter must use article-list metadata mode');
  assert(!serviceSource.includes('articleBody'), 'newsroom discovery must not persist copied full article bodies');
  assert(serviceSource.includes('NEWSROOM_RSS_SOURCES_JSON'), 'operator may configure additional permitted RSS sources explicitly');
  assert(serviceSource.includes("status: 'backlog'"), 'autonomous promotion must stop at backlog instead of bypassing quality/publication gates');

  const env = read('.env.example');
  for (const key of ['NEWSROOM_ENABLED=true','NEWSROOM_SCAN_INTERVAL_MINUTES=10','NEWSROOM_LOOKBACK_HOURS=6','NEWSROOM_MIN_INDEPENDENT_SOURCES=3','NEWSROOM_AUTO_PROMOTE=true','NEWSROOM_RSS_SOURCES_JSON=[]']) {
    assert(env.includes(key), `env contract missing ${key}`);
  }

  const html = read('dashboard/index.html');
  assert(html.includes('data-view="newsroom"'), 'dashboard must expose Global newsroom navigation');
  assert(html.includes('id="newsroom-view"'), 'dashboard must contain newsroom view');
  assert(html.includes('id="newsroom-scan-button"'), 'dashboard must expose explicit manual scan control');
  const dashboardClientPath = html.includes('<script src="/newsroom-v122.js" defer></script>') ? 'dashboard/newsroom-v122.js' : 'dashboard/newsroom-v121.js';
  assert(html.includes('<script src="/newsroom-v121.js" defer></script>') || html.includes('<script src="/newsroom-v122.js" defer></script>'), 'dashboard must load a compatible newsroom client');
  const app = read('dashboard/app.js');
  assert(app.includes("newsroom: ['GLOBAL NEWSROOM', 'See what the world is talking about.']"), 'dashboard view title must register newsroom');
  const dashboardClient = read(dashboardClientPath);
  assert(dashboardClient.includes("api('/api/newsroom/status')"), 'newsroom UI must read live status API');
  assert(dashboardClient.includes("api('/api/newsroom/scan'"), 'newsroom UI must run live scan API');
  assert(dashboardClient.includes('data-newsroom-promote'), 'newsroom UI must support audited manual promotion');

  const pkg = JSON.parse(read('package.json'));
  assert(pkg.scripts?.['test:global-news-radar'] === 'node ../bootstrap/verify-phase12-global-news-radar.js', 'package must expose dedicated 12.1 regression command');

  console.log(`Phase 12.1 Global News Radar + Autonomous Editor verified: ${checks} checks passed.`);
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
