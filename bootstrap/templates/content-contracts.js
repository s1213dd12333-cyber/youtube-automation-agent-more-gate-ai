'use strict';

const CONTRACT_VERSION = '1.0.0';
const CONTENT_TYPES = new Map([
  ['tutorial', 'Tutorial'],
  ['explainer', 'Explainer'],
  ['list', 'List'],
  ['review', 'Review'],
  ['story', 'Story'],
  ['news', 'News']
]);
const LENGTHS = new Set(['short', 'medium', 'long']);
const LENGTH_LABELS = {
  short: '2-4 minutes',
  medium: '8-12 minutes',
  long: '15-20 minutes'
};

const CONTRACT_SCHEMAS = Object.freeze({
  strategy: Object.freeze({
    $id: 'lumen.strategy.v1',
    type: 'object',
    required: ['topic', 'contentType', 'keywords', 'researchSources'],
    properties: {
      topic: { type: 'string', minLength: 1, maxLength: 200 },
      contentType: { enum: [...CONTENT_TYPES.values()] },
      keywords: { type: 'array', items: { type: 'string' } },
      researchSources: { type: 'array', items: { type: 'object' } },
      requestedLengthKey: { enum: [...LENGTHS] }
    }
  }),
  script: Object.freeze({
    $id: 'lumen.script.v1',
    type: 'object',
    required: ['title', 'hook', 'introduction', 'mainContent', 'conclusion', 'callToAction', 'claims'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      hook: { type: 'object', required: ['text'] },
      introduction: { type: 'object' },
      mainContent: { type: 'object', required: ['sections'] },
      conclusion: { type: 'object', required: ['recap', 'keyPoints'] },
      callToAction: { type: 'object' },
      claims: { type: 'array' }
    }
  })
});

class ContentContractError extends Error {
  constructor(contract, issues = []) {
    const rendered = issues.length ? issues.join('; ') : 'unknown contract violation';
    super(`${contract} contract validation failed: ${rendered}`);
    this.name = 'ContentContractError';
    this.code = 'CONTENT_CONTRACT_INVALID';
    this.status = 422;
    this.contract = contract;
    this.issues = issues;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value, fallback = '', max = null) {
  let result = value === undefined || value === null ? fallback : String(value);
  result = result.trim();
  return max ? result.slice(0, max) : result;
}

function finiteNumber(value, fallback = 0, min = null, max = null) {
  const parsed = Number(value);
  let result = Number.isFinite(parsed) ? parsed : fallback;
  if (min !== null) result = Math.max(min, result);
  if (max !== null) result = Math.min(max, result);
  return result;
}

function uniqueStrings(value, maxItems = 50, maxLength = 500) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const seen = new Set();
  const output = [];
  for (const item of raw) {
    const normalized = text(item, '', maxLength);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= maxItems) break;
  }
  return output;
}

function normalizeContentType(value) {
  const key = text(value || 'explainer').toLowerCase();
  return CONTENT_TYPES.get(key) || 'Explainer';
}

function normalizeLength(value) {
  const key = text(value || 'medium').toLowerCase();
  return LENGTHS.has(key) ? key : 'medium';
}

function normalizeSource(source) {
  if (!isObject(source)) return null;
  const url = text(source.url, '', 2048);
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    ...source,
    url,
    title: text(source.title || url, url, 500),
    publisher: text(source.publisher, '', 250),
    sourceType: text(source.sourceType || source.type || 'web', 'web', 50),
    status: text(source.status || 'discovered', 'discovered', 50),
    publishedAt: source.publishedAt ? text(source.publishedAt, '', 100) : null,
    accessedAt: source.accessedAt ? text(source.accessedAt, '', 100) : null,
    notes: text(source.notes, '', 1000)
  };
}

