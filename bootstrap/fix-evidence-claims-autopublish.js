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
  if (index === -1) throw new Error('Evidence claims autopublish anchor not found: ' + label);
  return text.slice(0, index) + to + text.slice(index + from.length);
}
function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error('Evidence claims autopublish anchor not found: ' + label);
  return text.slice(0, index) + block + text.slice(index);
}

let source = read('agents/script-writer-agent.js');
const claimRepairMethod = [
  "  async ensureAuditableFactualClaims(script, strategy) {",
  "    if (isExplicitFictionalNarrative(strategy)) return script;",
  "    if (Array.isArray(script?.claims) && script.claims.length) return script;",
  "    const allSources = strategy?.evidencePack?.sources || strategy?.researchSources || [];",
  "    const evidenceSources = (Array.isArray(allSources) ? allSources : []).filter(source => source?.url && source?.status === 'verified' && String(source?.evidenceText || '').trim()).slice(0, 8);",
  "    const evidenceReady = strategy?.evidencePack?.status === 'ready' || evidenceSources.length >= 2;",
  "    if (!evidenceReady || !evidenceSources.length) return script;",
  "    const scriptText = String(script?.fullScript || this.formatFullScript(script) || '').slice(0, 16000);",
  "    const sourcePacket = evidenceSources.map(source => ({ url: source.url, title: source.title || '', publisher: source.publisher || '', sourceClass: source.sourceClass || source.sourceType || 'web', evidenceText: String(source.evidenceText || '').slice(0, 1200) }));",
  "    const prompt = [",
  "      'You are repairing ONLY the factual-claim metadata for an already-written YouTube script.',",
  "      'Do not rewrite the script. Return only valid JSON with this shape:',",
  "      '{\"claims\":[{\"text\":\"exact factual assertion already present in the script\",\"riskLevel\":\"standard|high\",\"sourceUrls\":[\"exact URL from evidence packet\"]}]}',",
  "      '',",
  "      'Rules:',",
  "      '- Extract only externally verifiable factual assertions that are actually present in the script.',",
  "      '- Every claim must be directly supported by retrieved evidenceText.',",
  "      '- Use only exact URLs from the evidence packet.',",
  "      '- Never invent a claim, URL, quote, statistic, event, date, person, organization, or source.',",
  "      '- If a statement is uncertain or attributed in the script, preserve that uncertainty/attribution in the claim text.',",
  "      '- Prefer 3-12 important claims; include fewer only when the script genuinely contains fewer supported factual assertions.',",
  "      '',",
  "      'Evidence packet:',",
  "      JSON.stringify(sourcePacket),",
  "      '',",
  "      'Existing script:',",
  "      scriptText",
  "    ].join('\\n');",
  "    const response = await this.aiTextService.generateText(prompt, { maxTokens: 2600, temperature: 0.1, operation: 'evidence_claim_metadata_repair' });",
  "    const parsed = this.parseAIJsonResponse(response);",
  "    const repaired = this.normalizeAIClaims(parsed?.claims, evidenceSources);",
  "    if (!repaired.length) {",
  "      const error = new Error('Evidence-backed factual script contains no auditable claims after metadata repair.');",
  "      error.code = 'EVIDENCE_CLAIMS_REQUIRED'; error.status = 422; throw error;",
  "    }",
  "    script.claims = repaired;",
  "    this.logger.info('Evidence claim metadata repaired: ' + repaired.length + ' claim(s) extracted from the existing script without changing narration.');",
  "    return script;",
  "  }",
  "",
  ""
].join('\n');
source = insertBefore(source, "  async verifyEvidenceBeforePersistence(script, strategy) {\n", claimRepairMethod, 'claim metadata repair method');

const oldNormalReview = [
  "    const review = await this.evidenceDesk.verifyScript({",
  "      jobId: strategy?.evidencePack?.jobId || null,",
  "      script,",
  "      evidencePack: strategy?.evidencePack || { sources: strategy?.researchSources || [] }",
  "    });",
  "    script.evidenceReview = review;",
  "    this.evidenceDesk.assertReview(review);",
  "    return script;"
].join('\n');
const newNormalReview = [
  "    await this.ensureAuditableFactualClaims(script, strategy);",
  "    const review = await this.evidenceDesk.verifyScript({",
  "      jobId: strategy?.evidencePack?.jobId || null,",
  "      script,",
  "      evidencePack: strategy?.evidencePack || { sources: strategy?.researchSources || [] }",
  "    });",
  "    script.evidenceReview = review;",
  "    this.evidenceDesk.assertReview(review);",
  "    return script;"
].join('\n');
source = replaceOnce(source, oldNormalReview, newNormalReview, 'run claim metadata repair before Evidence Desk');
write('agents/script-writer-agent.js', source);

