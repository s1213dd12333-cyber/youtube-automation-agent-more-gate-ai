'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'cartoon-quality-gate-v11.js');
const qualityAgentsPath = path.join(upstream, 'utils', 'quality-agents-v9.js');
const autonomyPath = path.join(upstream, 'utils', 'autonomy-observability-v10.js');
for (const target of [runtimePath, qualityAgentsPath, autonomyPath]) {
  if (!fs.existsSync(target)) throw new Error(`Phase 11.6 dependency is not materialized: ${target}`);
}

const {
  CARTOON_QUALITY_GATE_VERSION,
  CARTOON_QUALITY_KEYFRAME_ROLES,
  evaluateCartoonQualityV11,
  latestContinuityByKeyframe,
  fileDigest,
  isCartoonProduction
} = require(runtimePath);
const { QualityAgentsV9, visualAgent } = require(qualityAgentsPath);
const { publicationBlockers } = require(autonomyPath);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

async function writeAsset(dir, name, content) {
  const target = path.join(dir, name);
  await fsp.writeFile(target, Buffer.from(content));
  return target;
}

async function goodCartoon(temp) {
  const sceneId = 'scene_cartoon_1';
  const sceneMotion = await writeAsset(temp, 'scene_motion.mp4', 'scene-motion-v1');
  const finalVideo = await writeAsset(temp, 'final.mp4', 'final-video-v1');
  const production = {
    id: 'prod_phase11_6',
    review_status: 'approved',
    strategy: { topic: 'Luna learns to share', requestedStyle: 'kids_cartoon_2d', evidencePack: { sources: [] } },
    script: {
      title: 'Luna Learns to Share',
      hook: { text: 'Luna has one bright basket and three friends who want to play. What will she do?' },
      introduction: { topicIntro: 'A gentle story about sharing.', valueProposition: 'Watch Luna solve a small friendship problem.' },
      mainContent: { sections: [{ title: 'Sharing', content: ['Luna sees Milo and Tico and decides to share her star cookies.'], duration: 12 }] },
      conclusion: { recap: ['Luna learns that sharing can make playtime happier.'], finalThought: 'Kind choices help friends feel included.' },
      callToAction: { text: 'Tell us one kind thing you like to share.' },
      claims: []
    },
    seo: {
      title: 'Luna Learns to Share With Friends',
      description: 'A gentle original cartoon story for young children about sharing, kindness, and friendship through Luna, Milo, and Tico.',
      tags: ['sharing', 'friendship', 'kids story', 'cartoon', 'kindness']
    },
    thumbnail: { path: 'thumbnail.png', concept: { subject: 'Luna smiling with friends', composition: 'three friendly characters together' } },
    assets: {
      thumbnail: { path: 'thumbnail.png' },
      finalVideo: { path: finalVideo, simulated: false },
      sceneManifest: { visualBriefs: { [sceneId]: { visualType: 'kids_cartoon_2d', quality: { accepted: true, specificity: 92, genericAiRisk: 8 } } } }
    },
    cartoonBible: {
      version: '11.1', mode: 'kids_cartoon_2d', fingerprint: 'bible_fp',
      characters: [{ id: 'luna', name: 'Luna', role: 'main' }, { id: 'milo', name: 'Milo', role: 'supporting' }]
    },
    scenes: [{
      id: sceneId, position: 0, label: 'Sharing', duration: 12, revision: 1,
      status: 'ready', narrationStatus: 'current', assetType: 'video', assetOrigin: 'generated-motion',
      assetPath: sceneMotion, provider: 'cartoon-motion-v11', rightsConfirmed: true
    }],
    shots: [], keyframes: [], continuityChecks: [], motionSegments: [],
    motionScenes: [{
      id: 'motion_scene_1', productionId: 'prod_phase11_6', sceneId, version: '11.5', fingerprint: 'motion_scene_fp',
      duration: 12, segmentIds: [], outputPath: sceneMotion, status: 'ready'
    }],
    provenance: { status: 'verified', summary: { claimCount: 0, resolvedClaims: 0, unresolvedClaims: 0, verifiedSources: 0 } },
    qualityAgentReport: { status: 'passed' }
  };

  let previousId = null;
  for (let shotIndex = 0; shotIndex < 3; shotIndex += 1) {
    const shotId = `shot_${shotIndex}`;
    production.shots.push({
      id: shotId, sceneId, shotIndex, shotCount: 3,
      shotType: shotIndex === 0 ? 'wide' : shotIndex === 2 ? 'ending' : 'medium',
      duration: 4,
      storyBeat: shotIndex === 0 ? 'Luna notices her friends.' : shotIndex === 1 ? 'Luna shares a star cookie.' : 'Everyone smiles together.',
      action: shotIndex === 0 ? 'Visually show Luna noticing her friends.' : shotIndex === 1 ? 'Visually show Luna sharing a star cookie.' : 'Visually show the friends smiling together.',
      fingerprint: `shot_fp_${shotIndex}`, status: 'planned',
      prompt: [
        'SHOT PLAN V11.2:', `SHOT: ${shotIndex + 1}/3`, 'ACTION: one concrete child-safe action',
        'CHARACTERS: Luna and friends with fixed Character Bible identity',
        'CAMERA: readable child-eye-level composition',
        'CONTINUITY: preserve palette, costume, props, and scene geography'
      ].join('\n')
    });

    const segmentPath = await writeAsset(temp, `motion_${shotIndex}.mp4`, `motion-${shotIndex}`);
    const segment = {
      id: `motion_${shotIndex}`, productionId: production.id, sceneId, shotId, version: '11.5', shotIndex,
      fingerprint: `motion_fp_${shotIndex}`, duration: 4, profile: 'gentle_push', keyframeIds: [], outputPath: segmentPath, status: 'ready'
    };
    production.motionSegments.push(segment);

    for (let keyframeIndex = 0; keyframeIndex < 3; keyframeIndex += 1) {
      const role = CARTOON_QUALITY_KEYFRAME_ROLES[keyframeIndex];
      const id = `kf_${shotIndex}_${role}`;
      const assetPath = await writeAsset(temp, `${id}.png`, `unique-frame-${shotIndex}-${role}`);
      production.keyframes.push({
        id, productionId: production.id, sceneId, shotId, shotIndex, keyframeIndex, keyframeRole: role,
        fingerprint: `frame_fp_${shotIndex}_${role}`, status: 'ready', assetPath,
        generatedAt: '2026-09-15T04:00:00.000Z', referenceKeyframeId: previousId,
        prompt: `KEYFRAME PIPELINE V11.3:\nKEYFRAME ROLE: ${role.toUpperCase()}\nACTION: progress the planned shot`
      });
      segment.keyframeIds.push(id);
      if (previousId) {
        production.continuityChecks.push({
          id: `check_${id}`, productionId: production.id, sceneId, shotId, keyframeId: id, keyframe_id: id,
          referenceKeyframeId: previousId, attempt: 0, score: 0.84, threshold: 0.48, status: 'accepted',
          metrics: { compositionGrid: 0.81, palette: 0.82, perceptualHash: 0.80 }, referenceConditioned: true,
          createdAt: '2026-09-15T04:00:01.000Z'
        });
      }
      previousId = id;
    }
  }
  production.motionScenes[0].segmentIds = production.motionSegments.map(item => item.id);
  return production;
}