function normalizeStrategy(input = {}) {
  const source = isObject(input) ? input : {};
  const requestedLengthKey = normalizeLength(source.requestedLengthKey || source.length);
  const researchSources = [];
  const seenSources = new Set();
  for (const candidate of Array.isArray(source.researchSources) ? source.researchSources : []) {
    const normalized = normalizeSource(candidate);
    if (!normalized || seenSources.has(normalized.url)) continue;
    seenSources.add(normalized.url);
    researchSources.push(normalized);
    if (researchSources.length >= 50) break;
  }

  return {
    ...source,
    contractVersion: CONTRACT_VERSION,
    topic: text(source.topic, '', 200),
    angle: text(source.angle, '', 500),
    targetAudience: text(source.targetAudience, '', 500),
    contentType: normalizeContentType(source.contentType),
    keywords: uniqueStrings(source.keywords, 50, 100),
    estimatedViews: finiteNumber(source.estimatedViews, 0, 0),
    bestPublishTime: source.bestPublishTime ? text(source.bestPublishTime, '', 100) : null,
    competitorAnalysis: Array.isArray(source.competitorAnalysis) ? source.competitorAnalysis : [],
    researchSources,
    requestedStyle: source.requestedStyle ? text(source.requestedStyle, '', 50) : null,
    requestedLengthKey,
    requestedLength: text(source.requestedLength, LENGTH_LABELS[requestedLengthKey], 100) || LENGTH_LABELS[requestedLengthKey],
    planRationale: source.planRationale ? text(source.planRationale, '', 1000) : null,
    brandVoice: source.brandVoice ? text(source.brandVoice, '', 1000) : null,
    channelGoal: source.channelGoal ? text(source.channelGoal, '', 1000) : null,
    channelValueProposition: source.channelValueProposition ? text(source.channelValueProposition, '', 1000) : null,
    channelConstraints: source.channelConstraints ? text(source.channelConstraints, '', 2000) : null,
    contentPillar: source.contentPillar ? text(source.contentPillar, '', 100) : null,
    callToAction: source.callToAction ? text(source.callToAction, '', 1000) : null
  };
}

function normalizeHook(value) {
  if (typeof value === 'string') {
    return { type: 'hook', text: text(value, '', 3000), duration: '0:00-0:05' };
  }
  const source = isObject(value) ? value : {};
  return {
    ...source,
    type: text(source.type || 'hook', 'hook', 50),
    text: text(source.text || source.content || source.hook, '', 3000),
    duration: text(source.duration || '0:00-0:05', '0:00-0:05', 50)
  };
}

function normalizeIntroduction(value) {
  if (typeof value === 'string') {
    return {
      type: 'introduction',
      greeting: '',
      topicIntro: text(value, '', 5000),
      valueProposition: '',
      credibility: '',
      duration: '15 seconds'
    };
  }
  const source = isObject(value) ? value : {};
  return {
    ...source,
    type: text(source.type || 'introduction', 'introduction', 50),
    greeting: text(source.greeting, '', 2000),
    topicIntro: text(source.topicIntro || source.topic || source.content, '', 5000),
    valueProposition: text(source.valueProposition, '', 3000),
    credibility: text(source.credibility, '', 3000),
    duration: text(source.duration || '15 seconds', '15 seconds', 50)
  };
}

function normalizeSteps(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((item, index) => {
    const source = isObject(item) ? item : { description: item };
    return {
      ...source,
      number: Number.isFinite(Number(source.number)) ? Number(source.number) : index + 1,
      title: text(source.title || `Step ${index + 1}`, `Step ${index + 1}`, 500),
      description: text(source.description || source.content, '', 5000),
      tip: text(source.tip, '', 2000)
    };
  });
}

function normalizeItems(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((item, index) => {
    const source = isObject(item) ? item : { description: item };
    return {
      ...source,
      number: Number.isFinite(Number(source.number)) ? Number(source.number) : index + 1,
      title: text(source.title || `Item ${index + 1}`, `Item ${index + 1}`, 500),
      description: text(source.description || source.content, '', 5000),
      impact: text(source.impact, '', 2000)
    };
  });
}

function normalizeSection(value, index) {
  const source = isObject(value) ? value : { content: value };
  const steps = normalizeSteps(source.steps);
  const items = normalizeItems(source.items);
  const points = uniqueStrings(source.points, 100, 5000);
  let content = Array.isArray(source.content)
    ? uniqueStrings(source.content, 100, 5000)
    : text(source.content || source.summary || source.description, '', 5000)
      ? [text(source.content || source.summary || source.description, '', 5000)]
      : [];

  if (!content.length && steps.length) {
    content = steps.map(step => [step.title, step.description, step.tip].filter(Boolean).join('. '));
  }
  if (!content.length && items.length) {
    content = items.map(item => [item.title, item.description, item.impact].filter(Boolean).join('. '));
  }
  if (!content.length && points.length) content = [...points];

  return {
    ...source,
    type: text(source.type || 'section', 'section', 100),
    title: text(source.title || `Section ${index + 1}`, `Section ${index + 1}`, 500),
    content,
    steps,
    items,
    points,
    visuals: uniqueStrings(source.visuals, 50, 500),
    duration: Math.round(finiteNumber(source.duration, 60, 1, 3600))
  };
}

