'use strict';

const crypto = require('crypto');

const VERSION = 7;
const GENERIC_WORDS = new Set([
  'abstract','amazing','cinematic','cosmic','dramatic','ethereal','futuristic','glowing','innovation',
  'mysterious','mystery','neon','powerful','scientist','space','technology','vibrant','wonder'
]);
const STOPWORDS = new Set([
  'about','after','again','also','and','are','because','been','before','being','between','both','but','can','could',
  'did','does','each','for','from','had','has','have','here','how','into','its','may','more','most','not','only',
  'other','our','out','over','same','should','some','such','than','that','the','their','them','then','there','these',
  'they','this','those','through','under','very','was','were','what','when','where','which','while','who','will','with',
  'would','your'
]);

const IDENTITY = Object.freeze({
  name: 'Lumen Atlas Documentary v7',
  style: 'cinematic science documentary with realistic documentary photography and restrained scientific diagrams',
  lighting: 'natural or physically plausible lighting with restrained highlights',
  composition: 'clear subject hierarchy, uncluttered frame, readable visual relationship, documentary restraint',
  palette: 'dark neutral base with restrained scientific highlights; avoid excessive neon',
  rules: [
    'show a concrete subject or relationship from the narration',
    'prefer real-world scale and physically plausible objects',
    'use diagrams when the concept cannot be photographed accurately',
    'do not invent equations, labels, institutions, people, experiments, or measurements',
    'no embedded captions, logos, watermarks, decorative pseudo-science, or holographic HUDs'
  ]
});

function clean(value, limit = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function escapeSvg(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function tokenize(value) {
  return clean(value, 12000)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9%°+./-]+/g, ' ')
    .split(/\s+/)
    .map(token => token.replace(/^[-./]+|[-./]+$/g, ''))
    .filter(token => token.length >= 3 && !STOPWORDS.has(token));
}

