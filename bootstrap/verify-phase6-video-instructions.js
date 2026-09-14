'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const servicePath = path.join(upstream, 'utils', 'video-instructions-v6.js');
if (!fs.existsSync(servicePath)) throw new Error('Phase 6 service is not materialized: utils/video-instructions-v6.js');

const {
  MAX_VIDEO_INSTRUCTIONS,
  normalizeVideoInstructions,
  instructionEnvelope,
  extractResearchFocus,
  promptInstructionBlock,
  visualInstructionSuffix
} = require(servicePath);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('instructions normalize line endings and trim whitespace', () => {
  assert.strictEqual(normalizeVideoInstructions('  Focus on clocks.\r\nUse diagrams.  '), 'Focus on clocks.\nUse diagrams.');
});

check('non-string instructions are rejected', () => {
  assert.throws(() => normalizeVideoInstructions({ focus: 'clocks' }), error => error.code === 'VIDEO_INSTRUCTIONS_INVALID');
});

check('instructions have a hard 4000 character request limit', () => {
  assert.strictEqual(MAX_VIDEO_INSTRUCTIONS, 4000);
  assert.throws(() => normalizeVideoInstructions('x'.repeat(4001)), error => error.code === 'VIDEO_INSTRUCTIONS_TOO_LONG');
});

check('instruction envelopes are deterministic and auditable', () => {
  const a = instructionEnvelope('Focus on NIST atomic clocks.');
  const b = instructionEnvelope('Focus on NIST atomic clocks.');
  assert.strictEqual(a.version, 6);
  assert.strictEqual(a.hash, b.hash);
  assert.strictEqual(a.present, true);
  assert(a.policy.includes('never override evidence'));
});

check('explicit positive focus can enrich research query', () => {
  assert.strictEqual(extractResearchFocus('Focus on NIST atomic clocks and GPS corrections. Avoid sci-fi.'), 'NIST atomic clocks and GPS corrections');
  assert.strictEqual(extractResearchFocus('Avoid speculation and neon visuals.'), '');
});

check('prompt block labels instructions as lower-priority preferences', () => {
  const block = promptInstructionBlock('Explain for a non-technical audience.');
  assert(block.includes('<video_instructions>'));
  assert(block.includes('preferences only'));
  assert(block.includes('never override evidence'));
});

check('visual suffix preserves hard guardrails', () => {
  const suffix = visualInstructionSuffix('Prefer scientific diagrams.');
  assert(suffix.includes('Prefer scientific diagrams.'));
  assert(suffix.includes('compatible with factual accuracy, evidence, rights, and safety'));
});

check('generation API validates and forwards per-video instructions', () => {
  const source = fs.readFileSync(path.join(upstream, 'index.js'), 'utf8');
  assert(source.includes("const { normalizeVideoInstructions, instructionEnvelope } = require('./utils/video-instructions-v6');"));
  assert(source.includes("instructions: ''"));
  assert(source.includes('value.instructions = normalizeVideoInstructions(body.instructions);'));
  assert(source.includes("this.startGenerationJob({ ...validation.value, source: 'manual' })"));
});

check('job persistence and Resume retain the same instructions', () => {
  const db = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
  const index = fs.readFileSync(path.join(upstream, 'index.js'), 'utf8');
  assert(db.includes('videoInstructions: typeof input.instructions'));
  assert(index.includes("instructions: job.details?.videoInstructions || ''"));
  assert(index.includes('instructions: input.instructions'));
});

check('canonical strategy carries instruction text and envelope', () => {
  const source = fs.readFileSync(path.join(upstream, 'index.js'), 'utf8');
  assert(source.includes('generated.videoInstructions = videoInstructions;'));
  assert(source.includes('generated.instructionContext = instructionContext;'));
});

check('Research Agent receives instruction focus without treating it as evidence', () => {
  const source = fs.readFileSync(path.join(upstream, 'utils', 'research-evidence-v5.js'), 'utf8');
  assert(source.includes("const instructionContext = instructionEnvelope(input.instructions);"));
  assert(source.includes('const researchQuery = [topic, instructionContext.researchFocus]'));
  assert(source.includes('instructionContext,'));
  assert(!source.includes('evidenceText: instructionContext'));
});

check('script prompt receives instructions before the evidence packet', () => {
  const source = fs.readFileSync(path.join(upstream, 'agents', 'script-writer-agent.js'), 'utf8');
  const instruction = source.indexOf('const instructionBlock = promptInstructionBlock(strategy.videoInstructions);');
  const evidence = source.indexOf('Evidence packet:');
  assert(instruction >= 0 && evidence > instruction);
});

check('script generation refuses a generic fallback when instructions would be ignored', () => {
  const source = fs.readFileSync(path.join(upstream, 'agents', 'script-writer-agent.js'), 'utf8');
  assert(source.includes("error.code = 'VIDEO_INSTRUCTIONS_UNAPPLIED'"));
  assert(source.includes('refusing generic template fallback'));
});

check('SEO prompt receives the same per-video instructions', () => {
  const source = fs.readFileSync(path.join(upstream, 'agents', 'seo-optimizer-agent.js'), 'utf8');
  assert(source.includes("promptInstructionBlock(strategy.videoInstructions)"));
  assert(source.includes('${instructionBlock}'));
});

check('thumbnail and scene visual direction retain instructions', () => {
  const thumbnail = fs.readFileSync(path.join(upstream, 'agents', 'thumbnail-designer-agent.js'), 'utf8');
  const scenes = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
  assert(thumbnail.includes("videoInstructions: script.metadata?.strategy?.videoInstructions || ''"));
  assert(thumbnail.includes('Video-specific direction: ${concept.videoInstructions'));
  assert(scenes.includes('visualInstructionSuffix(production.strategy?.videoInstructions'));
});

check('New Generation Job exposes a 4000-character Instructions field', () => {
  const html = fs.readFileSync(path.join(upstream, 'dashboard', 'index.html'), 'utf8');
  assert(html.includes('name="instructions"'));
  assert(html.includes('maxlength="4000"'));
  assert(html.includes('applies only to this video'));
});

check('Review Studio exposes the instructions and their policy boundary', () => {
  const app = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
  assert(app.includes('const videoInstructions = item.strategy?.videoInstructions'));
  assert(app.includes('VIDEO INSTRUCTIONS'));
  assert(app.includes('never override evidence, safety, rights, platform, approval, or publishing guardrails'));
});

(async () => {
  for (const item of checks) await item.fn();
  console.log(`Phase 6 per-video instructions OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
