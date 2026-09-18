'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const file = rel => path.join(upstream, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (rel, value) => fs.writeFileSync(file(rel), value.replace(/\r\n/g, '\n'), 'utf8');

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  const index = text.indexOf(from);
  if (index === -1) throw new Error('Autonomous cadence anchor not found: ' + label);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error('Autonomous cadence anchor not found: ' + label);
  return text.slice(0, index) + block + text.slice(index);
}

function patchStrategyAndQueue() {
  let source = read('index.js');

  source = replaceOnce(
    source,
    "      cadencePerWeek: integer('cadencePerWeek', current.cadence_per_week || 1, 1, 7),",
    "      cadencePerWeek: integer('cadencePerWeek', current.cadence_per_week || 1, 1, 84),",
    'cadence-per-week validation range'
  );
  source = replaceOnce(
    source,
    "      videosPerRun: integer('videosPerRun', current.videos_per_run || 1, 1, 5),",
    "      videosPerRun: integer('videosPerRun', current.videos_per_run || 1, 1, 12),",
    'videos-per-run validation range'
  );

  const oldQueue = [
    "      const remaining = Math.max(1, strategy.cadence_per_week - Number(weeklyOutput?.count || 0));",
    "      return this.autonomous.start({",
    "        ...strategy,",
    "        videos_per_run: Math.min(strategy.videos_per_run, remaining)",
    "      });"
  ].join('\n');
  const newQueue = [
    "      const remaining = Math.max(1, strategy.cadence_per_week - Number(weeklyOutput?.count || 0));",
    "      const configuredPerRun = Math.max(1, Number(strategy.videos_per_run || 1));",
    "      const highFrequency = Number(strategy.cadence_per_week || 1) > 7;",
    "      const scheduledCap = input.source === 'scheduler' && highFrequency ? 1 : configuredPerRun;",
    "      return this.autonomous.start({",
    "        ...strategy,",
    "        videos_per_run: Math.min(configuredPerRun, remaining, scheduledCap)",
    "      });"
  ].join('\n');
  source = replaceOnce(source, oldQueue, newQueue, 'scheduled high-frequency run size');

  write('index.js', source);

  let html = read('dashboard/index.html');
  html = replaceOnce(
    html,
    '<label><span>Videos per week</span><input name="cadencePerWeek" type="number" min="1" max="7" value="1"></label>',
    '<label><span>Videos per week</span><input name="cadencePerWeek" type="number" min="1" max="84" value="1"><small>Up to 84/week (12/day = one every 2 hours).</small></label>',
    'operator cadence input'
  );
  html = replaceOnce(
    html,
    '<label><span>Videos per planning run</span><input name="videosPerRun" type="number" min="1" max="5" value="1"></label>',
    '<label><span>Videos per planning run</span><input name="videosPerRun" type="number" min="1" max="12" value="1"><small>High-frequency scheduled runs are capped to one fresh video at a time.</small></label>',
    'operator planning-run input'
  );
  write('dashboard/index.html', html);
}