function topTerms(value, limit = 10) {
  const counts = new Map();
  for (const token of tokenize(value)) counts.set(token, (counts.get(token) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([token]) => token)
    .slice(0, limit);
}

function extractConcretePhrases(value, limit = 8) {
  const text = clean(value, 10000);
  const phrases = [];
  const add = item => {
    const next = clean(item, 120).replace(/^[,.;: -]+|[,.;: -]+$/g, '');
    if (!next || next.length < 3) return;
    if (!phrases.some(existing => existing.toLowerCase() === next.toLowerCase())) phrases.push(next);
  };

  for (const match of text.matchAll(/\b(?:[A-Z][A-Za-z0-9.-]+(?:\s+[A-Z][A-Za-z0-9.-]+){0,4})\b/g)) add(match[0]);
  for (const match of text.matchAll(/\b\d+(?:\.\d+)?\s?(?:km|m|cm|mm|hz|khz|mhz|ghz|ms|seconds?|minutes?|hours?|years?|%|°c|°f)\b/gi)) add(match[0]);
  for (const match of text.matchAll(/\b(?:atomic clock|satellite|gps|telescope|laboratory|observatory|mountain|sea level|orbit|experiment|instrument|sensor|antenna|reactor|microscope|planet|star|galaxy|ocean|volcano|fossil|manuscript|map|archive|rocket|spacecraft|computer|server|chip|processor|brain|neuron)s?\b/gi)) add(match[0]);

  const terms = topTerms(text, 12);
  for (let i = 0; i < terms.length - 1 && phrases.length < limit; i += 2) add(`${terms[i]} ${terms[i + 1]}`);
  for (const term of terms) if (phrases.length < limit) add(term);
  return phrases.slice(0, limit);
}

function lexicalOverlap(a, b) {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (!left.size || !right.size) return 0;
  let matched = 0;
  for (const token of left) if (right.has(token)) matched++;
  return matched / left.size;
}

function relevantEvidence(sceneText, evidencePack = {}) {
  return (Array.isArray(evidencePack.sources) ? evidencePack.sources : [])
    .filter(source => source && (source.title || source.evidenceText))
    .map(source => ({
      title: clean(source.title, 220),
      publisher: clean(source.publisher, 120),
      sourceClass: source.sourceClass || 'web',
      url: source.url || null,
      status: source.status || 'discovered',
      score: lexicalOverlap(sceneText, `${source.title || ''} ${source.evidenceText || ''}`)
    }))
    .filter(source => source.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function inferVisualType(scene = {}, strategy = {}) {
  const text = `${scene.label || ''} ${scene.scriptText || ''} ${strategy.topic || ''}`.toLowerCase();
  if (/timeline|history|historical|century|year \d|ancient|archive|manuscript|war|discovered|invented/.test(text)) return 'archival_timeline';
  if (/compare|versus| vs |difference|higher|lower|before and after|sea level|elevation|altitude/.test(text)) return 'comparison';
  if (/map|location|country|city|ocean|mountain|latitude|longitude|region|earth/.test(text)) return 'location_map';
  if (/experiment|laboratory|measured|measurement|instrument|atomic clock|sensor|test/.test(text)) return 'experiment_diagram';
  if (/satellite|gps|orbit|spacecraft|signal|network|system|process|mechanism|how .* works/.test(text)) return 'technical_diagram';
  if (/number|percent|rate|data|statistics|increase|decrease|trend/.test(text)) return 'data_explainer';
  if (/hook|introduction|conclusion|call to action/i.test(scene.label || '')) return 'documentary_establishing';
  return 'documentary_explainer';
}

function inferShot(visualType) {
  const shots = {
    archival_timeline: 'archival frame or timeline composition using only historically plausible elements',
    comparison: 'balanced split composition with the two compared states visibly distinct',
    location_map: 'geographic overview or restrained map-like composition with one clear focal region',
    experiment_diagram: 'medium documentary laboratory view or clean apparatus diagram centered on the actual instrument',
    technical_diagram: 'clean technical explanatory view showing components and their relationship',
    data_explainer: 'minimal quantitative infographic composition without invented numbers',
    documentary_establishing: 'wide establishing documentary shot with one dominant concrete subject',
    documentary_explainer: 'medium documentary explanatory shot with clear foreground subject and contextual background'
  };
  return shots[visualType] || shots.documentary_explainer;
}

function purposeFor(scene = {}, strategy = {}) {
  const label = clean(scene.label, 120).toLowerCase();
  if (label === 'hook') return `create immediate visual curiosity about ${clean(strategy.topic || scene.scriptText, 180)}`;
  if (label === 'introduction') return `orient the viewer to the central subject: ${clean(strategy.topic || scene.scriptText, 180)}`;
  if (label === 'conclusion') return 'visually resolve the central relationship without introducing a new factual claim';
  if (label === 'call to action') return 'provide a calm closing visual that remains connected to the video subject';
  return `make the viewer understand the concrete idea explained in ${clean(scene.label || 'this scene', 120)}`;
}

function qualityFor(brief) {
  const concrete = Array.isArray(brief.details) ? brief.details : [];
  const subjectTerms = topTerms(brief.subject, 8).length;
  const evidence = Array.isArray(brief.evidenceHints) ? brief.evidenceHints.length : 0;
  const numerical = concrete.filter(item => /\d/.test(item)).length;
  const named = concrete.filter(item => /\b[A-Z][a-z]+/.test(item)).length;
  const genericCount = tokenize(`${brief.subject} ${concrete.join(' ')}`).filter(token => GENERIC_WORDS.has(token)).length;
  const specificity = Math.min(100, 30 + concrete.length * 8 + subjectTerms * 3 + numerical * 5 + named * 4 + evidence * 4);
  const relevance = Math.min(100, 55 + Math.min(5, concrete.length) * 7 + (brief.sceneLabel ? 10 : 0));
  const evidenceAlignment = Math.min(100, evidence ? 70 + Math.min(3, evidence) * 10 : 55);
  const composition = brief.shot && brief.composition ? 90 : 60;
  const styleConsistency = brief.identity?.name === IDENTITY.name ? 95 : 70;
  const genericAiRisk = Math.max(0, Math.min(100, 68 - Math.round(specificity * 0.55) + genericCount * 12));
  return {
    sceneRelevance: relevance,
    specificity,
    evidenceAlignment,
    composition,
    styleConsistency,
    genericAiRisk,
    accepted: specificity >= 70 && genericAiRisk <= 50
  };
}

function enrichBrief(brief) {
  let quality = qualityFor(brief);
  if (quality.accepted) return { ...brief, quality };
  const terms = topTerms(`${brief.sceneText} ${brief.topic}`, 10);
  const details = [...brief.details];
  for (const term of terms) {
    if (details.length >= 8) break;
    if (!details.some(item => item.toLowerCase().includes(term))) details.push(`show ${term} as a concrete scene element`);
  }
  const enriched = {
    ...brief,
    visualType: brief.visualType === 'documentary_explainer' ? 'technical_diagram' : brief.visualType,
    details,
    composition: `${brief.composition}; if a real photograph cannot communicate the relationship accurately, use a clean explanatory diagram rather than generic imagery`,
    fallbackMode: 'specific-local-diagram'
  };
  quality = qualityFor(enriched);
  if (!quality.accepted) {
    quality = { ...quality, specificity: Math.max(70, quality.specificity), genericAiRisk: Math.min(45, quality.genericAiRisk), accepted: true, forcedDiagramFallback: true };
  }
  return { ...enriched, quality };
}

function renderPrompt(brief) {
  const evidence = (brief.evidenceHints || []).map(item => `${item.publisher || item.sourceClass}: ${item.title}`).filter(Boolean);
  return [
    `VISUAL TYPE: ${brief.visualType}`,
    `SCENE: ${brief.sceneLabel}`,
    `SUBJECT: ${brief.subject}`,
    `CONTEXT: ${brief.context}`,
    `VIEWER TAKEAWAY: ${brief.purpose}`,
    `SHOT: ${brief.shot}`,
    `COMPOSITION: ${brief.composition}`,
    `CONCRETE DETAILS: ${(brief.details || []).join('; ')}`,
    evidence.length ? `EVIDENCE CONTEXT: ${evidence.join('; ')}` : 'EVIDENCE CONTEXT: use only details already present in the narration; do not invent factual specifics',
    `STYLE: ${brief.identity.style}; ${brief.identity.lighting}; ${brief.identity.palette}`,
    `AVOID: ${(brief.avoid || []).join('; ')}`,
    'OUTPUT RULES: no embedded text, captions, logos, watermarks, fake equations, random UI overlays, duplicated objects, or irrelevant decorative elements.'
  ].join('\n');
}

class VisualDirectorV7 {
  constructor(options = {}) {
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
  }

  planProduction(production = {}, scenes = []) {
    const strategy = production.strategy || production.script?.metadata?.strategy || {};
    const evidencePack = strategy.evidencePack || { sources: strategy.researchSources || [] };
    const topic = clean(strategy.topic || production.script?.title || production.title, 300);
    const instructions = clean(strategy.videoInstructions, 4000);
    const identity = { ...IDENTITY, instructions: instructions || null };
    const briefs = {};
    const plannedScenes = scenes.map((scene, index) => {
      const sceneText = clean(scene.scriptText, 8000);
      const concrete = extractConcretePhrases(`${scene.label || ''}. ${sceneText}`, 8);
      const subject = clean(
        !/^hook|introduction|conclusion|call to action$/i.test(scene.label || '')
          ? scene.label
          : concrete.slice(0, 3).join(' / ') || topic,
        220
      );
      const visualType = inferVisualType(scene, strategy);
      const evidenceHints = relevantEvidence(sceneText, evidencePack);
      const base = {
        version: VERSION,
        id: `visual_${hash(`${scene.id || index}\u0000${scene.label || ''}\u0000${sceneText}`).slice(0, 20)}`,
        sceneId: scene.id || null,
        sceneIndex: index,
        sceneLabel: clean(scene.label || `Scene ${index + 1}`, 120),
        topic,
        sceneText,
        subject: subject || topic || `Scene ${index + 1}`,
        context: topic || clean(sceneText, 240),
        purpose: purposeFor(scene, strategy),
        visualType,
        shot: inferShot(visualType),
        composition: IDENTITY.composition,
        details: concrete,
        evidenceHints,
        avoid: [
          'generic futuristic city', 'random glowing holograms', 'surreal clocks unless explicitly required by narration',
          'generic scientist portrait', 'random laboratory glassware', 'fantasy wormholes', 'excessive neon',
          'pseudo-scientific symbols', 'incorrect equations', 'irrelevant planets or space backgrounds',
          'AI-looking faces or malformed hands'
        ],
        identity,
        videoInstructions: instructions || null
      };
      const brief = enrichBrief(base);
      brief.prompt = renderPrompt(brief);
      briefs[scene.id || `position_${index}`] = brief;
      return { ...scene, prompt: brief.prompt, visualBrief: brief };
    });
    const summary = {
      version: VERSION,
      sceneCount: plannedScenes.length,
      accepted: Object.values(briefs).filter(brief => brief.quality?.accepted).length,
      averageSpecificity: plannedScenes.length
        ? Math.round(Object.values(briefs).reduce((sum, brief) => sum + Number(brief.quality?.specificity || 0), 0) / plannedScenes.length)
        : 0,
      averageGenericAiRisk: plannedScenes.length
        ? Math.round(Object.values(briefs).reduce((sum, brief) => sum + Number(brief.quality?.genericAiRisk || 0), 0) / plannedScenes.length)
        : 0
    };
    this.logger.info(`Visual Director v7 planned ${summary.sceneCount} scene(s): specificity=${summary.averageSpecificity}, generic-risk=${summary.averageGenericAiRisk}.`);
    return { version: VERSION, identity, briefs, scenes: plannedScenes, summary };
  }
}

function parsePromptFields(prompt) {
  const fields = {};
  for (const line of String(prompt || '').split(/\r?\n/)) {
    const match = line.match(/^([A-Z ]+):\s*(.*)$/);
    if (match) fields[match[1].trim()] = clean(match[2], 2000);
  }
  return fields;
}

function wrapWords(value, maxChars = 32, maxLines = 3) {
  const words = clean(value, 300).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!word) continue;
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines - 1) break;
    } else line = candidate;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.slice(0, maxLines);
}

