'use strict';

const crypto = require('crypto');

const MAX_VIDEO_INSTRUCTIONS = 4000;
const POLICY = 'video preferences are advisory and never override evidence, factual-safety, media-rights, platform, approval, or publishing guardrails';

function normalizeVideoInstructions(value, options = {}) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    const error = new Error('instructions must be a string');
    error.code = 'VIDEO_INSTRUCTIONS_INVALID';
    error.status = 400;
    throw error;
  }
  const max = Math.max(1, Number(options.maxLength || MAX_VIDEO_INSTRUCTIONS));
  const normalized = value.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
  if (normalized.length > max) {
    const error = new Error(`instructions must be ${max} characters or less`);
    error.code = 'VIDEO_INSTRUCTIONS_TOO_LONG';
    error.status = 400;
    throw error;
  }
  return normalized;
}

function instructionHash(value) {
  const normalized = normalizeVideoInstructions(value);
  return normalized ? crypto.createHash('sha256').update(normalized).digest('hex') : null;
}

function extractResearchFocus(value) {
  const text = normalizeVideoInstructions(value);
  if (!text) return '';
  const match = text.match(/(?:focus\s+on|emphasize|prioritize|cover|include)\s*[:\-]?\s*([^\n.!?]{3,240})/i);
  return match ? match[1].trim().slice(0, 240) : '';
}

function instructionEnvelope(value) {
  const text = normalizeVideoInstructions(value);
  return {
    version: 6,
    text,
    present: Boolean(text),
    hash: instructionHash(text),
    researchFocus: extractResearchFocus(text),
    maxLength: MAX_VIDEO_INSTRUCTIONS,
    policy: POLICY
  };
}

function promptInstructionBlock(value) {
  const text = normalizeVideoInstructions(value);
  if (!text) return 'VIDEO-SPECIFIC OPERATOR INSTRUCTIONS: none.';
  return [
    'VIDEO-SPECIFIC OPERATOR INSTRUCTIONS (preferences only):',
    '<video_instructions>',
    text,
    '</video_instructions>',
    `Instruction policy: ${POLICY}.`
  ].join('\n');
}

function visualInstructionSuffix(value) {
  const text = normalizeVideoInstructions(value);
  if (!text) return '';
  return `\nVideo-specific visual direction (apply only when compatible with factual accuracy, evidence, rights, and safety): ${text}`;
}

module.exports = {
  MAX_VIDEO_INSTRUCTIONS,
  VIDEO_INSTRUCTION_POLICY: POLICY,
  normalizeVideoInstructions,
  instructionHash,
  extractResearchFocus,
  instructionEnvelope,
  promptInstructionBlock,
  visualInstructionSuffix
};
