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
  if (index === -1) throw new Error('Global news scheduler handoff anchor not found: ' + label);
  return text.slice(0, index) + to + text.slice(index + from.length);
}
function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error('Global news scheduler handoff anchor not found: ' + label);
  return text.slice(0, index) + block + text.slice(index);
}

let source = read('schedules/daily-automation.js');

const normalizeHelper = [
  "  isGlobalNewsStrategy(strategy = {}) {",
  "    const text = [strategy.objective, strategy.audience, strategy.value_proposition, strategy.constraints, ...(strategy.contentPillars || [])].filter(Boolean).join(' ').toLowerCase();",
  "    return /\\b(global news|world news|breaking news|current events|world events|global developments|major world events|news channel|newsroom)\\b/.test(text);",
  "  }",
  "",
  "  async normalizeStoredGlobalNewsStrategy(strategy = null) {",
  "    if (!strategy || strategy.status !== 'active' || !this.isGlobalNewsStrategy(strategy)) return strategy;",
  "    const canonicalPillars = ['World News','Global Affairs','Science and Technology','Economy and Business','Natural Disasters and Extreme Weather','Public Health and Environment','International Conflicts and Diplomacy','Major Elections and Government Developments'];",
  "    const legacy = new Set(['science mysteries','future technology','hidden history','space and universe','unexplained phenomena','human psychology','extraordinary places','surprising facts']);",
  "    const currentPillars = Array.isArray(strategy.contentPillars) ? strategy.contentPillars : [];",
  "    const hasNewsPillar = currentPillars.some(pillar => /news|global affairs|econom|business|technology|health|environment|diplom|conflict|election|government|weather|disaster/i.test(String(pillar)));",
  "    const onlyLegacy = currentPillars.length > 0 && currentPillars.every(pillar => legacy.has(String(pillar).trim().toLowerCase()));",
  "    const cadenceText = [strategy.objective, strategy.constraints].filter(Boolean).join(' ').toLowerCase();",
  "    const everyTwoHours = /\\b(?:every|cada)\\s+(?:2|two|duas)\\s*(?:hours|horas)\\b|\\b2[- ]hour\\b/.test(cadenceText);",
  "    const desiredPillars = (!hasNewsPillar || onlyLegacy) ? canonicalPillars : currentPillars;",
  "    const desiredCadence = everyTwoHours ? 84 : Number(strategy.cadence_per_week || 1);",
  "    const desiredPerRun = desiredCadence > 7 ? 1 : Number(strategy.videos_per_run || 1);",
  "    const changed = desiredCadence !== Number(strategy.cadence_per_week || 1) || desiredPerRun !== Number(strategy.videos_per_run || 1) || JSON.stringify(desiredPillars) !== JSON.stringify(currentPillars);",
  "    if (!changed || !this.db.saveChannelStrategy) return strategy;",
  "    await this.db.saveChannelStrategy({ contentPillars: desiredPillars, cadencePerWeek: desiredCadence, videosPerRun: desiredPerRun, status: 'active' });",
  "    const saved = this.db.getChannelStrategy ? await this.db.getChannelStrategy() : strategy;",
  "    this.logger.info('Global News strategy auto-normalized for scheduler: ' + desiredCadence + '/week, ' + desiredPerRun + '/run, news pillars=' + desiredPillars.length + '.');",
  "    return saved || strategy;",
  "  }",
  "",
  ""
].join('\n');
source = insertBefore(source, "  async runStrategyCadenceGeneration() {\n", normalizeHelper, 'strategy normalization helpers');

const oldCadence = [
  "  async runStrategyCadenceGeneration() {",
  "    const strategy = this.db.getChannelStrategy ? await this.db.getChannelStrategy() : null;",
  "    if (strategy?.status !== 'active') return { skipped: true, reason: 'no_active_strategy' };",
  "    const activeRun = this.db.getActiveOperatorRun ? await this.db.getActiveOperatorRun() : null;",
  "    if (activeRun) return { skipped: true, reason: 'operator_run_active' };",
  "    const due = await this.shouldGenerateContentToday();",
  "    if (!due) return { skipped: true, reason: 'cadence_or_buffer_satisfied' };",
  "    await this.runDailyContentGeneration();",
  "    return { queued: true, cadencePerWeek: Number(strategy.cadence_per_week || 1) };",
  "  }"
].join('\n');

