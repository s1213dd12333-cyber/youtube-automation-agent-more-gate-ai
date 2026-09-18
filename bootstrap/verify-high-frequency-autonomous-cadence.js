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
  const schedulerSource = read('schedules/daily-automation.js');
  const indexSource = read('index.js');
  const dashboardSource = read('dashboard/index.html');

  assert(schedulerSource.includes("strategy-cadence-generation"), 'cadence scheduler task must be materialized');
  assert(schedulerSource.includes("7,22,37,52 * * * *"), 'cadence scheduler must check every 15 minutes without colliding at :00');
  assert(schedulerSource.includes("targetIntervalMinutes"), 'active strategy must use minute-level cadence');
  assert(schedulerSource.includes("targetBufferItems"), 'content buffer must scale by cadence');
  assert(indexSource.includes("cadencePerWeek', current.cadence_per_week || 1, 1, 84"), 'backend must accept up to 84 videos/week');
  assert(indexSource.includes("videosPerRun', current.videos_per_run || 1, 1, 12"), 'backend must accept up to 12 videos/planning run');
  assert(indexSource.includes("scheduledCap = input.source === 'scheduler' && highFrequency ? 1 : configuredPerRun"), 'high-frequency scheduler must produce one fresh video per run');
  assert(dashboardSource.includes('name="cadencePerWeek" type="number" min="1" max="84"'), 'dashboard must expose 84/week');
  assert(dashboardSource.includes('name="videosPerRun" type="number" min="1" max="12"'), 'dashboard must expose 12 videos/planning run');

  const { DailyAutomation } = require(path.join(upstream, 'schedules', 'daily-automation.js'));
  let upcomingCount = 0;
  let weeklyCount = 0;
  let lastGeneration = null;
  const strategy = {
    status: 'active',
    cadence_per_week: 84,
    videos_per_run: 12
  };
  const db = {
    async getSetting(key) {
      if (key === 'content_buffer_days') return '3';
      if (key === 'last_content_generation') return lastGeneration;
      if (key === 'posting_frequency') return 'daily';
      return null;
    },
    async getChannelStrategy() { return strategy; },
    async getRow() { return { count: weeklyCount }; },
    async getActiveOperatorRun() { return null; }
  };
  const scheduler = new DailyAutomation({
    publishing: {
      async getUpcomingSchedule(days) {
        assert.strictEqual(days, 3, 'buffer lookup should respect configured buffer days');
        return Array.from({ length: upcomingCount }, (_, i) => ({ id: i + 1 }));
      }
    }
  }, db);

  lastGeneration = new Date(Date.now() - 119 * 60 * 1000).toISOString();
  assert.strictEqual(await scheduler.shouldGenerateContentToday(), false, '84/week must not generate before 120 minutes');

  lastGeneration = new Date(Date.now() - 121 * 60 * 1000).toISOString();
  assert.strictEqual(await scheduler.shouldGenerateContentToday(), true, '84/week must become due after 120 minutes');

  upcomingCount = 36;
  assert.strictEqual(await scheduler.shouldGenerateContentToday(), false, '84/week with three buffer days must stop at 36 scheduled items');

  upcomingCount = 0;
  weeklyCount = 84;
  assert.strictEqual(await scheduler.shouldGenerateContentToday(), false, 'weekly target must cap generation');

  const { YouTubeAutomationAgent } = require(path.join(upstream, 'index.js'));
  const prototype = YouTubeAutomationAgent.prototype;
  const validated = prototype.validateChannelStrategy({
    objective: 'Publish verified global news explainers',
    audience: 'Adults following major world developments',
    contentPillars: ['World News'],
    cadencePerWeek: 84,
    videosPerRun: 12,
    defaultFormat: 'explainer',
    defaultLength: 'medium',
    status: 'active'
  }, {});
  assert.strictEqual(validated.cadencePerWeek, 84, 'strategy validation must preserve 84/week');
  assert.strictEqual(validated.videosPerRun, 12, 'strategy validation must preserve 12/run');

  const queueAgent = Object.create(prototype);
  queueAgent.db = {
    async getChannelStrategy() { return { ...strategy }; },
    async getRow() { return { count: 0 }; }
  };
  queueAgent.autonomous = {
    async start(input) { return input; }
  };
  const scheduled = await prototype.queueScheduledContent.call(queueAgent, { source: 'scheduler' });
  assert.strictEqual(scheduled.videos_per_run, 1, 'scheduled high-frequency run must generate one fresh video');

  const manual = await prototype.queueScheduledContent.call(queueAgent, { source: 'manual' });
  assert.strictEqual(manual.videos_per_run, 12, 'manual planning run may preserve configured batch size');

  console.log('High-frequency autonomous cadence verification passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
