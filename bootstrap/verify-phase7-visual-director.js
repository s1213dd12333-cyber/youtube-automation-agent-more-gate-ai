'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const servicePath = path.join(upstream, 'utils', 'visual-director-v7.js');
if (!fs.existsSync(servicePath)) throw new Error('Phase 7 service is not materialized: utils/visual-director-v7.js');

const {
  VISUAL_DIRECTOR_VERSION,
  LUMEN_VISUAL_IDENTITY,
  VisualDirectorV7,
  extractConcretePhrases,
  inferVisualType,
  qualityFor,
  parsePromptFields,
  buildLocalVisualSvg
} = require(servicePath);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('visual director contract is version 7 with a stable Lumen identity', () => {
  assert.strictEqual(VISUAL_DIRECTOR_VERSION, 7);
  assert.strictEqual(LUMEN_VISUAL_IDENTITY.name, 'Lumen Atlas Documentary v7');
  assert(LUMEN_VISUAL_IDENTITY.rules.some(rule => rule.includes('do not invent')));
});

check('concrete phrase extraction finds real scene objects instead of only mood words', () => {
  const phrases = extractConcretePhrases('NIST compared atomic clocks at different elevations while GPS satellites apply relativistic timing corrections.', 8);
  const joined = phrases.join(' ').toLowerCase();
  assert(joined.includes('nist'));
  assert(joined.includes('atomic clock'));
  assert(joined.includes('gps'));
});

check('experiment narration routes to an experiment diagram', () => {
  assert.strictEqual(inferVisualType({ label: 'Atomic-clock experiment', scriptText: 'A laboratory compares two atomic clocks at different elevations.' }, {}), 'comparison');
});

check('GPS satellite narration routes to a technical diagram', () => {
  assert.strictEqual(inferVisualType({ label: 'GPS corrections', scriptText: 'GPS satellites in orbit require relativistic clock corrections for navigation.' }, {}), 'technical_diagram');
});

const production = {
  title: 'The Place on Earth Where Time Moves Differently',
  strategy: {
    topic: 'gravitational time dilation on Earth',
    videoInstructions: 'Focus on real atomic-clock experiments and GPS timing. Prefer scientific diagrams over generic sci-fi imagery. Avoid speculative claims.',
    evidencePack: {
      sources: [
        {
          id: 'source_nist',
          title: 'Atomic clocks and differences in gravitational potential',
          publisher: 'NIST',
          sourceClass: 'official',
          status: 'verified',
          url: 'https://example.test/nist-clock',
          evidenceText: 'Atomic clocks at different elevations can measure different elapsed time because gravitational potential affects clock rates.'
        },
        {
          id: 'source_gps',
          title: 'Relativity and satellite navigation timing',
          publisher: 'Example Physics Journal',
          sourceClass: 'scholarly',
          status: 'verified',
          url: 'https://example.test/gps-relativity',
          evidenceText: 'Satellite navigation systems account for relativistic timing effects in orbit.'
        }
      ]
    }
  },
  script: { title: 'The Place on Earth Where Time Moves Differently' }
};

const scenes = [
  {
    id: 'scene_clock', position: 0, label: 'Atomic clocks at different elevations',
    scriptText: 'Researchers compare precision atomic clocks at different elevations. The clocks measure a tiny difference associated with gravitational potential.',
    prompt: 'old generic prompt', assetPath: null, status: 'missing_asset'
  },
  {
    id: 'scene_gps', position: 1, label: 'GPS satellite timing',
    scriptText: 'GPS satellites orbit Earth with atomic clocks, and navigation depends on accounting for relativistic timing effects.',
    prompt: 'old generic prompt', assetPath: null, status: 'missing_asset'
  }
];

const director = new VisualDirectorV7({ logger: { info() {}, warn() {}, error() {} } });
const plan = director.planProduction(production, scenes);

check('every scene receives a persistent structured visual brief', () => {
  assert.strictEqual(Object.keys(plan.briefs).length, scenes.length);
  assert(plan.briefs.scene_clock);
  assert(plan.briefs.scene_gps);
  assert.strictEqual(plan.briefs.scene_clock.version, 7);
});

check('visual briefs include subject purpose shot composition details and avoid list', () => {
  const brief = plan.briefs.scene_clock;
  for (const key of ['subject', 'purpose', 'shot', 'composition']) assert(String(brief[key] || '').length > 10, key);
  assert(brief.details.length >= 3);
  assert(brief.avoid.length >= 5);
});

