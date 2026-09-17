'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const file = rel => path.join(upstream, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (rel, value) => fs.writeFileSync(file(rel), value.replace(/\r\n/g, '\n'), 'utf8');
const template = name => fs.readFileSync(path.join(root, 'bootstrap', 'templates', name), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
function replaceOnce(text, from, to, label) { if (text.includes(to)) return text; const i = text.indexOf(from); if (i < 0) throw new Error(`Phase 12.10 anchor not found: ${label}`); return text.slice(0,i) + to + text.slice(i + from.length); }
function insertBefore(text, anchor, block, label) { if (text.includes(block.trim())) return text; const i = text.indexOf(anchor); if (i < 0) throw new Error(`Phase 12.10 anchor not found: ${label}`); return text.slice(0,i) + block + text.slice(i); }

function copyRuntime() { write('utils/autonomous-publishing-brain-v1210.js', template('autonomous-publishing-brain-v1210.js')); }
function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(s, "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n", `${template('autonomous-publishing-brain-db-tables-v1210.txt')}\n`, 'publishing persistence tables');
  write('database/db.js', s);
}
function patchPublishingAgent() {
  let s = read('agents/publishing-scheduling-agent.js');
  s = replaceOnce(s,
    "const { Logger } = require('../utils/logger');\n",
    "const { Logger } = require('../utils/logger');\nconst { AutonomousPublishingBrainV1210 } = require('../utils/autonomous-publishing-brain-v1210');\n",
    'publishing brain import');
  s = replaceOnce(s,
    "    this.publishQueue = [];\n",
    "    this.publishQueue = [];\n    this.publishingBrain = new AutonomousPublishingBrainV1210(this.db, { logger: this.logger });\n",
    'publishing brain init');
  const reservationBlock = [
    "      const publishingDecision = await this.publishingBrain.reserveSlot(productionData, this.publishQueue);",
    "      if (publishingDecision?.status === 'BLOCKED') {",
    "        const error = new Error(`Autonomous Publishing Brain blocked scheduling: ${publishingDecision.reason}`);",
    "        error.status = 409; error.code = 'PUBLISHING_BRAIN_BLOCKED'; error.publishingDecision = publishingDecision; throw error;",
    "      }",
    "      for (const displacement of publishingDecision?.displacements || []) {",
    "        const displaced = this.publishQueue.find(entry => entry.id === displacement.id || entry.productionId === displacement.productionId);",
    "        if (!displaced) continue;",
    "        displaced.publishTime = displacement.to;",
    "        await this.db.updateScheduleEntry(displaced);",
    "        await this.publishingBrain.persistDecision('DISPLACE', displaced.productionId, displacement);",
    "      }",
    "      if (publishingDecision?.publishTime) productionData.scheduledPublishTime = publishingDecision.publishTime;",
    ""
  ].join('\n');
  s = insertBefore(s, "      const scheduleEntry = {\n", reservationBlock, 'slot reservation before schedule entry');
  s = replaceOnce(s,
    "          shortClipId: productionData.shortClipId || null\n",
    "          shortClipId: productionData.shortClipId || null,\n          publishingBrainVersion: publishingDecision?.version || null,\n          publishingCadenceMinutes: publishingDecision?.cadenceMinutes || null,\n          publishingBreaking: publishingDecision?.breaking === true\n",
    'schedule metadata publishing decision');
  s = replaceOnce(s,
    "    const readyToPublish = scheduled.filter(entry => new Date(entry.publishTime) <= now);\n\n    if (readyToPublish.length === 0) {\n",
    "    const readyToPublish = scheduled.filter(entry => new Date(entry.publishTime) <= now);\n    const governedReady = await this.publishingBrain.selectReadyEntries(readyToPublish, now);\n\n    if (governedReady.length === 0) {\n",
    'queue cadence governance');
  s = replaceOnce(s,
    "    this.logger.info(`Processing publish queue: ${readyToPublish.length} item(s) ready to publish...`);\n\n    for (const entry of readyToPublish) {\n",
    "    this.logger.info(`Processing publish queue: ${governedReady.length}/${readyToPublish.length} ready item(s) authorized by Publishing Brain...`);\n\n    for (const entry of governedReady) {\n",
    'queue governed iteration');
  s = replaceOnce(s,
    "        await this.publishContent(entry.productionId);\n        this.logger.info(`Auto-published: ${entry.title}`);\n",
    "        const published = await this.publishContent(entry.productionId);\n        await this.publishingBrain.recordPublished(published || entry, new Date());\n        this.logger.info(`Auto-published: ${entry.title}`);\n",
    'published cadence ledger');
  s = replaceOnce(s,
    "    return readyToPublish.length;\n",
    "    return governedReady.length;\n",
    'governed queue result');
  write('agents/publishing-scheduling-agent.js', s);
}
function patchApi() {
  let s = read('index.js');
  const routes = [
    "    this.app.get('/api/newsroom/publishing-brain/status', protect, async (_req, res) => {",
    "      try { const brain = this.agents?.publishing?.publishingBrain; if (!brain) return res.status(503).json({ success: false, error: 'Autonomous Publishing Brain unavailable' }); return res.json({ success: true, result: await brain.status() }); } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/publishing-brain/decisions', protect, async (req, res) => {",
    "      try { const brain = this.agents?.publishing?.publishingBrain; if (!brain) return res.status(503).json({ success: false, error: 'Autonomous Publishing Brain unavailable' }); return res.json({ success: true, result: await brain.listDecisions(req.query.limit || 100) }); } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/newsroom/quality-council/status', protect, async (_req, res) => {\n", routes, 'publishing brain protected APIs');
  write('index.js', s);
}
function patchPackage() {
  const p = JSON.parse(read('package.json'));
  p.scripts = p.scripts || {};
  p.scripts['test:autonomous-publishing-brain'] = 'node ../bootstrap/verify-phase12-autonomous-publishing-brain.js';
  write('package.json', JSON.stringify(p, null, 2) + '\n');
}

copyRuntime(); patchDatabase(); patchPublishingAgent(); patchApi(); patchPackage();
console.log('Phase 12.10 Autonomous Publishing Brain materialized.');
