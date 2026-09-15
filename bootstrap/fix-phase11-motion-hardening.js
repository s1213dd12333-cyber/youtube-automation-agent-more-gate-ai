'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const upstream = path.resolve(__dirname, '..', 'upstream');

function patch(rel, replacements) {
  const target = path.join(upstream, rel);
  let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (const [from, to, label] of replacements) {
    if (source.includes(to)) continue;
    if (!source.includes(from)) throw new Error(`Phase 11.5 hardening anchor not found: ${label}`);
    source = source.replace(from, to);
  }
  fs.writeFileSync(target, source, 'utf8');
}

patch('utils/cartoon-motion-composer-v11.js', [[
  "  async fileDigest(filePath) {\n    return hash(await fs.readFile(filePath));\n  }\n",
  "  async fileDigest(filePath) {\n    return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');\n  }\n",
  'hash exact keyframe bytes'
]]);

patch('utils/scene-pipeline-v2.js', [[
  "  async visualReady(scene) {\n    if (!scene || scene.status === 'visual_stale') return false;\n",
  "  async visualReady(scene) {\n    if (!scene || ['visual_stale', 'visual_failed', 'generating_visual'].includes(scene.status)) return false;\n",
  'failed visual must not reuse an old scene asset'
]]);

patch('database/db.js', [[
  "    if (changes.assetPath !== undefined || changes.status !== undefined) {\n      await this.executeQuery('DELETE FROM cartoon_motion_segments WHERE production_id = ? AND shot_id = ?', [current.productionId, current.shotId]);\n      await this.executeQuery('DELETE FROM cartoon_motion_scenes WHERE production_id = ? AND scene_id = ?', [current.productionId, current.sceneId]);\n    }\n",
  "    if (changes.assetPath !== undefined || changes.status !== undefined) {\n      await this.executeQuery('DELETE FROM cartoon_motion_segments WHERE production_id = ? AND shot_id = ?', [current.productionId, current.shotId]);\n      await this.executeQuery('DELETE FROM cartoon_motion_scenes WHERE production_id = ? AND scene_id = ?', [current.productionId, current.sceneId]);\n      await this.executeQuery(\"UPDATE production_scenes SET status = 'visual_stale', updated_at = datetime('now') WHERE production_id = ? AND id = ?\", [current.productionId, current.sceneId]);\n    }\n",
  'invalidate scene visual when keyframe state changes'
]]);

const pkgPath = path.join(upstream, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.scripts = pkg.scripts || {};
pkg.scripts['test:motion-hardening'] = 'node ../bootstrap/verify-phase11-motion-hardening.js';
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

console.log('Phase 11.5 motion hardening active: byte-exact fingerprints, stale-scene invalidation, failed-visual Resume safety, and dedicated hardening regression command.');

execFileSync(process.execPath, ['--check', path.join(__dirname, 'fix-phase11-reference-quota-fallback.js')], { stdio: 'inherit' });
require('./fix-phase11-reference-quota-fallback.js');

for (const rel of [
  'phase11-cartoon-quality.js',
  'fix-phase11-made-for-kids.js',
  'verify-phase11-cartoon-quality.js',
  'verify-phase11-made-for-kids.js',
  'templates/cartoon-quality-gate-v11.js'
]) execFileSync(process.execPath, ['--check', path.join(__dirname, rel)], { stdio: 'inherit' });
require('./phase11-cartoon-quality.js');
require('./fix-phase11-made-for-kids.js');

for (const rel of [
  'phase11-environment-bible.js',
  'verify-phase11-environment-bible.js',
  'templates/environment-bible-v11.js'
]) execFileSync(process.execPath, ['--check', path.join(__dirname, rel)], { stdio: 'inherit' });
require('./phase11-environment-bible.js');

for (const rel of [
  'phase11-prop-lock.js',
  'fix-phase11-prop-lock-attributes.js',
  'verify-phase11-prop-lock.js',
  'templates/prop-lock-v11.js'
]) execFileSync(process.execPath, ['--check', path.join(__dirname, rel)], { stdio: 'inherit' });
require('./phase11-prop-lock.js');
require('./fix-phase11-prop-lock-attributes.js');

for (const rel of [
  'phase11-master-environment.js',
  'verify-phase11-master-environment.js',
  'templates/master-environment-v11.js'
]) execFileSync(process.execPath, ['--check', path.join(__dirname, rel)], { stdio: 'inherit' });
require('./phase11-master-environment.js');

// Phase 11.7.4 maps each finalized production scene onto a persistent Environment ID.
// Multi-environment ambiguity stays unresolved instead of inventing a location.
for (const rel of [
  'phase11-scene-environment-mapping.js',
  'verify-phase11-scene-environment-mapping.js',
  'templates/scene-environment-mapper-v11.js'
]) execFileSync(process.execPath, ['--check', path.join(__dirname, rel)], { stdio: 'inherit' });
require('./phase11-scene-environment-mapping.js');

// Phase 11.7.5 injects the mapped Environment Bible + Prop Locks into every cartoon shot/keyframe.
// When a canonical Master Environment exists, the first keyframe uses it as a real image reference.
for (const rel of [
  'phase11-environment-prompt-enrichment.js',
  'verify-phase11-environment-prompt-enrichment.js',
  'templates/environment-prompt-enricher-v11.js'
]) execFileSync(process.execPath, ['--check', path.join(__dirname, rel)], { stdio: 'inherit' });
require('./phase11-environment-prompt-enrichment.js');
