'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const policyPath = path.join(upstream, 'utils', 'fiction-evidence-policy-v5.js');
if (!fs.existsSync(policyPath)) throw new Error('Fiction evidence policy is not materialized: utils/fiction-evidence-policy-v5.js');

const {
  isExplicitFictionalNarrative,
  fictionEvidencePrompt,
  normalizePolicyText
} = require(policyPath);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('normalization strips accents for Portuguese policy matching', () => {
  assert.strictEqual(normalizePolicyText('Ficção infantil mágica'), 'ficcao infantil magica');
});

check('Story format defaults to fictional narrative mode', () => {
  assert.strictEqual(isExplicitFictionalNarrative({ contentType: 'Story' }), true);
});

check('stale Explainer checkpoint with explicit kids-cartoon instructions is recognized as fiction', () => {
  assert.strictEqual(isExplicitFictionalNarrative({
    contentType: 'Explainer',
    videoInstructions: 'Crie um episódio original de desenho animado infantil 2D com Luna, uma pequena coelha.'
  }), true);
});

check('ordinary Explainer remains factual and evidence-gated', () => {
  assert.strictEqual(isExplicitFictionalNarrative({
    contentType: 'Explainer',
    videoInstructions: 'Explain atomic clocks for a general audience.'
  }), false);
});

check('documentary intent overrides Story format', () => {
  assert.strictEqual(isExplicitFictionalNarrative({
    contentType: 'Story',
    videoInstructions: 'Create a documentary based on real events.'
  }), false);
});

check('true-story intent overrides nearby fictional wording', () => {
  assert.strictEqual(isExplicitFictionalNarrative({
    contentType: 'Story',
    videoInstructions: 'Use cinematic storytelling, but this is a true story based on real events, not fictional.'
  }), false);
});

check('fiction prompt requires claims to stay empty for pure fictional episodes', () => {
  const prompt = fictionEvidencePrompt({ contentType: 'Story' });
  assert(prompt.includes('claims: []'));
  assert(prompt.includes('NOT externally verifiable factual claims'));
  assert(prompt.includes('Do not introduce real-world statistics'));
});

check('factual formats receive no fiction bypass prompt', () => {
  assert.strictEqual(fictionEvidencePrompt({ contentType: 'Explainer' }), '');
});

check('ScriptWriter imports and applies the fiction evidence policy before Evidence Desk assertion', () => {
  const source = fs.readFileSync(path.join(upstream, 'agents', 'script-writer-agent.js'), 'utf8');
  assert(source.includes("require('../utils/fiction-evidence-policy-v5')"));
  assert(source.includes('const evidencePolicy = fictionEvidencePrompt(strategy);'));
  assert(source.includes("review.mode = 'fictional_narrative';"));
  assert(source.includes('script.claims = [];'));
  assert(source.includes("this.logger.info('Evidence Desk: fictional narrative mode active; fictional plot events are not evidence claims.');"));
});

check('normal factual path still calls strict Evidence Desk assertion', () => {
  const source = fs.readFileSync(path.join(upstream, 'agents', 'script-writer-agent.js'), 'utf8');
  const helperStart = source.indexOf('async verifyEvidenceBeforePersistence(script, strategy)');
  const helperEnd = source.indexOf('parseAIJsonResponse(response)', helperStart);
  const helper = source.slice(helperStart, helperEnd);
  assert(helper.includes('this.evidenceDesk.assertReview(review);'));
  assert(!helper.includes("process.env.EVIDENCE_STRICT_MODE = 'false'"));
});

check('package exposes dedicated fiction evidence regression command', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.scripts['test:evidence-fiction'], 'node ../bootstrap/verify-phase5-fiction-evidence.js');
});

(async () => {
  for (const item of checks) await item.fn();
  console.log(`Phase 5 fiction evidence hardening OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
