'use strict';

function normalizePolicyText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FACTUAL_STORY_MARKERS = [
  'true story',
  'based on real events',
  'based on a true story',
  'documentary',
  'documentario',
  'historia real',
  'relato real',
  'nonfiction',
  'non fiction',
  'nao ficcional',
  'biography',
  'biografia',
  'historical account',
  'factual story'
];

const FICTION_MARKERS = [
  'fictional',
  'fiction',
  'ficcional',
  'ficcao',
  'desenho animado infantil',
  'cartoon infantil',
  'kids cartoon',
  'children s story',
  'childrens story',
  'historia infantil',
  'episodio original de desenho animado',
  'original cartoon episode',
  'original fictional story',
  'historia completamente ficticia',
  'completely fictional story'
];

function containsAny(text, markers) {
  return markers.some(marker => text.includes(marker));
}

function isExplicitFictionalNarrative(strategy = {}) {
  const contentType = normalizePolicyText(strategy?.contentType || strategy?.format || '');
  const instructions = normalizePolicyText(
    strategy?.videoInstructions ||
    strategy?.instructions ||
    strategy?.instructionContext?.raw ||
    ''
  );

  // Explicit factual intent always wins. A documentary/true-story request must
  // never bypass the normal evidence gate just because its format is Story.
  if (containsAny(instructions, FACTUAL_STORY_MARKERS)) return false;

  // Story is the product's narrative/fiction format by default.
  if (contentType === 'story') return true;

  // Backward-compatibility for resumed jobs created with the old default
  // Explainer format but carrying explicit cartoon/fiction instructions.
  return containsAny(instructions, FICTION_MARKERS);
}

function fictionEvidencePrompt(strategy = {}) {
  if (!isExplicitFictionalNarrative(strategy)) return '';
  return [
    'FICTIONAL NARRATIVE EVIDENCE POLICY:',
    '- This video is an original fictional narrative, not a factual explainer or documentary.',
    '- Fictional characters, dialogue, magical events, invented places, plot actions, weather used only as story setting, and fictional object behavior are NOT externally verifiable factual claims.',
    '- Do not place fictional story events in the claims array.',
    '- For a pure fictional episode, return claims: [].',
    '- Do not introduce real-world statistics, scientific assertions, historical claims, medical claims, dates, studies, or factual trivia unless the user explicitly asks for them.',
    '- If real-world factual material is deliberately introduced, this request should use a factual format or explicitly disable fictional narrative mode so the normal Evidence Desk can verify it.'
  ].join('\n');
}

module.exports = {
  normalizePolicyText,
  isExplicitFictionalNarrative,
  fictionEvidencePrompt,
  FACTUAL_STORY_MARKERS,
  FICTION_MARKERS
};
