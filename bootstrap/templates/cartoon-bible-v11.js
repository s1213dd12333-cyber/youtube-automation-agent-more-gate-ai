'use strict';

const crypto = require('crypto');

const VERSION = '11.1';

function clean(value, limit = 4000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function slug(value) {
  return clean(value, 120).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'character';
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function unique(values) {
  const seen = new Set();
  return values.filter(value => {
    const key = clean(value, 160).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceText(production = {}) {
  const strategy = production.strategy || production.script?.metadata?.strategy || {};
  const script = production.script || {};
  const sections = Array.isArray(script.mainContent?.sections) ? script.mainContent.sections : [];
  return [
    strategy.topic,
    production.title,
    script.title,
    strategy.videoInstructions,
    script.hook?.text,
    script.introduction?.topicIntro,
    ...sections.flatMap(section => [section.title, Array.isArray(section.content) ? section.content.join(' ') : section.content]),
    ...(Array.isArray(script.conclusion?.recap) ? script.conclusion.recap : []),
    script.conclusion?.summary,
    script.conclusion?.finalThought
  ].filter(Boolean).join('\n');
}

function detectCartoonMode(production = {}, configuredMode = process.env.CARTOON_VISUAL_MODE || 'auto') {
  if (String(process.env.CARTOON_BIBLE_ENABLED || 'true').trim().toLowerCase() === 'false') return false;
  const mode = clean(configuredMode, 20).toLowerCase() || 'auto';
  if (['off', 'false', 'disabled'].includes(mode)) return false;
  if (['force', 'on', 'true', 'cartoon'].includes(mode)) return true;
  const text = sourceText(production).toLowerCase();
  return /\b(children|childrens|children's|kids?|kid-friendly|cartoon|animated|animation|2d|storybook|nursery|preschool|ages?\s*[2-9]|bunny|little star)\b/.test(text);
}

function extractInstructionCharacters(instructions) {
  const raw = String(instructions || '').replace(/\r/g, '');
  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean);
  const found = [];
  let role = null;
  for (const line of lines) {
    if (/^main character\s*:/i.test(line)) {
      role = 'main';
      const rest = line.replace(/^main character\s*:/i, '').trim();
      if (rest) found.push({ raw: rest, role });
      continue;
    }
    if (/^(supporting characters?|characters?)\s*:/i.test(line)) {
      role = 'supporting';
      const rest = line.replace(/^(supporting characters?|characters?)\s*:/i, '').trim();
      if (rest) {
        for (const item of rest.split(/\s*[;|]\s*/)) if (item.trim()) found.push({ raw: item.trim(), role });
      }
      continue;
    }
    if (role && /^[-*]\s+/.test(line)) found.push({ raw: line.replace(/^[-*]\s+/, ''), role });
  }
  return found;
}

function extractNamedCharacters(production = {}) {
  const strategy = production.strategy || production.script?.metadata?.strategy || {};
  const instructions = strategy.videoInstructions || production.videoInstructions || '';
  const explicit = extractInstructionCharacters(instructions);
  const text = sourceText(production);
  const candidates = [...explicit];

  for (const match of text.matchAll(/\b([A-Z][a-z]{2,18})(?:\s*,\s*(?:a|an|the)\s+([^\n.;]{2,80}))?/g)) {
    const name = match[1];
    if (/^(Create|Story|Visual|Main|Supporting|Use|Avoid|Keep|Human|Video|Topic|Instructions|Section|Conclusion|Opening|Character|Characters|Style|Background|Narration|Safety|Structure|Packaging|Do|The|This|Every|No|All)$/i.test(name)) continue;
    candidates.push({ raw: match[2] ? `${name}, a ${match[2]}` : name, role: 'supporting' });
  }

  const byName = new Map();
  for (const candidate of candidates) {
    const raw = clean(candidate.raw, 180).replace(/^[-*]\s+/, '');
    if (!raw) continue;
    const nameMatch = raw.match(/^([A-Z][A-Za-z0-9'-]{1,24})\b/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const key = name.toLowerCase();
    const descriptor = clean(raw.slice(name.length).replace(/^[,\s:-]+/, ''), 140);
    const previous = byName.get(key);
    if (!previous || (candidate.role === 'main' && previous.role !== 'main') || descriptor.length > previous.descriptor.length) {
      byName.set(key, { name, descriptor, role: candidate.role || previous?.role || 'supporting' });
    }
  }
  return [...byName.values()].slice(0, 8);
}

function inferSpecies(descriptor, text) {
  const options = ['star', 'cloud', 'bird', 'bunny', 'rabbit', 'bear', 'cat', 'dog', 'fox', 'dragon', 'robot', 'child', 'girl', 'boy'];
  const descriptorText = String(descriptor || '').toLowerCase();
  const direct = options.find(item => new RegExp(`\\b${item}s?\\b`, 'i').test(descriptorText));
  if (direct) return direct;
  const context = String(text || '').toLowerCase();
  return options.find(item => new RegExp(`\\b${item}s?\\b`, 'i').test(context)) || 'original cartoon character';
}

function inferPersonality(name, descriptor, text) {
  const local = `${name} ${descriptor} ${text}`.toLowerCase();
  const traits = [];
  for (const [pattern, trait] of [
    [/shy|timid/, 'shy and gentle'], [/cheerful|happy|joyful/, 'cheerful and energetic'],
    [/curious/, 'curious and attentive'], [/kind|caring|gentle/, 'kind and caring'],
    [/brave/, 'brave but child-safe'], [/playful|fun/, 'playful and friendly']
  ]) if (pattern.test(local)) traits.push(trait);
  return unique(traits).slice(0, 3).join(', ') || 'friendly, expressive, and emotionally readable';
}

function characterProfile(entry, productionText, index) {
  const speciesType = inferSpecies(entry.descriptor, `${entry.name} ${productionText}`);
  const paletteByIndex = [
    ['sunny yellow', 'warm gold', 'soft cream'],
    ['sky blue', 'powder blue', 'white'],
    ['tangerine', 'sunny yellow', 'warm cream'],
    ['mint green', 'teal', 'soft cream'],
    ['coral pink', 'peach', 'cream']
  ];
  const palette = paletteByIndex[index % paletteByIndex.length];
  return {
    id: `char_${slug(entry.name)}`,
    name: entry.name,
    role: entry.role === 'main' ? 'main' : 'supporting',
    speciesType,
    descriptor: entry.descriptor || `${speciesType} character`,
    personality: inferPersonality(entry.name, entry.descriptor, productionText),
    palette,
    proportions: 'large readable head/face, compact rounded body, short simple limbs, stable proportions across every frame',
    face: 'large expressive eyes, simple readable mouth, friendly child-safe expression language',
    shapeLanguage: 'soft rounded silhouette with no sharp threatening geometry',
    outfit: 'keep the same outfit, markings, accessories, and color placement in every shot unless the script explicitly changes them',
    props: [],
    expressions: ['neutral-friendly', 'happy', 'curious', 'concerned-gentle', 'excited'],
    poses: ['front three-quarter', 'side action', 'reaction close-up', 'simple walking/floating pose'],
    continuityRules: [
      'preserve silhouette and body proportions',
      'preserve eye shape and facial landmarks',
      'preserve palette and color placement',
      'preserve outfit/accessories/markings',
      'never add extra limbs, fingers, wings, ears, tails, or props'
    ],
    avoid: ['photorealism', 'adult facial proportions', 'horror expressions', 'uncanny skin/fur detail', 'random costume changes', 'extra limbs']
  };
}

function styleBible(production = {}) {
  const strategy = production.strategy || production.script?.metadata?.strategy || {};
  const instructions = clean(strategy.videoInstructions, 4000);
  return {
    id: 'style_kids_cartoon_2d_v11_1',
    mode: 'kids_cartoon_2d',
    audience: 'children',
    artDirection: 'original polished 2D children\'s cartoon / storybook frame, simple readable staging, warm friendly emotion, animation-ready composition',
    lineStyle: 'clean consistent outlines, rounded corners, no scratchy realism, no pseudo-3D texture noise',
    palette: 'bright harmonious child-friendly palette with controlled saturation and stable character colors',
    background: 'simple layered backgrounds with clear depth, low clutter, recurring location landmarks preserved between adjacent shots',
    lighting: 'soft cheerful daylight or story-appropriate warm light; no horror lighting or aggressive contrast',
    cameraLanguage: 'clear wide/medium/close-up storytelling; one dominant action per frame; readable silhouettes; avoid random cinematic angles',
    shapeLanguage: 'rounded friendly shapes, simple iconic props, large readable facial expressions',
    texture: 'flat-to-soft painted 2D texture, minimal grain, no photoreal surface detail',
    consistencyPriority: 'character identity > story action > composition novelty > decorative detail',
    forbidden: [
      'photorealism', 'generic stock illustration', 'random fantasy clutter', 'unmotivated neon glow', 'horror imagery',
      'copyrighted franchise characters', 'logos', 'watermarks', 'embedded captions', 'random text', 'extra limbs',
      'inconsistent costume or markings', 'hyper-detailed backgrounds that compete with the characters'
    ],
    userDirection: instructions || null
  };
}

function promptContext(bible = {}) {
  if (!bible || bible.mode !== 'kids_cartoon_2d') return '';
  const characters = (bible.characters || []).map(character => [
    `${character.name} (${character.role}; ${character.speciesType})`,
    `design=${character.descriptor}`,
    `palette=${(character.palette || []).join('/')}`,
    `proportions=${character.proportions}`,
    `face=${character.face}`,
    `continuity=${(character.continuityRules || []).join(', ')}`
  ].join('; '));
  const style = bible.style || {};
  return [
    'CARTOON BIBLE V11.1:',
    `STYLE MODE: ${style.mode || 'kids_cartoon_2d'}`,
    `ART DIRECTION: ${style.artDirection || ''}`,
    `LINE STYLE: ${style.lineStyle || ''}`,
    `PALETTE: ${style.palette || ''}`,
    `BACKGROUND: ${style.background || ''}`,
    `CAMERA LANGUAGE: ${style.cameraLanguage || ''}`,
    `CONSISTENCY PRIORITY: ${style.consistencyPriority || ''}`,
    characters.length ? `CHARACTER BIBLE: ${characters.join(' || ')}` : 'CHARACTER BIBLE: preserve every named character exactly as established in prior frames.',
    `CARTOON AVOID: ${(style.forbidden || []).join('; ')}`
  ].join('\n');
}

class CartoonBibleV11 {
  constructor(options = {}) {
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.mode = options.mode || process.env.CARTOON_VISUAL_MODE || 'auto';
  }

  buildProductionBible(production = {}) {
    if (!detectCartoonMode(production, this.mode)) return null;
    const text = sourceText(production);
    const strategy = production.strategy || production.script?.metadata?.strategy || {};
    let entries = extractNamedCharacters(production);
    if (!entries.length) {
      const fallbackName = clean(strategy.topic || production.script?.title || 'Main Character', 60).split(/\s+/).slice(0, 2).join(' ');
      entries = [{ name: /^[A-Z]/.test(fallbackName) ? fallbackName : 'Main Character', descriptor: 'original child-friendly protagonist', role: 'main' }];
    }
    if (!entries.some(item => item.role === 'main')) entries[0].role = 'main';
    const characters = entries.map((entry, index) => characterProfile(entry, text, index));
    const style = styleBible(production);
    const sourceFingerprint = hash(JSON.stringify({
      topic: strategy.topic || production.script?.title || '',
      instructions: strategy.videoInstructions || '',
      characters: characters.map(item => ({ name: item.name, descriptor: item.descriptor, role: item.role })),
      style: style.id
    }));
    const bible = {
      version: VERSION,
      productionId: production.id || null,
      mode: 'kids_cartoon_2d',
      fingerprint: sourceFingerprint,
      characters,
      style,
      summary: {
        characterCount: characters.length,
        mainCharacter: characters.find(item => item.role === 'main')?.name || characters[0]?.name || null,
        styleMode: style.mode,
        consistencyStrict: true
      },
      createdAt: new Date().toISOString()
    };
    bible.promptContext = promptContext(bible);
    return bible;
  }

  applyToVisualPlan(plan, bible) {
    if (!plan || !bible) return plan;
    const context = bible.promptContext || promptContext(bible);
    const briefs = {};
    const scenes = (plan.scenes || []).map(scene => {
      const previousBrief = scene.visualBrief || plan.briefs?.[scene.id] || null;
      const brief = previousBrief ? {
        ...previousBrief,
        visualType: 'kids_cartoon_2d',
        cartoonBibleVersion: VERSION,
        cartoonBibleFingerprint: bible.fingerprint,
        characterRefs: bible.characters.map(character => character.id),
        identity: {
          ...(previousBrief.identity || {}),
          name: 'Lumen Kids Cartoon Bible v11.1',
          style: bible.style.artDirection,
          palette: bible.style.palette,
          lighting: bible.style.lighting,
          composition: bible.style.cameraLanguage
        }
      } : null;
      const basePrompt = clean(previousBrief?.prompt || scene.prompt, 8000);
      const prompt = `${context}\n\nSHOT/SCENE DIRECTION:\n${basePrompt}`.slice(0, 12000);
      if (brief) {
        brief.prompt = prompt;
        briefs[scene.id] = brief;
      }
      return { ...scene, prompt, visualBrief: brief || previousBrief };
    });
    return {
      ...plan,
      identity: {
        ...(plan.identity || {}),
        name: 'Lumen Kids Cartoon Bible v11.1',
        mode: bible.mode,
        bibleFingerprint: bible.fingerprint
      },
      briefs: { ...(plan.briefs || {}), ...briefs },
      scenes,
      cartoonBible: bible,
      summary: { ...(plan.summary || {}), cartoonBibleVersion: VERSION, characterCount: bible.characters.length }
    };
  }
}

module.exports = {
  CARTOON_BIBLE_VERSION: VERSION,
  CartoonBibleV11,
  detectCartoonMode,
  extractNamedCharacters,
  promptContext
};
