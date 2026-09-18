'use strict';
const assert = require('assert');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');

(async () => {
  const { YouTubeAutomationAgent } = require(path.join(upstream, 'index.js'));
  const proto = YouTubeAutomationAgent.prototype;

  const validated = proto.validateChannelStrategy.call({}, {
    objective: 'Build an autonomous global news channel that discovers, verifies, explains, produces and publishes major developments around the world. Target one approved video every 2 hours.',
    audience: 'Adults interested in major world events, science, technology, economy, geopolitics, natural disasters, space, public health and important global developments.',
    valueProposition: 'Turn complex global events into clear, engaging and well-sourced video reports.',
    contentPillars: ['Science mysteries','Future technology','Hidden history','Space and universe','Unexplained phenomena','Human psychology','Extraordinary places','Surprising facts'],
    cadencePerWeek: 7,
    videosPerRun: 5,
    defaultFormat: 'explainer',
    defaultLength: 'medium',
    primaryKpi: 'watch_hours',
    targetValue: 100,
    targetWindowDays: 28,
    outcomeCurrency: 'USD',
    constraints: 'Remain neutral and factual. Never publish unsupported claims.',
    status: 'active'
  }, {});
  const normalized = proto.normalizeNewsStrategyIntent(validated);
  assert.strictEqual(normalized.cadencePerWeek, 84, 'explicit every-two-hours news objective must normalize to 84/week');
  assert.strictEqual(normalized.videosPerRun, 1, 'high-frequency news must plan one fresh video at a time');
  assert(normalized.contentPillars.includes('World News'), 'legacy curiosity pillars must be replaced for explicit global-news intent');
  assert(normalized.contentPillars.includes('International Conflicts and Diplomacy'), 'news pillar set must cover major global developments');
  assert(!normalized.contentPillars.includes('Hidden history'), 'legacy curiosity-only pillars must not survive explicit global-news normalization');

  const { ContentStrategyAgent } = require(path.join(upstream, 'agents', 'content-strategy-agent.js'));
  const agent = Object.create(ContentStrategyAgent.prototype);
  agent.logger = { info() {}, warn() {}, error() {} };
  agent.trendingTopics = [];
  agent.competitorData = [];
  agent.analyzeTrends = async () => { agent.trendingTopics = []; };
  agent.generateAutonomousPlanWithAI = async () => { throw new Error('newsroom-first flow must not invoke generic AI planning'); };

  const articles = {
    a1: { id:'a1', url:'https://alpha.example/world-event', title:'Global event develops after overnight decision', summary:'Officials confirmed the overnight decision and immediate response.', source_name:'Alpha News', source_domain:'alpha.example', published_at:new Date().toISOString() },
    a2: { id:'a2', url:'https://bravo.example/world-event', title:'Overnight decision triggers international response', summary:'A second independent newsroom reports the same decision and response.', source_name:'Bravo News', source_domain:'bravo.example', published_at:new Date().toISOString() }
  };
  agent.db = {
    async getAllRows(sql) {
      if (sql.includes('FROM content_strategies')) return [];
      if (sql.includes('FROM global_news_assignments')) return [];
      if (sql.includes('FROM global_news_clusters')) return [{
        id:'cluster_test', canonical_title:'Overnight global decision draws international response',
        source_count:2, independent_evidence_units:2, confidence_score:55, global_score:62, freshness_score:96,
        article_ids_json:JSON.stringify(['a1','a2']), last_seen_at:new Date().toISOString()
      }];
      return [];
    },
    async getRow(sql, params) {
      if (sql.includes('FROM global_news_articles')) return articles[params[0]] || null;
      return null;
    },
    async listLearningRecommendations() { return []; }
  };

  const strategy = {
    objective: normalized.objective, audience: normalized.audience, value_proposition: normalized.valueProposition,
    contentPillars: normalized.contentPillars, videos_per_run: 1, default_format:'explainer', default_length:'medium',
    primary_kpi:'watch_hours', constraints:normalized.constraints
  };
  const planned = await agent.researchAndPlanChannel(strategy);
  assert.strictEqual(planned.plan.length, 1, 'zero assignments with a two-source fresh cluster must create one deep-research candidate');
  assert.strictEqual(planned.plan[0].newsroomAction, 'RESEARCH_CANDIDATE');
  assert.strictEqual(planned.plan[0].requiresNewsCorroboration, true);
  assert.deepStrictEqual(new Set(planned.plan[0].newsroomCandidateDomains), new Set(['alpha.example','bravo.example']));
  assert.strictEqual(planned.plan[0].sourceUrls.length, 2, 'candidate must carry both independent newsroom URLs');
  assert(planned.research.sources.includes('Global Newsroom multi-source candidate'), 'run summary must explain that a research candidate is being investigated');

  const candidateStrategy = {
    requiresNewsCorroboration:true,
    newsroomCandidateDomains:['alpha.example','bravo.example']
  };
  assert.strictEqual(proto.assertNewsResearchCorroboration({ sources:[
    { url:'https://alpha.example/world-event', status:'verified', evidenceText:'confirmed facts from Alpha' },
    { url:'https://bravo.example/world-event', status:'verified', evidenceText:'independent corroboration from Bravo' }
  ]}, candidateStrategy), true, 'two candidate domains must pass pre-script corroboration');

  let blocked = null;
  try {
    proto.assertNewsResearchCorroboration({ sources:[
      { url:'https://alpha.example/world-event', status:'verified', evidenceText:'only one source' }
    ]}, candidateStrategy);
  } catch (error) { blocked = error; }
  assert(blocked, 'single-domain candidate must fail closed before scripting');
  assert.strictEqual(blocked.code, 'NEWS_RESEARCH_INSUFFICIENT_CORROBORATION');

  const emptyAgent = Object.create(ContentStrategyAgent.prototype);
  emptyAgent.logger = { info() {}, warn() {}, error() {} };
  emptyAgent.trendingTopics = []; emptyAgent.competitorData = [];
  emptyAgent.analyzeTrends = async () => {};
  emptyAgent.generateAutonomousPlanWithAI = async () => [];
  emptyAgent.db = {
    async getAllRows(sql) { return []; },
    async getRow() { return null; },
    async listLearningRecommendations() { return []; }
  };
  const held = await emptyAgent.researchAndPlanChannel(strategy);
  assert.strictEqual(held.plan.length, 0, 'news channel still waits when there is not even a multi-source candidate');
  assert(held.research.holdReason.includes('multi-source research candidate'), 'hold reason must explain the exact missing gate');

  console.log('Global news end-to-end verification passed: strategy self-heals, multi-source candidates enter deep research, and single-source scripting remains blocked.');
})().catch(error => { console.error(error.stack || error.message || String(error)); process.exit(1); });
