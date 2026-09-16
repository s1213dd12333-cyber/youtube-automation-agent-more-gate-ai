'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const read = rel => fs.readFileSync(path.join(upstream, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

function includesAll(text, needles, label) {
  for (const needle of needles) assert(text.includes(needle), `${label} missing: ${needle}`);
}

function testCluster(id, title, language, extra = {}) {
  const articles = extra.articles || [
    { id: `${id}_a1`, title, sourceDomain: 'source-a.example', sourceCountry: 'Brazil', sourceRegion: 'South America', language, publishedAt: '2026-09-16T12:00:00.000Z' },
    { id: `${id}_a2`, title, sourceDomain: 'source-b.example', sourceCountry: 'United States', sourceRegion: 'North America', language, publishedAt: '2026-09-16T12:02:00.000Z' },
    { id: `${id}_a3`, title, sourceDomain: 'source-c.example', sourceCountry: 'France', sourceRegion: 'Europe', language, publishedAt: '2026-09-16T12:04:00.000Z' }
  ];
  return {
    id,
    canonicalTitle: title,
    firstSeen: extra.firstSeen || '2026-09-16T12:00:00.000Z',
    lastSeenAt: extra.lastSeenAt || '2026-09-16T12:05:00.000Z',
    articles,
    scores: {
      confidenceScore: extra.confidenceScore || 84,
      sourceCount: articles.length,
      articleCount: articles.length,
      globalScore: extra.globalScore || 74,
      regionCount: 3,
      independentEvidenceUnits: 3,
      velocityScore: 70
    }
  };
}

