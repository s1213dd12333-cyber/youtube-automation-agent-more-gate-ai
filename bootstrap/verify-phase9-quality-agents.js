'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const servicePath = path.join(upstream, 'utils', 'quality-agents-v9.js');
if (!fs.existsSync(servicePath)) throw new Error('Phase 9 service is not materialized: utils/quality-agents-v9.js');

const {
  QUALITY_AGENTS_VERSION,
  QUALITY_AGENT_WEIGHTS,
  QualityAgentsV9,
  classifyContent,
  retentionAgent,
  thumbnailAgent,
  seoAgent,
  visualAgent,
  factAgent,
  buildRepairPlan,
  repetitionRatio
} = require(servicePath);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const clone = value => JSON.parse(JSON.stringify(value));

function goodProduction() {
  const sections = [
    { title: 'The measurable effect', duration: 45, content: ['Precision atomic clocks can compare elapsed time at different elevations. The experiment turns an abstract prediction into a measurable physical effect.'] },
    { title: 'Why gravity matters', duration: 50, content: ['General relativity connects clock rates with gravitational potential. The comparison is tiny, but precision timing makes the difference observable.'] },
    { title: 'Why GPS cares', duration: 55, content: ['Satellite navigation depends on accurate clock timing. Relativistic timing corrections are part of keeping position calculations accurate.'] }
  ];
  const hook = { text: 'Two precision atomic clocks can disagree even when both work perfectly. Why can changing elevation change the time they measure?' };
  const conclusion = { recap: ['Atomic clocks reveal that gravity and elapsed time are physically connected.', 'The same physics matters to precision navigation systems.'], finalThought: 'Time is not merely read by clocks; precise clocks can reveal the structure of gravity.' };
  const script = {
    title: "Why Atomic Clocks Reveal Gravity's Effect on Time",
    hook,
    introduction: { topicIntro: 'This video follows real clock experiments and the timing physics behind satellite navigation.', valueProposition: 'We will separate what has been measured from what is merely imagined.' },
    mainContent: { sections },
    conclusion,
    callToAction: { text: 'If you enjoy evidence-based science stories, explore another Lumen Atlas investigation.' },
    claims: [{ claim: 'Clock rates differ with gravitational potential.', sourceUrls: ['https://example.test/nist'], verified: true }]
  };
  script.fullScript = [hook.text, deep(sectionText(sections)), deep(script.introduction), deep(conclusion), deep(script.callToAction)].join(' ');
  return {
    id: 'prod_phase9_fixture',
    strategy: {
      topic: 'How atomic clocks measure gravitational time dilation',
      requestedStyle: 'explainer',
      evidencePack: { sources: [{ status: 'verified', title: 'Atomic clock experiment', publisher: 'NIST', url: 'https://example.test/nist', evidenceText: 'Precision clocks at different gravitational potentials accumulate measurable time differences.' }] }
    },
    script,
    seo: {
      title: "Why Atomic Clocks Reveal Gravity's Effect on Time",
      description: 'Precision atomic-clock experiments make gravitational time dilation measurable on Earth. This explainer follows the evidence, connects the result to relativity, and shows why precise timing also matters for satellite navigation systems.',
      tags: ['atomic clocks', 'relativity', 'gravity', 'GPS', 'physics', 'science']
    },
    thumbnail: { path: 'thumbnail.png', concept: { subject: 'two precision atomic clocks at different elevations', composition: 'clear split comparison', text: 'TIME ≠ TIME' } },
    assets: {
      thumbnail: { path: 'thumbnail.png' },
      finalVideo: { path: 'final.mp4', simulated: false },
      sceneManifest: { visualBriefs: {
        s1: { quality: { accepted: true, specificity: 92, genericAiRisk: 10 } },
        s2: { quality: { accepted: true, specificity: 88, genericAiRisk: 14 } },
        s3: { quality: { accepted: true, specificity: 90, genericAiRisk: 12 } }
      } }
    },
    scenes: sections.map((section, index) => ({
      id: `s${index + 1}`, position: index, label: section.title, status: 'ready', narrationStatus: 'current',
      assetPath: `scene_${index + 1}.png`, assetOrigin: index === 0 ? 'licensed-source' : 'generated',
      rightsConfirmed: true, provider: index === 0 ? 'source:wikimedia' : 'image-provider',
      sourceAsset: index === 0 ? { id: 'asset1', rightsConfirmed: true, license: 'CC BY 4.0' } : null
    })),
    provenance: { status: 'verified', summary: { claimCount: 1, resolvedClaims: 1, unresolvedClaims: 0, verifiedSources: 1 } }
  };
}

function deep(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(deep).join(' ');
  if (typeof value === 'object') return Object.values(value).map(deep).join(' ');
  return String(value);
}

function sectionText(sections) {
  return sections.map(section => section.content).flat();
}

