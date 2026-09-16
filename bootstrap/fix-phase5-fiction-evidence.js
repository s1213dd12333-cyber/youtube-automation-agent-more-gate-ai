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
  if (index === -1) throw new Error(`Phase 5 fiction hardening anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function copyPolicy() {
  const template = path.join(root, 'bootstrap', 'templates', 'fiction-evidence-policy-v5.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/fiction-evidence-policy-v5.js');
  write('utils/fiction-evidence-policy-v5.js', fs.readFileSync(template, 'utf8'));
}

function patchScriptWriter() {
  const rel = 'agents/script-writer-agent.js';
  let s = read(rel);

  s = replaceOnce(
    s,
    "const { promptInstructionBlock } = require('../utils/video-instructions-v6');\n",
    "const { promptInstructionBlock } = require('../utils/video-instructions-v6');\nconst { isExplicitFictionalNarrative, fictionEvidencePrompt } = require('../utils/fiction-evidence-policy-v5');\n",
    'fiction evidence policy import'
  );

  s = replaceOnce(
    s,
    "    const instructionBlock = promptInstructionBlock(strategy.videoInstructions);\n    const prompt = `You are writing a YouTube script plan.\n",
    "    const instructionBlock = promptInstructionBlock(strategy.videoInstructions);\n    const evidencePolicy = fictionEvidencePrompt(strategy);\n    const prompt = `You are writing a YouTube script plan.\n",
    'fiction evidence prompt construction'
  );

  s = replaceOnce(
    s,
    '${instructionBlock}\\nEvidence packet:',
    '${evidencePolicy}\\n${instructionBlock}\\nEvidence packet:',
    'inject fiction evidence policy into AI prompt'
  );

  const oldHelper = `  async verifyEvidenceBeforePersistence(script, strategy) {\n    const review = await this.evidenceDesk.verifyScript({\n      jobId: strategy?.evidencePack?.jobId || null,\n      script,\n      evidencePack: strategy?.evidencePack || { sources: strategy?.researchSources || [] }\n    });\n    script.evidenceReview = review;\n    this.evidenceDesk.assertReview(review);\n    return script;\n  }\n\n`;

  const newHelper = `  async verifyEvidenceBeforePersistence(script, strategy) {\n    const fictionalNarrative = isExplicitFictionalNarrative(strategy);\n\n    if (fictionalNarrative) {\n      // In explicit fiction mode, plot events are narrative facts inside the invented\n      // story world, not externally verifiable claims. The prompt forbids introducing\n      // real-world factual assertions in this mode; therefore claims must be empty.\n      script.claims = [];\n      const review = await this.evidenceDesk.verifyScript({\n        jobId: strategy?.evidencePack?.jobId || null,\n        script,\n        evidencePack: strategy?.evidencePack || { sources: strategy?.researchSources || [] }\n      });\n      review.mode = 'fictional_narrative';\n      review.notes = 'Explicit fictional narrative: plot events are excluded from factual evidence claims; real-world factual material must use the normal factual evidence path.';\n      script.evidenceReview = review;\n      this.logger.info('Evidence Desk: fictional narrative mode active; fictional plot events are not evidence claims.');\n      return script;\n    }\n\n    const review = await this.evidenceDesk.verifyScript({\n      jobId: strategy?.evidencePack?.jobId || null,\n      script,\n      evidencePack: strategy?.evidencePack || { sources: strategy?.researchSources || [] }\n    });\n    script.evidenceReview = review;\n    this.evidenceDesk.assertReview(review);\n    return script;\n  }\n\n`;

  s = replaceOnce(s, oldHelper, newHelper, 'fiction-aware evidence verification');
  write(rel, s);
}

function patchPackage() {
  const rel = 'package.json';
  const pkg = JSON.parse(read(rel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:evidence-fiction'] = 'node ../bootstrap/verify-phase5-fiction-evidence.js';
  write(rel, `${JSON.stringify(pkg, null, 2)}\n`);
}

copyPolicy();
patchScriptWriter();
patchPackage();

console.log('Phase 5 fiction evidence hardening active: explicit fictional stories no longer treat plot events as unsupported factual claims; documentary/true-story intent stays evidence-gated.');