function normalizeConclusion(value) {
  const source = typeof value === 'string'
    ? { summary: value }
    : isObject(value)
      ? value
      : {};
  const summary = text(source.summary || source.content, '', 5000);
  const finalThought = text(source.finalThought || source.final_thought || source.closingThought, '', 5000);
  let recap = uniqueStrings(source.recap, 50, 5000);
  let keyPoints = uniqueStrings(source.keyPoints || source.key_points, 50, 5000);

  if (!recap.length && keyPoints.length) recap = [...keyPoints];
  if (!keyPoints.length && recap.length) keyPoints = [...recap];
  if (!recap.length && summary) recap = [summary];
  if (!keyPoints.length && summary) keyPoints = [summary];
  if (!recap.length && finalThought) recap = [finalThought];
  if (!keyPoints.length && finalThought) keyPoints = [finalThought];

  return {
    ...source,
    type: text(source.type || 'conclusion', 'conclusion', 50),
    title: text(source.title || 'Conclusion', 'Conclusion', 500),
    summary,
    recap,
    keyPoints,
    finalThought,
    duration: text(source.duration || '30 seconds', '30 seconds', 50)
  };
}

function normalizeCallToAction(value) {
  if (typeof value === 'string') {
    return {
      type: 'call_to_action',
      subscribe: text(value, '', 3000),
      like: '',
      comment: '',
      nextVideo: '',
      duration: '15 seconds'
    };
  }
  const source = isObject(value) ? value : {};
  return {
    ...source,
    type: text(source.type || 'call_to_action', 'call_to_action', 50),
    subscribe: text(source.subscribe || source.text, '', 3000),
    like: text(source.like, '', 3000),
    comment: text(source.comment, '', 3000),
    nextVideo: text(source.nextVideo, '', 3000),
    duration: text(source.duration || '15 seconds', '15 seconds', 50)
  };
}

