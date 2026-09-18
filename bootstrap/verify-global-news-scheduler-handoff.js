'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const source = fs.readFileSync(path.join(upstream, 'schedules', 'daily-automation.js'), 'utf8').replace(/\r\n/g, '\n');

(async () => {
  assert(source.includes('normalizeStoredGlobalNewsStrategy'), 'scheduler must self-heal stored Global News strategies');
  assert(source.includes("trigger: 'newsroom_scan'"), 'completed newsroom scans must hand off to cadence evaluation');
  assert(source.includes("runGlobalNewsRadar({ handoff: true, trigger: 'startup' })"), 'startup must prime the newsroom/operator flow');
  assert(source.includes("setTimeout(() =>"), 'startup handoff must be deferred until initialization completes');

  const { DailyAutomation } = require(path.join(upstream, 'schedules', 'daily-automation.js'));
  let strategy = {
    objective: 'Build an autonomous global news channel and target one approved video every 2 hours.',
    audience: 'Adults interested in major world events and global developments.',
    value_proposition: 'Verified global news.',
    constraints: 'Never publish unsupported claims.',
    contentPillars: ['Science mysteries','Future technology','Hidden history','Space and universe','Unexplained phenomena','Human psychology','Extraordinary places','Surprising facts'],
    cadence_per_week: 7,
    videos_per_run: 5,
    status: 'active'
  };
  let saves = 0;
  const db = {
    async getChannelStrategy() { return strategy; },
    async saveChannelStrategy(input) {
      saves += 1;
      strategy = {
        ...strategy,
        contentPillars: input.contentPillars ?? strategy.contentPillars,
        cadence_per_week: input.cadencePerWeek ?? strategy.cadence_per_week,
        videos_per_run: input.videosPerRun ?? strategy.videos_per_run,
        status: input.status ?? strategy.status
      };
      return strategy;
    },
    async getActiveOperatorRun() { return null; }
  };
  const scheduler = new DailyAutomation({ publishing: {} }, db, {});
  const normalized = await scheduler.normalizeStoredGlobalNewsStrategy(strategy);
  assert.strictEqual(saves, 1, 'legacy active Global News strategy must be persisted once');
  assert.strictEqual(normalized.cadence_per_week, 84, 'stored every-two-hours strategy must self-heal to 84/week');
  assert.strictEqual(normalized.videos_per_run, 1, 'stored high-frequency strategy must self-heal to one per run');
  assert(normalized.contentPillars.includes('World News'), 'stored curiosity pillars must self-heal to news pillars');
  assert(!normalized.contentPillars.includes('Hidden history'), 'legacy curiosity pillar must be removed');

  let generations = 0;
  scheduler.shouldGenerateContentToday = async () => true;
  scheduler.runDailyContentGeneration = async () => { generations += 1; };
  const cadence = await scheduler.runStrategyCadenceGeneration({ trigger: 'verification', verbose: true });
  assert.strictEqual(cadence.queued, true, 'due active strategy must queue autonomous generation');
  assert.strictEqual(generations, 1, 'cadence handoff must invoke generation exactly once');

  let handoffs = [];
  scheduler.logAutomationEvent = async () => null;
  scheduler.runStrategyCadenceGeneration = async context => { handoffs.push(context); return { queued: true, trigger: context.trigger }; };
  scheduler.newsroom = {
    async scanIfDue() {
      return { id:'scan_test', status:'partial', articleCount:117, clusterCount:105, actionableCount:0 };
    }
  };
  const scan = await scheduler.runGlobalNewsRadar();
  assert.strictEqual(scan.status, 'partial');
  assert.strictEqual(handoffs.length, 1, 'a completed/partial Radar scan must trigger one operator handoff');
  assert.strictEqual(handoffs[0].trigger, 'newsroom_scan');

  handoffs = [];
  scheduler.newsroom = { async scanIfDue() { return { skipped:true, reason:'not_due' }; } };
  const startup = await scheduler.runGlobalNewsRadar({ handoff:true, trigger:'startup' });
  assert.strictEqual(startup.skipped, true);
  assert.strictEqual(handoffs.length, 1, 'startup must evaluate cadence even when an existing Radar scan is still fresh');
  assert.strictEqual(handoffs[0].trigger, 'startup');

  handoffs = [];
  scheduler.newsroom = { async scanIfDue() { return { skipped:true, reason:'scan_in_progress' }; } };
  await scheduler.runGlobalNewsRadar({ handoff:true, trigger:'startup' });
  assert.strictEqual(handoffs.length, 0, 'startup must not race an already-running Radar scan');

  console.log('Global News scheduler handoff verification passed: stored strategy self-heals, Radar scans trigger cadence, and startup reuses fresh newsroom state without racing active scans.');
})().catch(error => { console.error(error.stack || error.message || String(error)); process.exit(1); });
