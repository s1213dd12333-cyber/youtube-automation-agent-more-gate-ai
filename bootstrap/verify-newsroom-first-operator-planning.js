'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');

function read(rel) {
  return fs.readFileSync(path.join(upstream, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

(async () => {
  const strategySource = read('agents/content-strategy-agent.js');
  const operatorSource = read('utils/autonomous-channel-operator.js');
  const dashboardSource = read('dashboard/app.js');

  assert(strategySource.includes('isNewsChannelStrategy(channelStrategy = {})'), 'news strategy classifier must be materialized');
  assert(strategySource.includes('Global Newsroom verified assignments'), 'news planner must prioritize newsroom assignments');
  assert(strategySource.includes('will wait rather than fill a news channel with generic evergreen topics'), 'news planner must fail safe instead of using evergreen filler');
  assert(strategySource.includes('Math.min(12, Number(channelStrategy.videos_per_run || 1))'), 'planner batch cap must match 12-video strategy limit');
  assert(operatorSource.includes("stage: 'waiting_for_verified_news'"), 'operator must expose a non-failure hold state when no verified news is ready');
  assert(operatorSource.includes('record?.ideaId || item.ideaId || null'), 'operator must reuse promoted newsroom content ideas');
  assert(dashboardSource.includes("job?.error ? '<p class=\"callout\">' + escapeHTML(job.error) + '</p>' : ''"), 'operator UI must show each generation error');

  const { ContentStrategyAgent } = require(path.join(upstream, 'agents', 'content-strategy-agent.js'));
  const agent = Object.create(ContentStrategyAgent.prototype);
  agent.logger = { info() {}, warn() {}, error() {} };
  agent.trendingTopics = [];
  agent.competitorData = [];
  agent.analyzeTrends = async () => {
    agent.trendingTopics = [{
      topic: 'Science mysteries',
      score: 100,
      sources: ['trending'],
      evidence: [{ url: 'https://youtube.example/video', title: 'Generic trend' }]
    }];
  };
  agent.generateAutonomousPlanWithAI = async () => {
    throw new Error('AI planner must not run for a newsroom-first news strategy');
  };
  agent.db = {
    async getAllRows(sql) {
      if (sql.includes('FROM content_strategies')) return [];
      if (sql.includes('FROM global_news_assignments')) {
        return [{
          id: 'news_assignment_test',
          idea_id: 'idea_news_test',
          topic: 'Verified global development',
          angle: 'Explain what is confirmed, uncertain, and why it matters.',
          format: 'explainer',
          source_urls_json: JSON.stringify([
            'https://source-a.example/report',
            'https://source-b.example/report',
            'https://source-c.example/report'
          ]),
          source_domains_json: JSON.stringify(['source-a.example','source-b.example','source-c.example']),
          created_at: new Date().toISOString(),
          newsroom_action: 'COVER',
          newsroom_rationale: 'Selected after corroborated newsroom review.'
        }];
      }
      return [];
    },
    async listLearningRecommendations() { return []; }
  };

  const strategy = {
    objective: 'Build an autonomous global news channel that discovers and verifies world events.',
    audience: 'Adults interested in major world events and global developments.',
    value_proposition: 'Clear, well-sourced global news reports.',
    contentPillars: ['World News', 'Science and Technology'],
    videos_per_run: 5,
    default_format: 'explainer',
    default_length: 'medium',
    primary_kpi: 'watch_hours',
    constraints: 'Never publish unverified news.'
  };

  assert.strictEqual(agent.isNewsChannelStrategy(strategy), true, 'configured global-news strategy must be detected as news');

  const planned = await agent.researchAndPlanChannel(strategy);
  assert.strictEqual(planned.plan.length, 1, 'news channel must use only available verified newsroom assignments');
  assert.strictEqual(planned.plan[0].topic, 'Verified global development', 'generic YouTube trend must not displace newsroom assignment');
  assert.strictEqual(planned.plan[0].ideaId, 'idea_news_test', 'promoted newsroom idea id must survive plan normalization');
  assert.strictEqual(planned.plan[0].newsroomAssignmentId, 'news_assignment_test', 'assignment provenance must survive normalization');
  assert.strictEqual(planned.plan[0].sourceUrls.length, 3, 'verified newsroom source URLs must reach the generation plan');
  assert(planned.research.sources.includes('Global Newsroom verified assignments'), 'research summary must identify Global Newsroom as source');

  const holdAgent = Object.create(ContentStrategyAgent.prototype);
  holdAgent.logger = { info() {}, warn() {}, error() {} };
  holdAgent.trendingTopics = [];
  holdAgent.competitorData = [];
  holdAgent.analyzeTrends = async () => {
    holdAgent.trendingTopics = [{ topic: 'Hidden history', score: 90, sources: ['trending'], evidence: [] }];
  };
  holdAgent.generateAutonomousPlanWithAI = async () => [{ topic: 'Should never be used' }];
  holdAgent.db = {
    async getAllRows(sql) {
      if (sql.includes('FROM content_strategies')) return [];
      if (sql.includes('FROM global_news_assignments')) return [];
      return [];
    },
    async listLearningRecommendations() { return []; }
  };

  const held = await holdAgent.researchAndPlanChannel(strategy);
  assert.strictEqual(held.plan.length, 0, 'news channel without verified newsroom assignments must not receive evergreen filler');
  assert(held.research.holdReason && held.research.holdReason.includes('No verified Global Newsroom story'), 'safe hold reason must be explicit');

  console.log('Newsroom-first autonomous operator planning verification passed.');
})().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
