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
  if (index === -1) throw new Error('News provenance/publication anchor not found: ' + label);
  return text.slice(0, index) + to + text.slice(index + from.length);
}
function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error('News provenance/publication anchor not found: ' + label);
  return text.slice(0, index) + block + text.slice(index);
}

// Preserve Global Newsroom provenance metadata all the way into the persisted production strategy.
let source = read('index.js');
source = replaceOnce(
  source,
  "      generated.contentPillar = strategyContext.pillar || null;\n      generated.callToAction = profile.call_to_action || null;",
  [
    "      generated.contentPillar = strategyContext.pillar || null;",
    "      generated.newsroomAssignmentId = strategyContext.newsroomAssignmentId || null;",
    "      generated.newsroomAction = strategyContext.newsroomAction || null;",
    "      generated.newsroomClusterId = strategyContext.newsroomClusterId || null;",
    "      generated.requiresNewsCorroboration = Boolean(strategyContext.requiresNewsCorroboration);",
    "      generated.newsroomCandidateDomains = Array.isArray(strategyContext.newsroomCandidateDomains) ? strategyContext.newsroomCandidateDomains : [];",
    "      generated.callToAction = profile.call_to_action || null;"
  ].join('\n'),
  'strategy preserves newsroom metadata'
);

// Make the human-approval hold explicit instead of looking like a publishing failure.
source = replaceOnce(
  source,
  "      let scheduleEntry = null;\n      if (reviewStatus === 'approved') {",
  [
    "      let scheduleEntry = null;",
    "      if (quality.passed && approvalRequired) {",
    "        this.logger.warn(`Content ${contentId} passed quality but is waiting for human approval because approval_required=true. Disable Require approval before scheduling in Channel setup for fully autonomous publishing.`);",
    "      }",
    "      if (reviewStatus === 'approved') {"
  ].join('\n'),
  'explicit approval hold log'
);
write('index.js', source);

// Fail before expensive media production when a Global Newsroom script declares no auditable claims.
source = read('agents/script-writer-agent.js');
source = replaceOnce(
  source,
  "  async verifyEvidenceBeforePersistence(script, strategy) {\n    const review = await this.evidenceDesk.verifyScript({",
  [
    "  async verifyEvidenceBeforePersistence(script, strategy) {",
    "    const newsroomEvidenceRequired = Boolean(",
    "      strategy?.newsroomAssignmentId || strategy?.newsroomClusterId || strategy?.requiresNewsCorroboration ||",
    "      /^(BREAKING|UPDATE|COVER|FOLLOW_UP|RESEARCH_CANDIDATE)$/i.test(String(strategy?.newsroomAction || ''))",
    "    );",
    "    if (newsroomEvidenceRequired && (!Array.isArray(script?.claims) || script.claims.length === 0)) {",
    "      const error = new Error('Global Newsroom scripts must declare auditable factual claims with evidence URLs before production.');",
    "      error.code = 'EVIDENCE_NEWS_CLAIMS_REQUIRED';",
    "      error.status = 422;",
    "      throw error;",
    "    }",
    "    const review = await this.evidenceDesk.verifyScript({"
  ].join('\n'),
  'news scripts require auditable claims'
);
write('agents/script-writer-agent.js', source);

// Align Phase 9 with the Evidence Desk: not_required is valid only for genuinely claim-free non-news content.
source = read('utils/quality-agents-v9.js');
source = replaceOnce(
  source,
  "  const unsupportedDeclared = claims.filter(claim => !Array.isArray(claim.sourceUrls) || !claim.sourceUrls.length || claim.verified === false);\n  const findings = [];",
  [
    "  const unsupportedDeclared = claims.filter(claim => !Array.isArray(claim.sourceUrls) || !claim.sourceUrls.length || claim.verified === false);",
    "  const newsroomEvidenceRequired = Boolean(",
    "    production.strategy?.newsroomAssignmentId || production.strategy?.newsroomClusterId || production.strategy?.requiresNewsCorroboration ||",
    "    /^(BREAKING|UPDATE|COVER|FOLLOW_UP|RESEARCH_CANDIDATE)$/i.test(String(production.strategy?.newsroomAction || ''))",
    "  );",
    "  const findings = [];"
  ].join('\n'),
  'fact agent newsroom classification'
);
source = replaceOnce(
  source,
  "  if (provenance.status && provenance.status !== 'verified') {\n    score -= 35;\n    findings.push(finding('fact_provenance', 'CRITICAL', `Provenance status is ${provenance.status}, not verified.`, 'Resolve or remove unsupported claims and rerun provenance verification.', { blocking: true }));\n  }",
  [
    "  const claimFreeNotRequired = provenance.status === 'not_required' && claims.length === 0 && !newsroomEvidenceRequired;",
    "  if (provenance.status && provenance.status !== 'verified' && !claimFreeNotRequired) {",
    "    score -= 35;",
    "    findings.push(finding('fact_provenance', 'CRITICAL', `Provenance status is ${provenance.status}, not verified for this factual production.`, 'Resolve or remove unsupported claims and rerun provenance verification.', { blocking: true }));",
    "  }",
    "  if (newsroomEvidenceRequired && claims.length === 0) {",
    "    score -= 45;",
    "    findings.push(finding('fact_news_claims_required', 'CRITICAL', 'Global Newsroom content has no declared factual claims to audit.', 'Regenerate the script with explicit claims linked to retrieved evidence URLs before production.', { blocking: true }));",
    "  }"
  ].join('\n'),
  'contextual provenance status'
);
source = replaceOnce(
  source,
  "  if (claims.length === 0) {\n    score -= 10;\n    findings.push(finding('fact_no_declared_claims', 'MEDIUM', 'The script has no declared factual claims to audit.', 'For factual videos, declare the externally verifiable claims and their source URLs.'));\n  }",
  [
    "  if (claims.length === 0 && !newsroomEvidenceRequired) {",
    "    score -= 10;",
    "    findings.push(finding('fact_no_declared_claims', 'MEDIUM', 'The script has no declared factual claims to audit.', 'For factual videos, declare the externally verifiable claims and their source URLs.'));",
    "  }"
  ].join('\n'),
  'avoid duplicate no-claims finding for newsroom'
);
source = replaceOnce(
  source,
  "    evidenceDeskStatus: evidenceReview?.status || null\n  }, 60);",
  "    evidenceDeskStatus: evidenceReview?.status || null, newsroomEvidenceRequired\n  }, 60);",
  'fact metrics expose newsroom requirement'
);
write('utils/quality-agents-v9.js', source);

const pkg = JSON.parse(read('package.json'));
pkg.scripts = pkg.scripts || {};
pkg.scripts['test:news-provenance-publication'] = 'node ../bootstrap/verify-news-provenance-publication-gate.js';
write('package.json', JSON.stringify(pkg, null, 2) + '\n');

console.log('News provenance/publication gate fixed: newsroom metadata persists, news claims are mandatory before production, not_required is contextual, and human-approval holds are explicit.');