async function main() {
  const servicePath = path.join(upstream, 'utils', 'event-intelligence-engine-v122.js');
  const radarPath = path.join(upstream, 'utils', 'global-news-radar-v121.js');
  const indexPath = path.join(upstream, 'index.js');
  const dbPath = path.join(upstream, 'database', 'db.js');
  const dashboardPath = path.join(upstream, 'dashboard', 'newsroom-v122.js');

  for (const file of [servicePath, radarPath, indexPath, dbPath, dashboardPath]) {
    assert(fs.existsSync(file), `missing materialized file: ${file}`);
    if (file.endsWith('.js')) childProcess.execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }

  const serviceSource = read('utils/event-intelligence-engine-v122.js');
  const radarSource = read('utils/global-news-radar-v121.js');
  const indexSource = read('index.js');
  const dbSource = read('database/db.js');
  const htmlSource = read('dashboard/index.html');
  const packageSource = read('package.json');
  const envSource = read('.env.example');

  includesAll(dbSource, [
    'CREATE TABLE IF NOT EXISTS global_news_events',
    'CREATE TABLE IF NOT EXISTS global_news_event_revisions',
    'CREATE TABLE IF NOT EXISTS global_news_event_cluster_links',
    'CREATE TABLE IF NOT EXISTS global_news_event_relations',
    'CREATE TABLE IF NOT EXISTS global_news_event_assignments',
    "CHECK(relation_type IN ('related_to','follow_up_of'))",
    "CHECK(change_kind IN ('new_event','observation','material_update','escalation','resolution','correction'))"
  ], 'Event Intelligence DB');

  includesAll(serviceSource, [
    "const VERSION = '12.2'",
    'NEWSROOM_EVENT_MATCH_THRESHOLD',
    'NEWSROOM_EVENT_AMBIGUITY_MARGIN',
    'ambiguous',
    'BEGIN IMMEDIATE',
    'event_revision_conflict',
    'event_current_state_drift',
    "relationType === 'follow_up_of'",
    "'related_to'",
    'canonicalConcepts',
    'languageVariants'
  ], 'Event Intelligence service');

  includesAll(radarSource, [
    "require('./event-intelligence-engine-v122')",
    'this.eventIntelligence',
    'analyzeCluster(cluster, { scanId })',
    'event?.previousAssigned',
    'recordAssignment(event.id, decision.id, promotion)',
    'eventIntelligence: this.eventIntelligence?.getConfig?.()'
  ], 'Global News Radar integration');

  includesAll(indexSource, [
    "'/api/newsroom/events'",
    "'/api/newsroom/events/:eventId'",
    "'/api/newsroom/events/:eventId/timeline'",
    "'/api/newsroom/events/:eventId/relations'",
    "'/api/newsroom/events/:eventId/validate'",
    'protect'
  ], 'Event Intelligence API');

  includesAll(htmlSource, ['EVENT INTELLIGENCE', 'Persistent events', 'Evolution timeline', '/newsroom-v122.js'], 'Event Intelligence dashboard');
  assert(JSON.parse(packageSource).scripts['test:event-intelligence'], 'missing npm event intelligence verifier script');
  includesAll(envSource, ['NEWSROOM_EVENT_INTELLIGENCE_ENABLED=true', 'NEWSROOM_EVENT_MATCH_THRESHOLD=0.62', 'NEWSROOM_EVENT_AMBIGUITY_MARGIN=0.08', 'NEWSROOM_EVENT_RELATION_THRESHOLD=0.44'], 'Event Intelligence env');

  const { EventIntelligenceEngineV122, buildDescriptor, matchDescriptors, classifyEvolution } = require(servicePath);
  const { Database } = require(dbPath);

  const english = buildDescriptor(testCluster('unit_en', 'OpenAI announces Nova model in Brazil', 'English'));
  const portuguese = buildDescriptor(testCluster('unit_pt', 'OpenAI anuncia modelo Nova no Brasil', 'Portuguese'));
  const multilingualMatch = matchDescriptors(english, portuguese);
  assert(multilingualMatch.score >= 0.62, `expected multilingual same-event match >= 0.62, got ${multilingualMatch.score}`);
  assert(english.concepts.includes('announce') && portuguese.concepts.includes('announce'), 'multilingual concept normalization failed');
  assert(english.locations.includes('Brazil') && portuguese.locations.includes('Brazil'), 'multilingual location normalization failed');

  const distinct = buildDescriptor(testCluster('unit_fr', 'OpenAI opens office in France', 'English'));
  assert(matchDescriptors(english, distinct).score < 0.62, 'same actor must not be enough to merge distinct events');
  assert(classifyEvolution(english, portuguese).kind === 'observation', 'translation-only coverage must not become a material update');

  const tempDb = path.join(os.tmpdir(), `agenttube-event-intel-${process.pid}-${Date.now()}.db`);
  const db = new Database();
  db.dbPath = tempDb;
  await db.initialize();
  const engine = new EventIntelligenceEngineV122(db, { matchThreshold: 0.62, ambiguityMargin: 0.08, relationThreshold: 0.44, recentDays: 14 });

  const scanId = 'scan_event_intel_fixture';
  await db.executeQuery(`INSERT INTO global_news_scans (id, status, started_at, completed_at, config_json) VALUES (?, 'completed', ?, ?, '{}')`, [scanId, '2026-09-16T11:59:00.000Z', '2026-09-16T12:30:00.000Z']);

  async function insertCluster(cluster) {
    await db.executeQuery(
      `INSERT INTO global_news_clusters (id, cluster_key, canonical_title, status, first_seen_at, last_seen_at, last_material_change, material_fingerprint, last_scan_id) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      [cluster.id, cluster.id, cluster.canonicalTitle, cluster.firstSeen, cluster.lastSeenAt, cluster.lastSeenAt, `fp_${cluster.id}`, scanId]
    );
  }

  const c1 = testCluster('cluster_event_en', 'OpenAI announces Nova model in Brazil', 'English');
  await insertCluster(c1);
  const e1 = await engine.analyzeCluster(c1, { scanId });
  assert(e1?.id, 'new cluster must create persistent event');
  assert.strictEqual(e1.changeClassification.kind, 'new_event');
  assert.strictEqual(e1.revisionNumber, 1);

  const c2 = testCluster('cluster_event_pt', 'OpenAI anuncia modelo Nova no Brasil', 'Portuguese', { lastSeenAt: '2026-09-16T12:10:00.000Z' });
  await insertCluster(c2);
  const e2 = await engine.analyzeCluster(c2, { scanId });
  assert.strictEqual(e2.id, e1.id, 'cross-language coverage must preserve stable event identity');
  assert.strictEqual(e2.changeClassification.kind, 'observation', 'cross-language restatement must remain an observation');
  assert.strictEqual(e2.revisionNumber, 2);

  const c3 = testCluster('cluster_event_distinct', 'OpenAI opens office in France', 'English', { lastSeenAt: '2026-09-16T12:15:00.000Z' });
  await insertCluster(c3);
  const e3 = await engine.analyzeCluster(c3, { scanId });
  assert.notStrictEqual(e3.id, e1.id, 'same organization must not collapse unrelated events');

  const c4 = testCluster('cluster_event_update', 'OpenAI launches Nova model in Brazil with 1 million users', 'English', { lastSeenAt: '2026-09-16T12:20:00.000Z' });
  await insertCluster(c4);
  const e4 = await engine.analyzeCluster(c4, { scanId });
  assert.strictEqual(e4.id, e1.id, 'material development must stay on the same event timeline');
  assert.strictEqual(e4.changeClassification.kind, 'material_update');
  assert(e4.changeClassification.newNumbers.length >= 1, 'material update should record newly introduced numbers');

  await db.executeQuery(
    `INSERT INTO global_news_editor_decisions (id, cluster_id, scan_id, action, rationale, material_fingerprint, decision_fingerprint) VALUES ('decision_event_fixture', ?, ?, 'COVER', 'fixture decision', 'fixture_material', 'fixture_decision_fp')`,
    [c4.id, scanId]
  );
  await engine.recordAssignment(e1.id, 'decision_event_fixture', { assignmentId: null, ideaId: null });

  const c5 = testCluster('cluster_event_correction', 'Correction: OpenAI clarifies Nova model launch in Brazil affects 800000 users', 'English', { lastSeenAt: '2026-09-16T12:25:00.000Z' });
  await insertCluster(c5);
  const e5 = await engine.analyzeCluster(c5, { scanId });
  assert.strictEqual(e5.id, e1.id, 'correction must remain attached to the existing event');
  assert.strictEqual(e5.changeClassification.kind, 'correction');
  assert.strictEqual(e5.previousAssigned, true, 'event-level assignment memory must survive cluster changes');

  const timeline = await engine.listTimeline(e1.id, 20);
  assert(timeline.length >= 4, 'event timeline must be append-only across observations and updates');
  assert(timeline.some(item => item.changeKind === 'material_update'), 'timeline missing material update');
  assert(timeline.some(item => item.changeKind === 'correction'), 'timeline missing correction');

  const eventDetail = await engine.getEvent(e1.id);
  assert(eventDetail.languages.some(value => /Portuguese/i.test(value)), 'event must retain multilingual coverage variants');
  assert(eventDetail.links.length >= 4, 'event must preserve exact cluster linkage history');
  assert(eventDetail.assignments.length === 1, 'event assignment linkage must be idempotent');

  const validation = await engine.validateEvent(e1.id);
  assert.strictEqual(validation.valid, true, `event validation blockers: ${(validation.blockers || []).join(', ')}`);

  const ambiguousDescriptor = buildDescriptor(testCluster('ambiguous_probe', 'Acme announces Atlas model in Canada', 'English'));
  for (const suffix of ['a','b']) {
    const cid = `cluster_ambiguous_${suffix}`;
    const c = testCluster(cid, 'Acme announces Atlas model in Canada', 'English');
    await insertCluster(c);
    const eid = `news_event_ambiguous_${suffix}`;
    const sig = { entities: ambiguousDescriptor.entities, locations: ambiguousDescriptor.locations, concepts: ambiguousDescriptor.concepts, numbers: ambiguousDescriptor.numbers, titleTokens: ambiguousDescriptor.titleTokens, fingerprint: `ambiguous_${suffix}` };
    await db.executeQuery(
      `INSERT INTO global_news_events (id, canonical_title, status, first_seen_at, last_seen_at, revision_number, signature_json, entities_json, locations_json, concepts_json, numbers_json, languages_json, title_variants_json, descriptor_fingerprint, primary_cluster_id, latest_cluster_id) VALUES (?, ?, 'active', ?, ?, 1, ?, ?, ?, ?, ?, '["English"]', ?, ?, ?, ?)`,
      [eid, c.canonicalTitle, c.firstSeen, c.lastSeenAt, JSON.stringify(sig), JSON.stringify(sig.entities), JSON.stringify(sig.locations), JSON.stringify(sig.concepts), JSON.stringify(sig.numbers), JSON.stringify([c.canonicalTitle]), `ambiguous_${suffix}`, cid, cid]
    );
  }
  const ambiguous = await engine.findMatch(ambiguousDescriptor);
  assert.strictEqual(ambiguous.event, null, 'ambiguous event identity must fail closed instead of merging');
  assert.strictEqual(ambiguous.ambiguous, true, 'ambiguous match should be explicit');

  const radarModule = require(radarPath);
  assert(radarModule.GlobalNewsRadarServiceV121, 'patched Global News Radar export missing');
  const radar = new radarModule.GlobalNewsRadarServiceV121(db, {
    http: { get: async () => ({ data: { articles: [] } }) },
    gdeltLanes: [], rssSources: [], autoPromote: false,
    eventIntelligence: engine
  });
  const status = await radar.status();
  assert(Array.isArray(status.events) && status.events.length >= 3, 'newsroom status must expose persistent events');
  assert.strictEqual(status.eventIntelligence.version, '12.2');

  await db.close();
  try { fs.unlinkSync(tempDb); } catch (_error) {}

  console.log('Phase 12.2 verifier passed: stable multilingual event identity, append-only evolution, fail-closed ambiguity, assignment continuity, protected APIs and newsroom integration are valid.');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