source = read('utils/quality-agents-v9.js');
const oldFactSetup = [
  "  const unresolved = Number(provenance.summary?.unresolvedClaims || 0);",
  "  const resolved = Number(provenance.summary?.resolvedClaims || 0);",
  "  const verifiedSources = Number(provenance.summary?.verifiedSources || (evidencePack?.sources || []).filter(source => source.status === 'verified').length || 0);",
  "  const unsupportedDeclared = claims.filter(claim => !Array.isArray(claim.sourceUrls) || !claim.sourceUrls.length || claim.verified === false);",
  "  const findings = [];",
  "  let score = 100;",
  "",
  "  if (provenance.status && provenance.status !== 'verified') {",
  "    score -= 35;",
  "    findings.push(finding('fact_provenance', 'CRITICAL', `Provenance status is ${provenance.status}, not verified.`, 'Resolve or remove unsupported claims and rerun provenance verification.', { blocking: true }));",
  "  }"
].join('\n');
const newFactSetup = [
  "  const unresolved = Number(provenance.summary?.unresolvedClaims || 0);",
  "  const resolved = Number(provenance.summary?.resolvedClaims || 0);",
  "  const verifiedSources = Number(provenance.summary?.verifiedSources || (evidencePack?.sources || []).filter(source => source.status === 'verified').length || 0);",
  "  const unsupportedDeclared = claims.filter(claim => !Array.isArray(claim.sourceUrls) || !claim.sourceUrls.length || claim.verified === false);",
  "  const findings = [];",
  "  let score = 100;",
  "  const evidenceBacked = evidencePack?.status === 'ready' || verifiedSources > 0 || evidenceReview?.status === 'verified';",
  "  const invalidProvenance = Boolean(provenance.status && !['verified', 'not_required'].includes(provenance.status));",
  "  const notRequiredMismatch = provenance.status === 'not_required' && claims.length > 0;",
  "",
  "  if (invalidProvenance || notRequiredMismatch) {",
  "    score -= 35;",
  "    findings.push(finding('fact_provenance', 'CRITICAL', `Provenance status is ${provenance.status || 'missing'} and does not match the declared factual claims.`, 'Resolve or remove unsupported claims and rerun provenance verification.', { blocking: true }));",
  "  }",
  "  if (provenance.status === 'not_required' && claims.length === 0 && evidenceBacked) {",
  "    score -= 35;",
  "    findings.push(finding('fact_claims_required', 'CRITICAL', 'This evidence-backed factual production reached quality review with no auditable claims.', 'Extract factual claims from the existing script, bind them to verified evidence URLs, and rerun Evidence Desk/provenance before publication.', { blocking: true }));",
  "  }"
].join('\n');
source = replaceOnce(source, oldFactSetup, newFactSetup, 'not_required provenance semantics');

const oldNoClaims = [
  "  if (claims.length === 0) {",
  "    score -= 10;",
  "    findings.push(finding('fact_no_declared_claims', 'MEDIUM', 'The script has no declared factual claims to audit.', 'For factual videos, declare the externally verifiable claims and their source URLs.'));",
  "  }"
].join('\n');
const newNoClaims = [
  "  if (claims.length === 0 && !evidenceBacked) {",
  "    score -= 10;",
  "    findings.push(finding('fact_no_declared_claims', 'MEDIUM', 'The script has no declared factual claims to audit.', 'For factual videos, declare the externally verifiable claims and their source URLs.'));",
  "  }"
].join('\n');
source = replaceOnce(source, oldNoClaims, newNoClaims, 'avoid duplicate missing-claims finding');
write('utils/quality-agents-v9.js', source);

const pkg = JSON.parse(read('package.json'));
pkg.scripts = pkg.scripts || {};
pkg.scripts['test:evidence-claims-autopublish'] = 'node ../bootstrap/verify-evidence-claims-autopublish.js';
write('package.json', JSON.stringify(pkg, null, 2) + '\n');

console.log('Evidence claims autopublish hardening active.');