function patchScheduler() {
  let source = read('schedules/daily-automation.js');

  const cadenceTask = [
    "    // High-frequency channel strategies need production checks throughout the day.",
    "    // Offset from :00 so this never collides with the legacy 06:00 daily check.",
    "    this.scheduledTasks.set('strategy-cadence-generation',",
    "      cron.schedule('7,22,37,52 * * * *', async () => {",
    "        if (this.isEnabled) await this.runStrategyCadenceGeneration();",
    "      }, { scheduled: false })",
    "    );",
    ""
  ].join('\n');
  source = insertBefore(
    source,
    "    // Daily content generation at 6:00 AM\n",
    cadenceTask,
    'high-frequency cadence scheduler task'
  );

  const cadenceMethod = [
    "  async runStrategyCadenceGeneration() {",
    "    const strategy = this.db.getChannelStrategy ? await this.db.getChannelStrategy() : null;",
    "    if (strategy?.status !== 'active') return { skipped: true, reason: 'no_active_strategy' };",
    "    const activeRun = this.db.getActiveOperatorRun ? await this.db.getActiveOperatorRun() : null;",
    "    if (activeRun) return { skipped: true, reason: 'operator_run_active' };",
    "    const due = await this.shouldGenerateContentToday();",
    "    if (!due) return { skipped: true, reason: 'cadence_or_buffer_satisfied' };",
    "    await this.runDailyContentGeneration();",
    "    return { queued: true, cadencePerWeek: Number(strategy.cadence_per_week || 1) };",
    "  }",
    "",
    ""
  ].join('\n');
  source = insertBefore(
    source,
    "  async runDailyContentGeneration() {\n",
    cadenceMethod,
    'high-frequency cadence scheduler method'
  );

  const oldBuffer = [
    "    // Check content buffer",
    "    const upcomingContent = await this.agents.publishing.getUpcomingSchedule(3);",
    "    const bufferDays = parseInt(await this.db.getSetting('content_buffer_days')) || 3;",
    "    ",
    "    // Check if we have enough content scheduled",
    "    if (upcomingContent.length >= bufferDays) {",
    "      return false;",
    "    }",
    "",
    "    // Check posting frequency settings",
    "    const lastGeneration = await this.db.getSetting('last_content_generation');",
    "    const channelStrategy = this.db.getChannelStrategy ? await this.db.getChannelStrategy() : null;"
  ].join('\n');

  const newBuffer = [
    "    // Check content buffer. For active high-frequency strategies, buffer size is",
    "    // measured in videos, not merely days. 84/week with a 3-day buffer means 36 items.",
    "    const bufferDays = parseInt(await this.db.getSetting('content_buffer_days')) || 3;",
    "    const channelStrategy = this.db.getChannelStrategy ? await this.db.getChannelStrategy() : null;",
    "    const activeCadencePerWeek = channelStrategy?.status === 'active'",
    "      ? Math.max(1, Number(channelStrategy.cadence_per_week || 1))",
    "      : 0;",
    "    const targetBufferItems = activeCadencePerWeek",
    "      ? Math.max(1, Math.ceil((activeCadencePerWeek / 7) * bufferDays))",
    "      : bufferDays;",
    "    const upcomingContent = await this.agents.publishing.getUpcomingSchedule(bufferDays);",
    "",
    "    if (upcomingContent.length >= targetBufferItems) {",
    "      return false;",
    "    }",
    "",
    "    // Check posting frequency settings",
    "    const lastGeneration = await this.db.getSetting('last_content_generation');"
  ].join('\n');
  source = replaceOnce(source, oldBuffer, newBuffer, 'cadence-aware content buffer');

  const oldActive = [
    "      if (Number(weeklyOutput?.count || 0) >= channelStrategy.cadence_per_week) return false;",
    "      if (!lastGeneration) return true;",
    "      const daysSinceLastGeneration = Math.floor(",
    "        (new Date() - new Date(lastGeneration)) / (1000 * 60 * 60 * 24)",
    "      );",
    "      return daysSinceLastGeneration >= 1;"
  ].join('\n');
  const newActive = [
    "      if (Number(weeklyOutput?.count || 0) >= channelStrategy.cadence_per_week) return false;",
    "      if (!lastGeneration) return true;",
    "      const targetIntervalMinutes = Math.max(30, Math.ceil((7 * 24 * 60) / Math.max(1, Number(channelStrategy.cadence_per_week || 1))));",
    "      const minutesSinceLastGeneration = Math.floor(",
    "        (new Date() - new Date(lastGeneration)) / (1000 * 60)",
    "      );",
    "      return minutesSinceLastGeneration >= targetIntervalMinutes;"
  ].join('\n');
  source = replaceOnce(source, oldActive, newActive, 'active-strategy minute cadence');

  write('schedules/daily-automation.js', source);
}

function patchPackage() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:autonomous-cadence'] = 'node ../bootstrap/verify-high-frequency-autonomous-cadence.js';
  write('package.json', JSON.stringify(pkg, null, 2) + '\n');
}

patchStrategyAndQueue();
patchScheduler();
patchPackage();
console.log('High-frequency autonomous cadence active: up to 84 videos/week, cadence-aware buffer sizing, 15-minute due checks, and one fresh scheduled video per high-frequency run.');