const newCadence = [
  "  async runStrategyCadenceGeneration(context = {}) {",
  "    let strategy = this.db.getChannelStrategy ? await this.db.getChannelStrategy() : null;",
  "    strategy = await this.normalizeStoredGlobalNewsStrategy(strategy);",
  "    const trigger = context.trigger || 'cadence_timer';",
  "    if (strategy?.status !== 'active') {",
  "      if (context.verbose) this.logger.info('Strategy cadence skipped (' + trigger + '): no active strategy.');",
  "      return { skipped: true, reason: 'no_active_strategy', trigger };",
  "    }",
  "    const activeRun = this.db.getActiveOperatorRun ? await this.db.getActiveOperatorRun() : null;",
  "    if (activeRun) {",
  "      this.logger.info('Strategy cadence skipped (' + trigger + '): operator run ' + activeRun.id + ' is already active.');",
  "      return { skipped: true, reason: 'operator_run_active', trigger, runId: activeRun.id };",
  "    }",
  "    const due = await this.shouldGenerateContentToday();",
  "    if (!due) {",
  "      if (context.verbose || trigger !== 'cadence_timer') this.logger.info('Strategy cadence skipped (' + trigger + '): publishable buffer or cadence interval is satisfied.');",
  "      return { skipped: true, reason: 'cadence_or_buffer_satisfied', trigger };",
  "    }",
  "    this.logger.info('Strategy cadence due (' + trigger + '): starting autonomous content generation for ' + Number(strategy.cadence_per_week || 1) + '/week strategy.');",
  "    await this.runDailyContentGeneration();",
  "    return { queued: true, trigger, cadencePerWeek: Number(strategy.cadence_per_week || 1) };",
  "  }"
].join('\n');
source = replaceOnce(source, oldCadence, newCadence, 'cadence generation method');

source = replaceOnce(
  source,
  "    const channelStrategy = this.db.getChannelStrategy ? await this.db.getChannelStrategy() : null;\n\n    if (channelStrategy?.status === 'active') {",
  "    let channelStrategy = this.db.getChannelStrategy ? await this.db.getChannelStrategy() : null;\n    channelStrategy = await this.normalizeStoredGlobalNewsStrategy(channelStrategy);\n\n    if (channelStrategy?.status === 'active') {",
  'should-generate stored strategy normalization'
);

const oldRadarTail = [
  "      await this.logAutomationEvent('global_news_radar', result.status === 'failed' ? 'error' : 'success', {",
  "        scanId: result.id, status: result.status, articleCount: result.articleCount, clusterCount: result.clusterCount, actionableCount: result.actionableCount",
  "      });",
  "      return result;"
].join('\n');
const newRadarTail = [
  "      await this.logAutomationEvent('global_news_radar', result.status === 'failed' ? 'error' : 'success', {",
  "        scanId: result.id, status: result.status, articleCount: result.articleCount, clusterCount: result.clusterCount, actionableCount: result.actionableCount",
  "      });",
  "      if (['completed','partial'].includes(result.status)) {",
  "        result.operatorHandoff = await this.runStrategyCadenceGeneration({ trigger: 'newsroom_scan', verbose: true });",
  "      }",
  "      return result;"
].join('\n');
source = replaceOnce(source, oldRadarTail, newRadarTail, 'radar to operator handoff');

const oldSkipped = [
  "      if (result?.skipped) {",
  "        if (!['not_due', 'scan_in_progress'].includes(result.reason)) this.logger.info(`Global News Radar skipped: ${result.reason}`);",
  "        return result;",
  "      }"
].join('\n');
const newSkipped = [
  "      if (result?.skipped) {",
  "        if (!['not_due', 'scan_in_progress'].includes(result.reason)) this.logger.info(`Global News Radar skipped: ${result.reason}`);",
  "        if (arguments[0]?.handoff && result.reason !== 'scan_in_progress') result.operatorHandoff = await this.runStrategyCadenceGeneration({ trigger: arguments[0]?.trigger || 'startup', verbose: true });",
  "        return result;",
  "      }"
].join('\n');
source = replaceOnce(source, oldSkipped, newSkipped, 'startup handoff on not-due radar');

source = replaceOnce(source,
  "  async runGlobalNewsRadar() {",
  "  async runGlobalNewsRadar(options = {}) {",
  'radar options signature');
source = source.replace(/arguments\[0\]\?\.handoff/g, 'options.handoff').replace(/arguments\[0\]\?\.trigger/g, 'options.trigger');

const startup = [
  "    // Prime the Global News path shortly after startup. If a recent scan already",
  "    // exists, the cadence handoff reuses it; otherwise the Radar scans first.",
  "    setTimeout(() => {",
  "      if (!this.isEnabled) return;",
  "      this.runGlobalNewsRadar({ handoff: true, trigger: 'startup' }).catch(error => {",
  "        this.logger.error('Startup Global News handoff failed:', error);",
  "      });",
  "    }, 3000);",
  "",
].join('\n');
source = replaceOnce(source,
  "    // Start monitoring loop\n    this.startMonitoringLoop();\n    \n    this.logger.success('Daily automation initialized successfully');",
  "    // Start monitoring loop\n    this.startMonitoringLoop();\n\n" + startup + "    this.logger.success('Daily automation initialized successfully');",
  'startup news handoff');

write('schedules/daily-automation.js', source);

const pkg = JSON.parse(read('package.json'));
pkg.scripts = pkg.scripts || {};
pkg.scripts['test:newsroom-scheduler-handoff'] = 'node ../bootstrap/verify-global-news-scheduler-handoff.js';
write('package.json', JSON.stringify(pkg, null, 2) + '\n');

console.log('Global News scheduler handoff active: stored strategies self-heal, startup primes the Radar, and completed scans hand off directly to autonomous cadence evaluation.');