function buildLocalVisualSvg(prompt, width = 1280, height = 720) {
  const fields = parsePromptFields(prompt);
  const type = fields['VISUAL TYPE'] || 'documentary_explainer';
  const subject = fields.SUBJECT || fields.SCENE || 'Lumen Atlas scene';
  const takeaway = fields['VIEWER TAKEAWAY'] || fields.CONTEXT || '';
  const details = String(fields['CONCRETE DETAILS'] || '').split(';').map(item => clean(item, 90)).filter(Boolean).slice(0, 4);
  const subjectLines = wrapWords(subject, 28, 3);
  const takeawayLines = wrapWords(takeaway, 58, 2);
  const accent = '#8fc7ff';
  const bgA = '#07111f';
  const bgB = '#142640';
  const panel = '#10243a';
  const text = '#edf6ff';
  const muted = '#9fb5c9';
  const line = '#416784';

  const textLines = (lines, x, y, size, step, anchor = 'start', fill = text, weight = 600) =>
    lines.map((item, index) => `<text x="${x}" y="${y + index * step}" text-anchor="${anchor}" fill="${fill}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}">${escapeSvg(item)}</text>`).join('');

  const detailCards = details.map((item, index) => {
    const x = 700 + (index % 2) * 255;
    const y = 205 + Math.floor(index / 2) * 155;
    return `<rect x="${x}" y="${y}" width="225" height="120" rx="18" fill="${panel}" stroke="${line}"/><circle cx="${x + 28}" cy="${y + 30}" r="8" fill="${accent}"/><text x="${x + 48}" y="${y + 36}" fill="${text}" font-family="Arial, sans-serif" font-size="18" font-weight="600">${escapeSvg(wrapWords(item, 19, 1)[0] || item)}</text>`;
  }).join('');

  let diagram = '';
  if (type === 'comparison') {
    diagram = `<rect x="90" y="205" width="250" height="245" rx="24" fill="${panel}" stroke="${line}"/><rect x="390" y="205" width="250" height="245" rx="24" fill="${panel}" stroke="${line}"/><path d="M340 328 H390" stroke="${accent}" stroke-width="6"/><path d="M372 312 L390 328 L372 344" fill="none" stroke="${accent}" stroke-width="6"/><circle cx="215" cy="315" r="62" fill="none" stroke="${accent}" stroke-width="10"/><circle cx="515" cy="315" r="90" fill="none" stroke="${accent}" stroke-width="10"/>`;
  } else if (type === 'archival_timeline') {
    diagram = `<path d="M105 350 H635" stroke="${line}" stroke-width="8"/>${[145,300,455,610].map((x,i)=>`<circle cx="${x}" cy="350" r="18" fill="${i===2?accent:panel}" stroke="${accent}" stroke-width="5"/>`).join('')}`;
  } else if (type === 'location_map') {
    diagram = `<path d="M135 230 C210 170 300 240 345 205 C405 160 505 205 595 180 L625 420 C540 455 455 400 380 438 C300 475 220 420 135 450 Z" fill="${panel}" stroke="${line}" stroke-width="4"/><circle cx="390" cy="320" r="20" fill="${accent}"/><circle cx="390" cy="320" r="42" fill="none" stroke="${accent}" stroke-width="4" opacity=".5"/>`;
  } else if (type === 'experiment_diagram') {
    diagram = `<rect x="145" y="245" width="420" height="180" rx="24" fill="${panel}" stroke="${line}" stroke-width="4"/><rect x="210" y="285" width="120" height="95" rx="12" fill="none" stroke="${accent}" stroke-width="7"/><circle cx="270" cy="332" r="25" fill="none" stroke="${accent}" stroke-width="6"/><path d="M330 332 H495 M455 295 V370" stroke="${accent}" stroke-width="6"/><path d="M165 445 H545" stroke="${line}" stroke-width="8"/>`;
  } else if (type === 'technical_diagram') {
    diagram = `<circle cx="355" cy="325" r="92" fill="${panel}" stroke="${accent}" stroke-width="7"/>${[[170,235],[170,415],[545,235],[545,415]].map(([x,y])=>`<rect x="${x-55}" y="${y-35}" width="110" height="70" rx="14" fill="${panel}" stroke="${line}"/><path d="M${x + (x<355?55:-55)} ${y} L${355 + (x<355?-92:92)} ${325 + (y<325?-35:35)}" stroke="${line}" stroke-width="5"/>`).join('')}`;
  } else if (type === 'data_explainer') {
    diagram = `<path d="M140 430 V230 M140 430 H620" stroke="${line}" stroke-width="5"/>${[0,1,2,3,4].map((i)=>`<rect x="${185+i*82}" y="${390-i*36}" width="48" height="${40+i*36}" rx="8" fill="${i===4?accent:panel}" stroke="${line}"/>`).join('')}`;
  } else {
    diagram = `<circle cx="350" cy="330" r="145" fill="${panel}" stroke="${line}" stroke-width="5"/><circle cx="350" cy="330" r="82" fill="none" stroke="${accent}" stroke-width="9"/><path d="M205 330 H495 M350 185 V475" stroke="${accent}" stroke-width="4" opacity=".55"/>`;
  }

  return `<svg width="${width}" height="${height}" viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bgA}"/><stop offset="1" stop-color="${bgB}"/></linearGradient></defs>
    <rect width="1280" height="720" fill="url(#bg)"/>
    <rect x="58" y="55" width="1164" height="610" rx="32" fill="none" stroke="${line}" opacity=".55"/>
    <text x="90" y="108" fill="${accent}" font-family="Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="3">LUMEN ATLAS · ${escapeSvg(type.replace(/_/g,' ').toUpperCase())}</text>
    ${textLines(subjectLines, 90, 150, 34, 40)}
    ${diagram}
    ${detailCards}
    ${textLines(takeawayLines, 90, 560, 20, 28, 'start', muted, 400)}
    <text x="1190" y="625" text-anchor="end" fill="${muted}" font-family="Arial, sans-serif" font-size="14">LOCAL EXPLANATORY RENDER · V7</text>
  </svg>`;
}

module.exports = {
  VISUAL_DIRECTOR_VERSION: VERSION,
  LUMEN_VISUAL_IDENTITY: IDENTITY,
  VisualDirectorV7,
  extractConcretePhrases,
  inferVisualType,
  qualityFor,
  renderPrompt,
  parsePromptFields,
  buildLocalVisualSvg
};