check('video instructions reach the visual brief without becoming factual evidence', () => {
  const brief = plan.briefs.scene_clock;
  assert(brief.videoInstructions.includes('atomic-clock experiments'));
  assert(brief.evidenceHints.every(item => item.url));
  assert(!brief.evidenceHints.some(item => item.url === brief.videoInstructions));
});

check('relevant verified evidence is attached as visual context', () => {
  const clock = plan.briefs.scene_clock;
  assert(clock.evidenceHints.some(item => item.publisher === 'NIST'));
  const gps = plan.briefs.scene_gps;
  assert(gps.evidenceHints.some(item => item.title.toLowerCase().includes('satellite')));
});

check('anti-generic quality gate accepts specific scene briefs', () => {
  for (const brief of Object.values(plan.briefs)) {
    assert.strictEqual(brief.quality.accepted, true);
    assert(brief.quality.specificity >= 70);
    assert(brief.quality.genericAiRisk <= 50);
  }
});

check('generic brief scoring exposes high generic-AI risk transparently', () => {
  const quality = qualityFor({
    subject: 'mysterious futuristic technology', sceneLabel: '', details: [], evidenceHints: [],
    shot: '', composition: '', identity: {}, sceneText: '', topic: ''
  });
  assert.strictEqual(quality.accepted, false);
  assert(quality.genericAiRisk > 50);
});

check('rendered provider prompt contains concrete labeled visual fields and phase 6 direction', () => {
  const prompt = plan.scenes[0].prompt;
  const fields = parsePromptFields(prompt);
  assert(fields['VISUAL TYPE']);
  assert(fields.SUBJECT.toLowerCase().includes('atomic'));
  assert(fields['CONCRETE DETAILS']);
  assert(fields['VIDEO DIRECTION'].includes('scientific diagrams'));
  assert(fields.AVOID);
  assert(prompt.includes('no embedded text'));
});

check('local renderer is scene-specific rather than the old gradient text placeholder', () => {
  const svg = buildLocalVisualSvg(plan.scenes[0].prompt);
  assert(svg.includes('LUMEN ATLAS'));
  assert(svg.toLowerCase().includes('atomic'));
  assert(svg.includes('LOCAL EXPLANATORY RENDER · V7'));
  assert(!svg.includes('opacity="0.08"/><circle cx="180"'));
});

check('visual plan summary reports specificity and generic risk', () => {
  assert.strictEqual(plan.summary.sceneCount, 2);
  assert(plan.summary.averageSpecificity >= 70);
  assert(plan.summary.averageGenericAiRisk <= 50);
  assert.strictEqual(plan.summary.accepted, 2);
});

check('scene pipeline persists briefs and gates provider calls on accepted quality', () => {
  const source = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
  assert(source.includes('visualDirectorVersion'));
  assert(source.includes('visualBriefs: visualPlan?.briefs'));
  assert(source.includes('VISUAL_BRIEF_REJECTED'));
  assert(source.includes('visualBrief?.quality?.accepted !== true'));
});

check('legacy visual regeneration is opt-in to avoid surprise provider spend', () => {
  const source = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
  assert(source.includes('VISUAL_DIRECTOR_REFRESH_LEGACY_VISUALS'));
  assert(source.includes("|| 'false'"));
  assert(source.includes("status: shouldRefresh ? 'visual_stale' : previous.status"));
});

check('AI video fallback delegates to the scene-specific v7 SVG renderer', () => {
  const source = fs.readFileSync(path.join(upstream, 'utils', 'ai-video-generator.js'), 'utf8');
  assert(source.includes("const { buildLocalVisualSvg } = require('./visual-director-v7');"));
  assert(source.includes('const svg = buildLocalVisualSvg(prompt, width, height);'));
});

check('Scene Repair Studio exposes v7 quality metrics and full structured-prompt headroom', () => {
  const dashboard = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
  const repair = fs.readFileSync(path.join(upstream, 'utils', 'scene-repair-service.js'), 'utf8');
  assert(dashboard.includes('Visual Director v7'));
  assert(dashboard.includes('Generic-AI risk'));
  assert(dashboard.includes('maxlength="8000"'));
  assert(repair.includes("this.text(input.prompt, 8000, 'Scene prompt')"));
});

check('package exposes the Phase 7 regression command', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.scripts['test:visual-director'], 'node ../bootstrap/verify-phase7-visual-director.js');
});

(async () => {
  for (const item of checks) await item.fn();
  console.log(`Phase 7 Visual Director OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