function normalizeClaims(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map(item => {
    const source = isObject(item) ? item : { text: item };
    return {
      ...source,
      text: text(source.text || source.claim, '', 2000),
      riskLevel: text(source.riskLevel).toLowerCase() === 'high' ? 'high' : 'standard',
      sourceUrls: uniqueStrings(source.sourceUrls, 20, 2048).filter(url => /^https?:\/\//i.test(url))
    };
  }).filter(item => item.text);
}

function formatDuration(seconds) {
  const whole = Math.max(0, Math.round(finiteNumber(seconds, 0, 0)));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

function normalizeScript(input = {}, strategy = null) {
  const source = isObject(input) ? input : {};
  const rawSections = Array.isArray(source.mainContent?.sections)
    ? source.mainContent.sections
    : Array.isArray(source.sections)
      ? source.sections
      : [];
  const sections = rawSections.map(normalizeSection);
  const totalDuration = sections.reduce((sum, section) => sum + section.duration, 0);
  const duration = text(source.duration, '', 50) || formatDuration(totalDuration + 65);
  const metadata = isObject(source.metadata) ? { ...source.metadata } : {};
  if (strategy && !metadata.strategy) metadata.strategy = normalizeStrategy(strategy);

  return {
    ...source,
    contractVersion: CONTRACT_VERSION,
    title: text(source.title, '', 200),
    hook: normalizeHook(source.hook),
    introduction: normalizeIntroduction(source.introduction),
    mainContent: {
      ...(isObject(source.mainContent) ? source.mainContent : {}),
      sections,
      totalDuration
    },
    conclusion: normalizeConclusion(source.conclusion),
    callToAction: normalizeCallToAction(source.callToAction || source.cta),
    duration,
    tone: text(source.tone, '', 100),
    pacing: text(source.pacing, '', 100),
    keywords: uniqueStrings(source.keywords || strategy?.keywords, 50, 100),
    claims: normalizeClaims(source.claims),
    metadata,
    fullScript: typeof source.fullScript === 'string' ? source.fullScript : ''
  };
}

function validateStrategy(strategy) {
  const issues = [];
  if (!isObject(strategy)) return { valid: false, issues: ['strategy must be an object'] };
  if (!text(strategy.topic)) issues.push('topic is required');
  if (text(strategy.topic).length > 200) issues.push('topic exceeds 200 characters');
  if (![...CONTENT_TYPES.values()].includes(strategy.contentType)) issues.push('contentType is invalid');
  if (!Array.isArray(strategy.keywords)) issues.push('keywords must be an array');
  if (!Array.isArray(strategy.researchSources)) issues.push('researchSources must be an array');
  if (!LENGTHS.has(strategy.requestedLengthKey)) issues.push('requestedLengthKey is invalid');
  return { valid: issues.length === 0, issues };
}

function validateScript(script) {
  const issues = [];
  if (!isObject(script)) return { valid: false, issues: ['script must be an object'] };
  if (!text(script.title)) issues.push('title is required');
  if (!isObject(script.hook) || !text(script.hook.text)) issues.push('hook.text is required');
  if (!isObject(script.introduction)) issues.push('introduction must be an object');
  const sections = script.mainContent?.sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    issues.push('mainContent.sections must contain at least one section');
  } else {
    sections.forEach((section, index) => {
      if (!isObject(section)) {
        issues.push(`section ${index + 1} must be an object`);
        return;
      }
      if (!text(section.title)) issues.push(`section ${index + 1} title is required`);
      if (!Array.isArray(section.content)) issues.push(`section ${index + 1} content must be an array`);
      if (Array.isArray(section.content) && section.content.length === 0) {
        issues.push(`section ${index + 1} requires spoken content`);
      }
      if (!Number.isFinite(Number(section.duration)) || Number(section.duration) <= 0) {
        issues.push(`section ${index + 1} duration must be positive`);
      }
    });
  }
  if (!isObject(script.conclusion)) {
    issues.push('conclusion must be an object');
  } else {
    if (!Array.isArray(script.conclusion.recap)) issues.push('conclusion.recap must be an array');
    if (!Array.isArray(script.conclusion.keyPoints)) issues.push('conclusion.keyPoints must be an array');
    const hasConclusion = Boolean(
      script.conclusion.recap?.length ||
      script.conclusion.keyPoints?.length ||
      text(script.conclusion.summary) ||
      text(script.conclusion.finalThought)
    );
    if (!hasConclusion) issues.push('conclusion requires recap, keyPoints, summary, or finalThought');
  }
  if (!isObject(script.callToAction)) issues.push('callToAction must be an object');
  if (!Array.isArray(script.keywords)) issues.push('keywords must be an array');
  if (!Array.isArray(script.claims)) issues.push('claims must be an array');
  return { valid: issues.length === 0, issues };
}

function assertValidStrategy(strategy) {
  const result = validateStrategy(strategy);
  if (!result.valid) throw new ContentContractError('strategy', result.issues);
  return strategy;
}

function assertValidScript(script) {
  const result = validateScript(script);
  if (!result.valid) throw new ContentContractError('script', result.issues);
  return script;
}

function normalizeGenerationArtifact(stage, artifact) {
  if (stage === 'strategy') return assertValidStrategy(normalizeStrategy(artifact));
  if (stage === 'script') {
    const strategy = artifact?.metadata?.strategy || null;
    return assertValidScript(normalizeScript(artifact, strategy));
  }
  return artifact;
}

function validateGenerationArtifact(stage, artifact) {
  if (stage === 'strategy') return validateStrategy(artifact);
  if (stage === 'script') return validateScript(artifact);
  return { valid: true, issues: [] };
}

module.exports = {
  CONTRACT_VERSION,
  CONTRACT_SCHEMAS,
  ContentContractError,
  normalizeStrategy,
  normalizeScript,
  validateStrategy,
  validateScript,
  assertValidStrategy,
  assertValidScript,
  normalizeGenerationArtifact,
  validateGenerationArtifact
};