check('Phase 9 contract version is 9', () => assert.strictEqual(QUALITY_AGENTS_VERSION, 9));
check('five quality weights sum to 1', () => {
  assert.deepStrictEqual(Object.keys(QUALITY_AGENT_WEIGHTS).sort(), ['fact', 'retention', 'seo', 'thumbnail', 'visual']);
  assert(Math.abs(Object.values(QUALITY_AGENT_WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 0.0001);
});
check('science content is classified as scientific', () => assert.strictEqual(classifyContent(goodProduction()), 'scientific'));
check('healthy retention structure passes', () => assert.strictEqual(retentionAgent(goodProduction()).passed, true));
check('missing hook blocks Retention Agent', () => {
  const item = goodProduction(); item.script.hook = {}; item.script.fullScript = deep(item.script);
  const result = retentionAgent(item);
  assert.strictEqual(result.passed, false);
  assert(result.findings.some(entry => entry.id === 'retention_missing_hook' && entry.blocking));
});
check('severe repetition blocks retention', () => {
  const item = goodProduction();
  item.script.fullScript = Array(12).fill('This exact sentence repeats the same explanation without advancing the story.').join(' ');
  const result = retentionAgent(item);
  assert(repetitionRatio(item.script.fullScript) > 0.4);
  assert(result.findings.some(entry => entry.id === 'retention_repetition' && entry.blocking));
});
check('healthy thumbnail passes', () => assert.strictEqual(thumbnailAgent(goodProduction()).passed, true));
check('missing thumbnail asset blocks', () => {
  const item = goodProduction(); item.assets.thumbnail = {}; item.thumbnail.path = null;
  assert(thumbnailAgent(item).findings.some(entry => entry.id === 'thumbnail_missing_asset' && entry.blocking));
});
check('evergreen science title with artificial freshness blocks SEO', () => {
  const item = goodProduction(); item.seo.title = "Atomic Clocks in 2026: What's Changed?";
  const result = seoAgent(item);
  assert.strictEqual(result.metrics.temporalMismatch, true);
  assert(result.findings.some(entry => entry.id === 'seo_false_freshness' && entry.blocking));
});
check('healthy SEO passes', () => assert.strictEqual(seoAgent(goodProduction()).passed, true));
check('healthy visual manifest passes', () => assert.strictEqual(visualAgent(goodProduction()).passed, true));
check('unresolved source rights block Visual Quality Agent', () => {
  const item = goodProduction(); item.scenes[0].rightsConfirmed = false;
  const result = visualAgent(item);
  assert(result.findings.some(entry => entry.id === 'visual_rights' && entry.blocking));
});
check('high generic-AI risk can block visual quality', () => {
  const item = goodProduction();
  for (const brief of Object.values(item.assets.sceneManifest.visualBriefs)) brief.quality.genericAiRisk = 80;
  assert(visualAgent(item).findings.some(entry => entry.id === 'visual_generic_risk' && entry.blocking));
});
check('verified provenance passes Fact Quality Agent', () => assert.strictEqual(factAgent(goodProduction()).passed, true));
check('unresolved factual claims block Fact Quality Agent', () => {
  const item = goodProduction(); item.provenance.status = 'pending'; item.provenance.summary.unresolvedClaims = 2;
  const result = factAgent(item);
  assert.strictEqual(result.passed, false);
  assert(result.findings.some(entry => entry.id === 'fact_unresolved_claims' && entry.blocking));
});
check('declared claim without source URL blocks Fact Quality Agent', () => {
  const item = goodProduction(); item.script.claims[0].sourceUrls = [];
  assert(factAgent(item).findings.some(entry => entry.id === 'fact_declared_claims' && entry.blocking));
});
check('quality review returns five category scores and weighted overall score', async () => {
  let saved = null;
  const service = new QualityAgentsV9({ async saveQualityAgentReport(report) { saved = report; } }, { logger: { info() {}, warn() {}, error() {} } });
  const report = await service.review(goodProduction());
  assert.strictEqual(report.agents.length, 5);
  assert(Number.isInteger(report.overallScore));
  assert(report.overallScore >= 0 && report.overallScore <= 100);
  assert(saved && saved.fingerprint === report.fingerprint);
});
check('repair plan prioritizes blockers before advisories', () => {
  const plan = buildRepairPlan([
    { id: 'a', name: 'A', findings: [{ id: 'low', severity: 'LOW', blocking: false, message: 'low' }] },
    { id: 'b', name: 'B', findings: [{ id: 'block', severity: 'HIGH', blocking: true, message: 'block' }] }
  ]);
  assert.strictEqual(plan[0].findingId, 'block');
});
check('OperatorService integrates Phase 9 before approval result', () => {
  const source = fs.readFileSync(path.join(upstream, 'utils', 'operator-service.js'), 'utf8');
  assert(source.includes("const { QualityAgentsV9 } = require('./quality-agents-v9');"));
  assert(source.includes('const qualityAgents = await this.qualityAgents.review(qualityInput);'));
  assert(source.includes('qualityAgents,'));
});
check('SQLite persists and exposes quality agent reports', () => {
  const source = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
  assert(source.includes('CREATE TABLE IF NOT EXISTS quality_agent_reports'));
  assert(source.includes('async saveQualityAgentReport'));
  assert(source.includes('qualityAgentReport = await this.getLatestQualityAgentReport'));
  assert(source.includes('qualityAgentReport,'));
});
check('Review Studio renders per-agent scores and next repair action', () => {
  const source = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
  assert(source.includes('function renderQualityAgentReport(report)'));
  assert(source.includes('QUALITY AGENTS V'));
  assert(source.includes('renderQualityAgentReport(item.qualityAgentReport)'));
});
check('package exposes Phase 9 regression command', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.scripts['test:quality-agents'], 'node ../bootstrap/verify-phase9-quality-agents.js');
});

(async () => {
  for (const item of checks) await item.fn();
  console.log(`Phase 9 Quality Agents OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
