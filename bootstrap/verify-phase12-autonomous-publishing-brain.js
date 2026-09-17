'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
let checks = 0;
function ok(cond, msg) { checks++; if (!cond) throw new Error(`Phase 12.10 verification failed: ${msg}`); }
function read(rel) { return fs.readFileSync(path.join(upstream, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n'); }

async function main() {
  const runtimePath = path.join(upstream, 'utils', 'autonomous-publishing-brain-v1210.js');
  ok(fs.existsSync(runtimePath), 'publishing brain runtime exists');
  const runtime = require(runtimePath);
  ok(runtime.VERSION === '12.10', 'runtime version is 12.10');
  ok(runtime.defaultPolicy().cadenceMinutes === 120, 'default cadence is 120 minutes');
  ok(runtime.defaultPolicy().requireQualityCouncilPass === true, 'Quality Council PASS is required by default');

  const rows = [];
  const decisions = [];
  const fakeDb = {
    async getRow(sql) {
      if (sql.includes('newsroom_quality_council_reviews')) return { status: 'PASS' };
      if (sql.includes("decision_kind = 'PUBLISHED'")) return decisions.length ? { payload_json: decisions[decisions.length - 1].payload_json } : null;
      return null;
    },
    async getAllRows(sql) { if (sql.includes('newsroom_publishing_reservations')) return rows.filter(r => ['reserved','scheduled'].includes(r.status)); if (sql.includes('newsroom_publishing_decisions')) return [...decisions].reverse(); return []; },
    async executeQuery(sql, params) {
      if (sql.startsWith('INSERT OR REPLACE INTO newsroom_publishing_reservations')) {
        const [id, production_id, publish_time, cadence_minutes, is_breaking, reservation_fingerprint] = params;
        const existing = rows.findIndex(r => r.production_id === production_id);
        const row = { id, production_id, publish_time, cadence_minutes, is_breaking, status: 'reserved', reservation_fingerprint };
        if (existing >= 0) rows[existing] = row; else rows.push(row);
      } else if (sql.startsWith('INSERT OR IGNORE INTO newsroom_publishing_decisions')) {
        const [id, engine_version, decision_kind, production_id, payload_json, decision_fingerprint] = params;
        if (!decisions.some(r => r.decision_fingerprint === decision_fingerprint)) decisions.push({ id, engine_version, decision_kind, production_id, payload_json, decision_fingerprint });
      } else if (sql.startsWith('UPDATE newsroom_publishing_reservations')) {
        const [published_at, production_id] = params; const row = rows.find(r => r.production_id === production_id); if (row) { row.status = 'published'; row.published_at = published_at; }
      }
      return true;
    }
  };
  const brain = new runtime.AutonomousPublishingBrainV1210(fakeDb, { policy: { cadenceMinutes: 120 } });
  const now = new Date('2026-09-17T00:17:00.000Z');
  const first = await brain.reserveSlot({ id: 'p1', priority: 50 }, [], now);
  ok(first.status === 'RESERVED', 'regular production reserves a slot');
  ok(first.publishTime === '2026-09-17T02:00:00.000Z', 'slot is aligned deterministically to UTC 2-hour boundary');
  const second = await brain.reserveSlot({ id: 'p2', priority: 50 }, [], now);
  ok(second.publishTime === '2026-09-17T04:00:00.000Z', 'collision advances exactly one cadence slot');
  ok(new Date(second.publishTime) - new Date(first.publishTime) === 120 * 60 * 1000, 'regular reservations preserve two-hour spacing');

  const queue = [{ id: 'sched1', productionId: 'regular-old', publishTime: '2026-09-17T02:00:00.000Z', status: 'scheduled', priority: 50 }];
  const breaking = await brain.reserveSlot({ id: 'breaking', priority: 99, newsroomAction: 'BREAKING' }, queue, now);
  ok(breaking.breaking === true, 'breaking story is recognized');
  ok(breaking.publishTime === '2026-09-17T02:00:00.000Z', 'breaking story can take next reserved slot');
  ok(breaking.displacements.length === 1, 'regular story is displaced instead of colliding');
  ok(breaking.displacements[0].to !== breaking.displacements[0].from, 'displaced story receives a later slot');

  const blockingDb = { ...fakeDb, async getRow(sql) { if (sql.includes('newsroom_quality_council_reviews')) return { status: 'REPAIR' }; return null; } };
  const blocked = await new runtime.AutonomousPublishingBrainV1210(blockingDb).reserveSlot({ id: 'bad' }, [], now);
  ok(blocked.status === 'BLOCKED' && blocked.reason === 'quality_council_pass_required', 'non-PASS Quality Council fails closed');

  const ready = [
    { id:'a', productionId:'a', publishTime:'2026-09-17T00:00:00.000Z', status:'scheduled', priority:50 },
    { id:'b', productionId:'b', publishTime:'2026-09-17T00:05:00.000Z', status:'scheduled', priority:50 }
  ];
  const governed = await brain.selectReadyEntries(ready, new Date('2026-09-17T06:00:00.000Z'));
  ok(governed.length === 1, 'overdue backlog is not flushed in bulk');
  await brain.recordPublished(governed[0], new Date('2026-09-17T06:00:00.000Z'));
  const tooSoon = await brain.selectReadyEntries(ready.slice(1), new Date('2026-09-17T06:15:00.000Z'));
  ok(tooSoon.length === 0, 'next polling cycle cannot publish another regular item before cadence expires');
  const afterCadence = await brain.selectReadyEntries(ready.slice(1), new Date('2026-09-17T08:01:00.000Z'));
  ok(afterCadence.length === 1, 'regular queue resumes after cadence interval');

  const agent = read('agents/publishing-scheduling-agent.js');
  ok(agent.includes('AutonomousPublishingBrainV1210'), 'publishing agent initializes brain');
  ok(agent.includes('reserveSlot(productionData, this.publishQueue)'), 'schedule path reserves governed slot');
  ok(agent.includes('selectReadyEntries(readyToPublish, now)'), 'publish queue is cadence-governed');
  ok(agent.includes('recordPublished'), 'successful publication is recorded');
  const index = read('index.js');
  ok(index.includes('/api/newsroom/publishing-brain/status'), 'protected status API exists');
  ok(index.includes('/api/newsroom/publishing-brain/decisions'), 'protected decision API exists');
  const db = read('database/db.js');
  ok(db.includes('newsroom_publishing_reservations'), 'reservation table materialized');
  ok(db.includes('newsroom_publishing_decisions'), 'decision ledger materialized');
  const pkg = JSON.parse(read('package.json'));
  ok(pkg.scripts?.['test:autonomous-publishing-brain'], 'package regression command exists');
  console.log(`Phase 12.10 Autonomous Publishing Brain verified: ${checks} checks passed.`);
}
main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
