'use strict';

const crypto = require('crypto');

const VERSION = 9;
const WEIGHTS = Object.freeze({ retention: 0.25, thumbnail: 0.15, seo: 0.15, visual: 0.20, fact: 0.25 });
const SEVERITY_RANK = Object.freeze({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 });

function clean(value, limit = 12000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function deepText(value, depth = 0) {
  if (depth > 5 || value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return clean(value);
  if (Array.isArray(value)) return value.map(item => deepText(item, depth + 1)).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([key]) => !/^(?:url|path|id|hash|provider|model|status|score|duration)$/i.test(key))
      .map(([, item]) => deepText(item, depth + 1))
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

function tokenize(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3 && !new Set([
      'and','the','for','with','from','that','this','these','those','into','about','your','you','are','was','were',
      'have','has','had','but','not','can','will','would','could','should','our','their','they','them','there','here'
    ]).has(token));
}

function overlap(a, b) {
  const left = [...new Set(tokenize(a))];
  const right = new Set(tokenize(b));
  if (!left.length || !right.size) return 0;
  return left.filter(token => right.has(token)).length / left.length;
}

function wordCount(value) {
  return clean(value).split(/\s+/).filter(Boolean).length;
}

function sentences(value) {
  return clean(value, 50000)
    .split(/(?<=[.!?])\s+|\n+/)
    .map(item => clean(item, 500))
    .filter(item => wordCount(item) >= 5);
}

function repetitionRatio(value) {
  const list = sentences(value);
  if (list.length < 3) return 0;
  const fingerprints = list.map(item => tokenize(item).slice(0, 12).join(' ')).filter(Boolean);
  const unique = new Set(fingerprints);
  return fingerprints.length ? 1 - unique.size / fingerprints.length : 0;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function finding(id, severity, message, remediation, options = {}) {
  return {
    id,
    severity,
    blocking: Boolean(options.blocking),
    message,
    remediation: remediation || null,
    sceneId: options.sceneId || null,
    evidence: options.evidence || null
  };
}

function finalizeAgent(id, name, score, findings, metrics = {}, blockingFloor = 0) {
  score = clampScore(score);
  const blockingFindings = findings.filter(item => item.blocking);
  const blockedByFloor = blockingFloor > 0 && score < blockingFloor;
  if (blockedByFloor && !blockingFindings.some(item => item.id === `${id}_score_floor`)) {
    findings.push(finding(
      `${id}_score_floor`, 'HIGH', `${name} score is ${score}/100, below the ${blockingFloor}/100 publication floor.`,
      `Resolve the highest-severity ${name.toLowerCase()} findings and rerun quality review.`, { blocking: true }
    ));
  }
  return {
    id, name, version: VERSION, score,
    passed: !findings.some(item => item.blocking),
    blocking: findings.some(item => item.blocking),
    metrics,
    findings
  };
}

function classifyContent(production = {}) {
  const topic = clean(production.strategy?.topic || production.script?.title || production.seo?.title).toLowerCase();
  const text = `${topic} ${clean(production.strategy?.contentType)} ${clean(production.strategy?.requestedStyle)}`;
  if (/\b(today|breaking|latest|this week|this month|just announced|newly announced|current events?)\b/.test(text)) return 'news';
  if (/\b(trend|viral|trending|surge|boom|popular right now)\b/.test(text)) return 'trend';
  if (/\b(how to|tutorial|guide|step by step|steps)\b/.test(text)) return 'tutorial';
  if (/\b(vs\.?|versus|compare|comparison|difference between)\b/.test(text)) return 'comparison';
  if (/\b(history|historical|ancient|century|archive|war|dynasty|empire)\b/.test(text)) return 'historical';
  if (/\b(science|scientific|physics|biology|chemistry|astronomy|space|relativity|experiment|research|psychology|gravity|gravitational|quantum|particle|molecule|atomic|atom|clock|clocks|gps|satellite|satellites|geology|climate|neuroscience|genetics|evolution)\b|\btime dilation\b|\batomic clocks?\b/.test(text)) return 'scientific';
  return 'evergreen';
}

function retentionAgent(production = {}) {
  const script = production.script || {};
  const hook = deepText(script.hook);
  const introduction = deepText(script.introduction);
  const sections = Array.isArray(script.mainContent?.sections) ? script.mainContent.sections : [];
  const conclusion = deepText(script.conclusion);
  const cta = deepText(script.callToAction || script.cta);
  const full = clean(script.fullScript || [hook, introduction, ...sections.map(section => deepText(section)), conclusion, cta].join(' '), 50000);
  const topic = clean(production.strategy?.topic || script.title || production.seo?.title);
  const hookWords = wordCount(hook);
  const openLoops = (full.slice(0, Math.max(500, Math.floor(full.length * 0.35))).match(/\?|\bbut\b|\byet\b|\bhere'?s why\b|\bthe reason\b|\bwhat if\b|\bwhy does\b|\bhow can\b/gi) || []).length;
  const repetition = repetitionRatio(full);
  const payoffOverlap = overlap(`${topic} ${hook}`, conclusion);
  const longSections = sections.filter(section => Number(section.duration || 0) > 120 || wordCount(deepText(section.content || section)) > 280);
  const findings = [];
  let score = 100;

  if (!hook) {
    score -= 40;
    findings.push(finding('retention_missing_hook', 'CRITICAL', 'The script has no usable hook.', 'Create a concrete opening hook before the introduction.', { blocking: true }));
  } else if (hookWords > 65) {
    score -= 10;
    findings.push(finding('retention_long_hook', 'MEDIUM', `The hook is ${hookWords} words; the opening may take too long to reach the promise.`, 'Compress the hook to roughly 20–60 words while preserving the core promise.'));
  }
  if (openLoops === 0) {
    score -= 10;
    findings.push(finding('retention_no_open_loop', 'MEDIUM', 'The opening has no detectable question, contrast, or curiosity loop.', 'Add one concrete unanswered question or contrast that the video will resolve.'));
  }
  if (longSections.length) {
    score -= Math.min(20, longSections.length * 6);
    findings.push(finding('retention_pacing', 'MEDIUM', `${longSections.length} section${longSections.length === 1 ? '' : 's'} may be too long without a structural beat.`, 'Split long sections into tighter scenes or add a visual/pacing beat.'));
  }
  if (repetition > 0.22) {
    const severe = repetition > 0.42;
    score -= severe ? 28 : 14;
    findings.push(finding('retention_repetition', severe ? 'HIGH' : 'MEDIUM', `Repeated-sentence fingerprint rate is ${Math.round(repetition * 100)}%.`, 'Remove repeated explanations and let each section advance the story.', { blocking: severe }));
  }
  if (conclusion && payoffOverlap < 0.10) {
    score -= 15;
    findings.push(finding('retention_weak_payoff', 'HIGH', 'The conclusion has weak lexical connection to the opening promise/topic.', 'Make the conclusion explicitly resolve the central question or promise from the opening.'));
  }
  if (!cta) {
    score -= 5;
    findings.push(finding('retention_missing_cta', 'LOW', 'No explicit call-to-action was detected.', 'Add a brief, topic-relevant CTA after the payoff.'));
  }

  return finalizeAgent('retention', 'Retention Agent', score, findings, {
    hookWords, openLoops, repetitionRate: Number(repetition.toFixed(3)), payoffOverlap: Number(payoffOverlap.toFixed(3)), longSections: longSections.length,
    sectionCount: sections.length
  }, 55);
}

function thumbnailAgent(production = {}) {
  const thumbnail = production.thumbnail || {};
  const asset = production.assets?.thumbnail || {};
  const title = clean(production.seo?.title || production.script?.title);
  const concept = deepText(thumbnail.concept || thumbnail);
  const pathReady = Boolean(asset.path || thumbnail.path || thumbnail.imagePath);
  const conceptOverlap = overlap(title, concept);
  const overlay = clean(thumbnail.text || thumbnail.headline || thumbnail.titleText || thumbnail.concept?.text || '', 500);
  const genericTerms = (concept.toLowerCase().match(/\b(epic|amazing|mysterious|futuristic|glowing|cinematic|shocking|incredible|dramatic|viral)\b/g) || []).length;
  const findings = [];
  let score = 100;

  if (!pathReady) {
    score -= 65;
    findings.push(finding('thumbnail_missing_asset', 'CRITICAL', 'No thumbnail image asset is available.', 'Generate or upload a valid thumbnail before approval.', { blocking: true }));
  }
  if (!concept) {
    score -= 18;
    findings.push(finding('thumbnail_missing_concept', 'MEDIUM', 'Thumbnail concept metadata is missing.', 'Store a concrete subject, composition, and focal point for the thumbnail.'));
  }
  if (concept && title && conceptOverlap < 0.08) {
    score -= 15;
    findings.push(finding('thumbnail_title_disconnect', 'MEDIUM', 'Thumbnail concept is weakly connected to the final title.', 'Align the thumbnail subject with the title promise without duplicating the title verbatim.'));
  }
  if (wordCount(overlay) > 8 || overlay.length > 55) {
    score -= 12;
    findings.push(finding('thumbnail_text_heavy', 'MEDIUM', 'Thumbnail overlay text is likely too dense.', 'Use a short visual phrase or no overlay text; let the image carry the idea.'));
  }
  if (genericTerms >= 4) {
    score -= 15;
    findings.push(finding('thumbnail_generic_language', 'MEDIUM', 'Thumbnail concept relies heavily on generic attention words.', 'Replace mood words with a concrete subject, object, action, or comparison.'));
  }

  return finalizeAgent('thumbnail', 'Thumbnail Agent', score, findings, {
    assetReady: pathReady, conceptOverlap: Number(conceptOverlap.toFixed(3)), overlayWords: wordCount(overlay), genericTerms
  }, 45);
}

function seoAgent(production = {}) {
  const seo = production.seo || {};
  const title = clean(seo.title || production.script?.title, 200);
  const description = clean(seo.description, 6000);
  const tags = Array.isArray(seo.tags) ? seo.tags.map(tag => clean(tag, 100)).filter(Boolean) : [];
  const topic = clean(production.strategy?.topic || production.script?.title);
  const classification = classifyContent(production);
  const sourceText = `${topic} ${deepText(production.strategy)} ${deepText(production.script)}`.toLowerCase();
  const temporalMatches = title.match(/\b(?:20\d{2}|latest|today|this year|what'?s changed|new for 20\d{2})\b/gi) || [];
  const temporalMismatch = ['evergreen', 'scientific', 'historical', 'tutorial', 'comparison'].includes(classification) &&
    temporalMatches.some(marker => !sourceText.includes(marker.toLowerCase()));
  const titleTopicOverlap = overlap(topic, title);
  const clickbait = /you won'?t believe|shocking truth|mind[- ]?blowing|they don'?t want you to know|secret they hide/i.test(title);
  const findings = [];
  let score = 100;

  if (!title) {
    score -= 60;
    findings.push(finding('seo_missing_title', 'CRITICAL', 'SEO title is missing.', 'Create a truthful title before approval.', { blocking: true }));
  } else if (title.length < 30 || title.length > 80) {
    score -= 10;
    findings.push(finding('seo_title_length', 'LOW', `Title length is ${title.length} characters.`, 'Aim for a concise title that communicates the topic clearly, typically around 30–80 characters.'));
  }
  if (description.length < 120) {
    score -= 18;
    findings.push(finding('seo_short_description', description ? 'MEDIUM' : 'HIGH', `Description is ${description.length} characters.`, 'Write a useful description with the subject, value proposition, and relevant source/credit context.', { blocking: !description }));
  }
  if (tags.length < 5) {
    score -= 8;
    findings.push(finding('seo_tags', 'LOW', `${tags.length} tags are present.`, 'Add a small set of genuinely relevant tags rather than broad keyword stuffing.'));
  }
  if (topic && title && titleTopicOverlap < 0.10) {
    score -= 12;
    findings.push(finding('seo_topic_alignment', 'MEDIUM', 'Title has weak lexical alignment with the selected topic.', 'Make the core subject identifiable in the title.'));
  }
  if (temporalMismatch) {
    score -= 30;
    findings.push(finding('seo_false_freshness', 'HIGH', `The ${classification} title adds time-sensitive wording not supported by the underlying topic/script.`, 'Remove artificial year/latest framing unless the content genuinely discusses a time-specific change.', { blocking: true, evidence: temporalMatches }));
  }
  if (clickbait) {
    score -= 20;
    findings.push(finding('seo_clickbait', 'HIGH', 'The title contains unsupported clickbait phrasing.', 'Replace sensational phrasing with a specific, supportable promise.'));
  }

  return finalizeAgent('seo', 'SEO Agent', score, findings, {
    classification, titleLength: title.length, descriptionLength: description.length, tagCount: tags.length,
    titleTopicOverlap: Number(titleTopicOverlap.toFixed(3)), temporalMismatch, temporalMarkers: temporalMatches
  }, 45);
}

function visualAgent(production = {}) {
  const scenes = Array.isArray(production.scenes) ? production.scenes : [];
  const briefs = production.assets?.sceneManifest?.visualBriefs || {};
  const briefList = Object.values(briefs).filter(Boolean);
  const quality = briefList.map(brief => brief.quality || {});
  const avgSpecificity = quality.length ? quality.reduce((sum, item) => sum + Number(item.specificity || 0), 0) / quality.length : null;
  const avgGenericRisk = quality.length ? quality.reduce((sum, item) => sum + Number(item.genericAiRisk || 0), 0) / quality.length : null;
  const rejectedBriefs = quality.filter(item => item.accepted === false).length;
  const missingAssets = scenes.filter(scene => !scene.assetPath || ['missing_asset', 'failed', 'generating', 'visual_stale'].includes(scene.status));
  const unresolvedRights = scenes.filter(scene => ['uploaded', 'licensed-source', 'source'].includes(scene.assetOrigin) && !scene.rightsConfirmed);
  const sourceCount = scenes.filter(scene => scene.assetOrigin === 'licensed-source' || scene.sourceAsset).length;
  const localCount = scenes.filter(scene => scene.provider === 'local-renderer').length;
  const paths = scenes.map(scene => scene.assetPath).filter(Boolean);
  const duplicateAssets = paths.length - new Set(paths).size;
  const findings = [];
  let score = 100;

  if (!scenes.length) {
    score -= 60;
    findings.push(finding('visual_no_scenes', 'CRITICAL', 'No production scenes are available for visual review.', 'Build the scene manifest before approval.', { blocking: true }));
  }
  if (missingAssets.length) {
    score -= Math.min(60, 20 + missingAssets.length * 8);
    findings.push(finding('visual_missing_assets', 'CRITICAL', `${missingAssets.length} scene(s) have missing/stale/failed visuals.`, 'Repair the affected scene visuals and rebuild the video.', { blocking: true, evidence: missingAssets.map(scene => scene.id) }));
  }
  if (rejectedBriefs) {
    score -= Math.min(35, rejectedBriefs * 12);
    findings.push(finding('visual_rejected_briefs', 'HIGH', `${rejectedBriefs} Visual Director brief(s) are below the acceptance floor.`, 'Revise the affected scene prompts or use a more concrete real-source/diagram representation.', { blocking: true }));
  }
  if (avgSpecificity !== null && avgSpecificity < 70) {
    score -= 18;
    findings.push(finding('visual_specificity', 'HIGH', `Average Visual Director specificity is ${Math.round(avgSpecificity)}/100.`, 'Make visual subjects, objects, location, relationships, and viewer takeaway more concrete.'));
  }
  if (avgGenericRisk !== null && avgGenericRisk > 50) {
    const severe = avgGenericRisk >= 65;
    score -= severe ? 30 : 18;
    findings.push(finding('visual_generic_risk', severe ? 'HIGH' : 'MEDIUM', `Average Generic-AI risk is ${Math.round(avgGenericRisk)}/100.`, 'Replace generic imagery with relevant real sources, diagrams, or more specific prompts.', { blocking: severe }));
  }
  if (unresolvedRights.length) {
    score -= 45;
    findings.push(finding('visual_rights', 'CRITICAL', `${unresolvedRights.length} external/uploaded scene asset(s) do not have confirmed rights.`, 'Resolve media rights or replace the assets before approval.', { blocking: true, evidence: unresolvedRights.map(scene => scene.id) }));
  }
  if (duplicateAssets > 0) {
    score -= Math.min(18, duplicateAssets * 6);
    findings.push(finding('visual_duplicates', 'MEDIUM', `${duplicateAssets} duplicate scene asset path(s) were detected.`, 'Use distinct visuals when the narration changes subject or explanatory purpose.'));
  }
  if (localCount && localCount === scenes.length) {
    score -= 8;
    findings.push(finding('visual_all_local_renderer', 'LOW', 'Every scene currently uses the local explanatory renderer.', 'Where rights permit, mix in relevant real-source assets or provider imagery for visual variety.'));
  }

  return finalizeAgent('visual', 'Visual Quality Agent', score, findings, {
    sceneCount: scenes.length, missingAssets: missingAssets.length, rejectedBriefs,
    averageSpecificity: avgSpecificity === null ? null : Math.round(avgSpecificity),
    averageGenericAiRisk: avgGenericRisk === null ? null : Math.round(avgGenericRisk),
    sourceScenes: sourceCount, localRendererScenes: localCount, unresolvedRights: unresolvedRights.length, duplicateAssets
  }, 60);
}

function factAgent(production = {}) {
  const provenance = production.provenance || {};
  const evidenceReview = production.script?.evidenceReview || production.evidenceReview || null;
  const evidencePack = production.strategy?.evidencePack || production.researchEvidence || null;
  const claims = Array.isArray(production.script?.claims) ? production.script.claims : [];
  const unresolved = Number(provenance.summary?.unresolvedClaims || 0);
  const resolved = Number(provenance.summary?.resolvedClaims || 0);
  const verifiedSources = Number(provenance.summary?.verifiedSources || (evidencePack?.sources || []).filter(source => source.status === 'verified').length || 0);
  const unsupportedDeclared = claims.filter(claim => !Array.isArray(claim.sourceUrls) || !claim.sourceUrls.length || claim.verified === false);
  const findings = [];
  let score = 100;

  if (provenance.status && provenance.status !== 'verified') {
    score -= 35;
    findings.push(finding('fact_provenance', 'CRITICAL', `Provenance status is ${provenance.status}, not verified.`, 'Resolve or remove unsupported claims and rerun provenance verification.', { blocking: true }));
  }
  if (evidenceReview?.status === 'blocked') {
    score -= 40;
    findings.push(finding('fact_evidence_desk', 'CRITICAL', 'Evidence Desk reports unsupported or uncited claims.', 'Repair the blocked claims against retrieved evidence before approval.', { blocking: true }));
  }
  if (unresolved > 0) {
    score -= Math.min(50, 20 + unresolved * 10);
    findings.push(finding('fact_unresolved_claims', 'CRITICAL', `${unresolved} provenance claim(s) remain unresolved.`, 'Provide verified evidence or remove/reframe the claims.', { blocking: true }));
  }
  if (unsupportedDeclared.length) {
    score -= Math.min(45, 15 + unsupportedDeclared.length * 8);
    findings.push(finding('fact_declared_claims', 'HIGH', `${unsupportedDeclared.length} declared claim(s) lack an accepted evidence URL or verification marker.`, 'Repair each claim against the Evidence Pack or remove it from the script.', { blocking: true }));
  }
  if (verifiedSources === 0 && claims.length) {
    score -= 25;
    findings.push(finding('fact_no_verified_sources', 'HIGH', 'No verified evidence source is associated with the factual claims.', 'Research the topic again and attach retrievable evidence before approval.', { blocking: true }));
  }
  if (claims.length === 0) {
    score -= 10;
    findings.push(finding('fact_no_declared_claims', 'MEDIUM', 'The script has no declared factual claims to audit.', 'For factual videos, declare the externally verifiable claims and their source URLs.'));
  }

  return finalizeAgent('fact', 'Fact Quality Agent', score, findings, {
    provenanceStatus: provenance.status || null, resolvedClaims: resolved, unresolvedClaims: unresolved,
    declaredClaims: claims.length, unsupportedDeclaredClaims: unsupportedDeclared.length, verifiedEvidenceSources: verifiedSources,
    evidenceDeskStatus: evidenceReview?.status || null
  }, 60);
}

function buildRepairPlan(agents) {
  return agents
    .flatMap(agent => agent.findings.map(item => ({
      agentId: agent.id, agentName: agent.name, findingId: item.id, severity: item.severity,
      blocking: item.blocking, message: item.message, remediation: item.remediation, sceneId: item.sceneId || null
    })))
    .sort((a, b) => Number(b.blocking) - Number(a.blocking) || (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0))
    .slice(0, 30);
}

class QualityAgentsV9 {
  constructor(db = null, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
  }

  fingerprint(production = {}) {
    const canonical = JSON.stringify({
      title: production.seo?.title || production.script?.title || '',
      topic: production.strategy?.topic || '',
      script: production.script || {}, seo: production.seo || {}, thumbnail: production.thumbnail || {},
      scenes: (production.scenes || []).map(scene => ({ id: scene.id, revision: scene.revision, status: scene.status, assetPath: scene.assetPath, rightsConfirmed: scene.rightsConfirmed })),
      provenance: production.provenance || {}, visualManifest: production.assets?.sceneManifest || {}
    });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  async review(production = {}) {
    const agents = [
      retentionAgent(production), thumbnailAgent(production), seoAgent(production), visualAgent(production), factAgent(production)
    ];
    const overallScore = clampScore(agents.reduce((sum, agent) => sum + agent.score * (WEIGHTS[agent.id] || 0), 0));
    const repairPlan = buildRepairPlan(agents);
    const blockingFindings = repairPlan.filter(item => item.blocking);
    const status = blockingFindings.length ? 'blocked' : (overallScore < 80 || repairPlan.some(item => ['HIGH', 'MEDIUM'].includes(item.severity)) ? 'warning' : 'passed');
    const report = {
      version: VERSION,
      productionId: production.id || null,
      fingerprint: this.fingerprint(production),
      status,
      passed: blockingFindings.length === 0,
      overallScore,
      weights: { ...WEIGHTS },
      agents,
      blockingFindings,
      repairPlan,
      createdAt: new Date().toISOString()
    };
    if (this.db?.saveQualityAgentReport && production.id) await this.db.saveQualityAgentReport(report);
    this.logger.info(`Quality Agents v9: ${status}, score=${overallScore}, blockers=${blockingFindings.length}.`);
    return report;
  }
}

module.exports = {
  QUALITY_AGENTS_VERSION: VERSION,
  QUALITY_AGENT_WEIGHTS: WEIGHTS,
  QualityAgentsV9,
  classifyContent,
  retentionAgent,
  thumbnailAgent,
  seoAgent,
  visualAgent,
  factAgent,
  buildRepairPlan,
  overlap,
  repetitionRatio
};