check('Phase 11.6 contract version is 11.6', () => assert.strictEqual(CARTOON_QUALITY_GATE_VERSION, '11.6'));
check('keyframe roles remain start middle end', () => assert.deepStrictEqual([...CARTOON_QUALITY_KEYFRAME_ROLES], ['start', 'middle', 'end']));
check('non-cartoon production is not applicable', () => assert.strictEqual(evaluateCartoonQualityV11({ id: 'x' }).status, 'not_applicable'));
check('cartoon detector uses persisted kids_cartoon_2d Bible', () => {
  assert.strictEqual(isCartoonProduction({ cartoonBible: { mode: 'kids_cartoon_2d' } }), true);
  assert.strictEqual(isCartoonProduction({ cartoonBible: { mode: 'documentary' } }), false);
});
check('latest continuity uses highest repair attempt', () => {
  const map = latestContinuityByKeyframe([{ keyframeId: 'a', attempt: 0, status: 'repair_needed' }, { keyframeId: 'a', attempt: 1, status: 'accepted' }]);
  assert.strictEqual(map.get('a').status, 'accepted');
});
check('file digest is byte-sensitive', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-digest-'));
  const target = await writeAsset(dir, 'asset.bin', 'one');
  const first = fileDigest(target);
  await fsp.writeFile(target, Buffer.from('two'));
  assert.notStrictEqual(first, fileDigest(target));
  await fsp.rm(dir, { recursive: true, force: true });
});
check('healthy cartoon passes the gate with expected metrics', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-good-'));
  const item = await goodCartoon(dir);
  const result = evaluateCartoonQualityV11(item);
  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.blockers.length, 0);
  assert.deepStrictEqual([result.metrics.sceneCount, result.metrics.shotCount, result.metrics.keyframeCount], [1, 3, 9]);
  assert.strictEqual(result.metrics.motionSegmentCount, 3);
  assert(result.metrics.averageContinuityScore >= 0.8);
  await fsp.rm(dir, { recursive: true, force: true });
});
check('quality fingerprint changes when keyframe bytes change at same path', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-fp-'));
  const item = await goodCartoon(dir);
  const first = evaluateCartoonQualityV11(item).fingerprint;
  await fsp.writeFile(item.keyframes[1].assetPath, Buffer.from('changed-frame-bytes'));
  assert.notStrictEqual(first, evaluateCartoonQualityV11(item).fingerprint);
  await fsp.rm(dir, { recursive: true, force: true });
});
check('too few shots blocks', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-shots-'));
  const item = await goodCartoon(dir); item.shots = item.shots.slice(0, 2);
  assert(evaluateCartoonQualityV11(item).findings.some(x => x.id === 'cartoon_shot_count' && x.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});
check('missing keyframe role blocks', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-role-'));
  const item = await goodCartoon(dir); item.keyframes = item.keyframes.filter(x => !(x.shotId === 'shot_1' && x.keyframeRole === 'middle'));
  assert(evaluateCartoonQualityV11(item).findings.some(x => x.id === 'cartoon_keyframe_contract' && x.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});
check('missing keyframe file blocks', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-file-'));
  const item = await goodCartoon(dir); await fsp.unlink(item.keyframes[2].assetPath);
  assert(evaluateCartoonQualityV11(item).findings.some(x => x.id === 'cartoon_keyframe_not_ready' && x.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});
check('missing continuity decision blocks', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-cont-missing-'));
  const item = await goodCartoon(dir); const target = item.keyframes.find(x => x.referenceKeyframeId);
  item.continuityChecks = item.continuityChecks.filter(x => (x.keyframeId || x.keyframe_id) !== target.id);
  assert(evaluateCartoonQualityV11(item).findings.some(x => x.id === 'cartoon_continuity_missing' && x.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});
check('rejected continuity blocks', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-cont-reject-'));
  const item = await goodCartoon(dir); item.continuityChecks[0].status = 'repair_needed'; item.continuityChecks[0].score = 0.2;
  assert(evaluateCartoonQualityV11(item).findings.some(x => x.id === 'cartoon_continuity_rejected' && x.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});
check('missing motion segment blocks', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-motion-seg-'));
  const item = await goodCartoon(dir); await fsp.unlink(item.motionSegments[0].outputPath);
  assert(evaluateCartoonQualityV11(item).findings.some(x => x.id === 'cartoon_motion_segment_missing' && x.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});
check('missing motion scene blocks', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-motion-scene-'));
  const item = await goodCartoon(dir); item.motionScenes[0].status = 'failed';
  assert(evaluateCartoonQualityV11(item).findings.some(x => x.id === 'cartoon_motion_scene_missing' && x.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});
check('scene must be bound to generated motion', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-binding-'));
  const item = await goodCartoon(dir); item.scenes[0].assetType = 'image'; item.scenes[0].provider = 'image-provider';
  assert(evaluateCartoonQualityV11(item).findings.some(x => x.id === 'cartoon_scene_not_motion_bound' && x.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});
check('byte-identical start middle end blocks a static shot', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-static-'));
  const item = await goodCartoon(dir); const frames = item.keyframes.filter(x => x.shotId === 'shot_0');
  for (const frame of frames) await fsp.writeFile(frame.assetPath, Buffer.from('same-static-frame'));
  assert(evaluateCartoonQualityV11(item).findings.some(x => x.id === 'cartoon_static_shot' && x.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});
check('high generic AI risk blocks', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-generic-'));
  const item = await goodCartoon(dir); item.assets.sceneManifest.visualBriefs.scene_cartoon_1.quality.genericAiRisk = 82;
  assert(evaluateCartoonQualityV11(item).findings.some(x => x.id === 'cartoon_generic_visual_risk' && x.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});
check('high-risk child-directed term requires manual review', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-safe-'));
  const item = await goodCartoon(dir); item.shots[1].storyBeat = 'A gun appears in the playroom.';
  assert(evaluateCartoonQualityV11(item).findings.some(x => x.id === 'cartoon_child_safety_lexical' && x.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});
check('Visual Quality Agent absorbs Phase 11.6 without a sixth weight', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-visual-'));
  const item = await goodCartoon(dir); item.motionSegments[0].status = 'failed';
  const visual = visualAgent(item);
  assert.strictEqual(visual.id, 'visual'); assert.strictEqual(visual.passed, false); assert(visual.cartoonQuality?.active);
  await fsp.rm(dir, { recursive: true, force: true });
});
check('Quality Agents still return exactly five categories and persist Phase 11.6 separately', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-review-'));
  const item = await goodCartoon(dir); let savedCartoon = null; let savedQuality = null;
  const service = new QualityAgentsV9({
    async saveCartoonQualityReport(report) { savedCartoon = report; return report; },
    async saveQualityAgentReport(report) { savedQuality = report; return report; }
  }, { logger: { info() {}, warn() {}, error() {} } });
  const report = await service.review(item);
  assert.strictEqual(report.agents.length, 5); assert(savedCartoon?.version === '11.6'); assert(savedQuality?.fingerprint === report.fingerprint);
  await fsp.rm(dir, { recursive: true, force: true });
});
check('publication permits current passing cartoon quality without cartoon blockers', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-pub-ok-'));
  const item = await goodCartoon(dir); item.cartoonQualityReport = evaluateCartoonQualityV11(item);
  const blockers = publicationBlockers(item, true);
  assert(!blockers.some(x => x.startsWith('cartoon_quality')));
  await fsp.rm(dir, { recursive: true, force: true });
});
check('publication blocks a cartoon with no persisted Phase 11.6 report', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-pub-required-'));
  const item = await goodCartoon(dir); delete item.cartoonQualityReport;
  assert(publicationBlockers(item, true).includes('cartoon_quality_required'));
  await fsp.rm(dir, { recursive: true, force: true });
});
check('publication blocks a stale Phase 11.6 fingerprint', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-pub-stale-'));
  const item = await goodCartoon(dir); item.cartoonQualityReport = { ...evaluateCartoonQualityV11(item), fingerprint: 'stale' };
  assert(publicationBlockers(item, true).includes('cartoon_quality_stale'));
  await fsp.rm(dir, { recursive: true, force: true });
});
check('publication blocks a current report whose cartoon gate is blocked', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-pub-blocked-'));
  const item = await goodCartoon(dir); const current = evaluateCartoonQualityV11(item);
  item.cartoonQualityReport = { ...current, status: 'blocked', passed: false };
  assert(publicationBlockers(item, true).includes('cartoon_quality'));
  await fsp.rm(dir, { recursive: true, force: true });
});

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const qualitySource = fs.readFileSync(path.join(upstream, 'utils', 'quality-agents-v9.js'), 'utf8');
const autonomySource = fs.readFileSync(path.join(upstream, 'utils', 'autonomy-observability-v10.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

check('SQLite persists and exposes cartoon quality reports', () => {
  assert(dbSource.includes('CREATE TABLE IF NOT EXISTS cartoon_quality_reports'));
  assert(dbSource.includes('async saveCartoonQualityReport(report = {})'));
  assert(dbSource.includes('cartoonQualityReport = await this.getLatestCartoonQualityReport(productionId)'));
});
check('Phase 9 imports and evaluates Phase 11.6', () => {
  assert(qualitySource.includes("const { evaluateCartoonQualityV11 } = require('./cartoon-quality-gate-v11');"));
  assert(qualitySource.includes('const cartoonQuality = evaluateCartoonQualityV11(production);'));
});
check('Phase 9 fingerprint and persistence include Phase 11.6', () => {
  assert(qualitySource.includes('cartoonQualityFingerprint: evaluateCartoonQualityV11(production).fingerprint'));
  assert(qualitySource.includes('saveCartoonQualityReport'));
});
check('Phase 10 publication gate imports Phase 11.6', () => assert(autonomySource.includes("const { evaluateCartoonQualityV11 } = require('./cartoon-quality-gate-v11');")));
check('Phase 10 publication gate requires current non-blocked cartoon quality', () => {
  for (const marker of ['cartoon_quality_required', 'cartoon_quality_stale', 'cartoon_quality']) assert(autonomySource.includes(marker));
});
check('Review Studio renders Cartoon Quality Gate v11.6', () => {
  assert(dashboardSource.includes('CARTOON QUALITY GATE V11.6'));
  assert(dashboardSource.includes('item.cartoonQualityReport || item.qualityAgentReport?.cartoonQuality'));
});
check('package exposes Phase 11.6 regression command', () => assert.strictEqual(pkg.scripts['test:cartoon-quality'], 'node ../bootstrap/verify-phase11-cartoon-quality.js'));

(async () => {
  for (const item of checks) await item.fn();
  console.log(`Phase 11.6 Cartoon Quality Gate OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
