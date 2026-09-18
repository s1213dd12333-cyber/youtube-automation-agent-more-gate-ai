'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const read = rel => fs.readFileSync(path.join(upstream, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

(async () => {
  const indexSource = read('index.js');
  const schedulerSource = read('schedules/daily-automation.js');
  const publishingSource = read('agents/publishing-scheduling-agent.js');

  for (const [name, source] of [['index', indexSource], ['scheduler', schedulerSource]]) {
    assert(source.includes('LEFT JOIN content_reviews cr ON cr.production_id = gj.production_id'), name + ' weekly count must join content review state');
    assert(source.includes("cr.status IN ('needs_review', 'approved')"), name + ' weekly count must exclude needs_attention/blocked productions');
    assert(source.includes("gj.status = 'completed'"), name + ' weekly count must still require completed generation jobs');
  }
  assert(schedulerSource.includes('publishable buffer or cadence target is already satisfied'), 'scheduler skip log must describe the real gate');
  assert(publishingSource.includes("if (entry.status !== 'scheduled') return false;"), 'future buffer must ignore failed/paused/published queue entries');

  const { PublishingSchedulingAgent } = require(path.join(upstream, 'agents', 'publishing-scheduling-agent.js'));
  const publisher = Object.create(PublishingSchedulingAgent.prototype);
  const now = Date.now();
  publisher.publishQueue = [
    { id: 'scheduled-near', status: 'scheduled', publishTime: new Date(now + 60 * 60 * 1000).toISOString() },
    { id: 'failed-near', status: 'failed', publishTime: new Date(now + 60 * 60 * 1000).toISOString() },
    { id: 'paused-near', status: 'paused', publishTime: new Date(now + 2 * 60 * 60 * 1000).toISOString() },
    { id: 'published-near', status: 'published', publishTime: new Date(now + 3 * 60 * 60 * 1000).toISOString() },
    { id: 'scheduled-far', status: 'scheduled', publishTime: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString() }
  ];
  const upcoming = await publisher.getUpcomingSchedule(3);
  assert.deepStrictEqual(upcoming.map(item => item.id), ['scheduled-near'], 'only genuinely scheduled near-future items may satisfy the publication buffer');

  const { DailyAutomation } = require(path.join(upstream, 'schedules', 'daily-automation.js'));
  let capturedSchedulerQuery = '';
  const strategy = { status: 'active', cadence_per_week: 84, videos_per_run: 12 };
  const scheduler = new DailyAutomation({ publishing: { async getUpcomingSchedule() { return []; } } }, {
    async getSetting(key) {
      if (key === 'content_buffer_days') return '3';
      if (key === 'last_content_generation') return new Date(Date.now() - 121 * 60 * 1000).toISOString();
      return null;
    },
    async getChannelStrategy() { return strategy; },
    async getRow(query) { capturedSchedulerQuery = query; return { count: 0 }; },
    async getActiveOperatorRun() { return null; }
  });
  assert.strictEqual(await scheduler.shouldGenerateContentToday(), true, 'a due strategy with no publishable inventory must be allowed to generate');
  assert(capturedSchedulerQuery.includes("cr.status IN ('needs_review', 'approved')"), 'scheduler runtime query must gate weekly output by review status');

  const { YouTubeAutomationAgent } = require(path.join(upstream, 'index.js'));
  const queueAgent = Object.create(YouTubeAutomationAgent.prototype);
  let capturedQueueQuery = '';
  queueAgent.db = {
    async getChannelStrategy() { return strategy; },
    async getRow(query) { capturedQueueQuery = query; return { count: 0 }; }
  };
  queueAgent.autonomous = { async start(input) { return input; } };
  const queued = await YouTubeAutomationAgent.prototype.queueScheduledContent.call(queueAgent, { source: 'scheduler' });
  assert.strictEqual(queued.videos_per_run, 1, 'high-frequency scheduler must still queue one fresh video per run');
  assert(capturedQueueQuery.includes("cr.status IN ('needs_review', 'approved')"), 'operator queue runtime query must ignore blocked completions');

  console.log('Publishable cadence inventory verification passed: blocked content cannot satisfy cadence and only scheduled future items count toward buffer.');
})().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
