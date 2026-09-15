'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const motionSource = fs.readFileSync(path.join(upstream, 'utils', 'cartoon-motion-composer-v11.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

const checks = [
  () => assert(motionSource.includes("crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex')")),
  () => assert(!motionSource.includes('return hash(await fs.readFile(filePath));')),
  () => assert(pipelineSource.includes("['visual_stale', 'visual_failed', 'generating_visual'].includes(scene.status)")),
  () => assert(dbSource.includes("UPDATE production_scenes SET status = 'visual_stale'")),
  () => assert(dbSource.includes("DELETE FROM cartoon_motion_segments WHERE production_id = ? AND shot_id = ?")),
  () => assert(dbSource.includes("DELETE FROM cartoon_motion_scenes WHERE production_id = ? AND scene_id = ?")),
  () => assert.strictEqual(pkg.scripts['test:motion-hardening'], 'node ../bootstrap/verify-phase11-motion-hardening.js')
];

for (const fn of checks) fn();
console.log(`Phase 11.5 Motion Hardening OK: ${checks.length} regression checks passed.`);

require('./verify-phase11-reference-quota-fallback.js');
require('./verify-phase11-cartoon-quality.js');
require('./verify-phase11-made-for-kids.js');
require('./verify-phase11-environment-bible.js');
require('./verify-phase11-prop-lock.js');
require('./verify-phase11-master-environment.js');
require('./verify-phase11-scene-environment-mapping.js');
require('./verify-phase11-environment-prompt-enrichment.js');
require('./verify-phase11-environment-continuity.js');
