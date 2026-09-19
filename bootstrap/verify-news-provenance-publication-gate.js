'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const read = rel => fs.readFileSync(path.join(upstream, rel), 'utf8').replace(/\r\n/g, '\n');

(async () => {
  const qualityPath = path.join(upstream, 'utils', 'quality-agents-v9.js');
  const { factAgent } = require(qualityPath);

  const nonNews = {
    strategy: { topic: 'A fictional storytelling exercise', requestedStyle: 'story' },
    script: { title: 'A fictional storytelling exercise', claims: [] },
    provenance: { status: 'not_required', summary: { unresolvedClaims: 0, resolvedClaims: 0, verifiedSources: 0 } }
  };
  const nonNewsResult = factAgent(nonNews);
  assert.strictEqual(nonNewsResult.passed, true, 'claim-free non-news content may use provenance=not_required');
  assert(!nonNewsResult.findings.some(item => item.id === 'fact_provenance'), 'not_required must not be a universal blocker');

  const newsroomNoClaims = {
    strategy: {
      topic: 'Developing global event',
      newsroomClusterId: 'cluster_test',
      newsroomAction: 'RESEARCH_CANDIDATE',
      requiresNewsCorroboration: true
    },
    script: { title: 'Developing global event', claims: [] },
    provenance: { status: 'not_required', summary: { unresolvedClaims: 0, resolvedClaims: 0, verifiedSources: 0 } }
  };
  const newsroomBlocked = factAgent(newsroomNoClaims);
  assert.strictEqual(newsroomBlocked.passed, false, 'Global Newsroom content without auditable claims must fail closed');
  assert(newsroomBlocked.findings.some(item => item.id === 'fact_news_claims_required' && item.blocking), 'newsroom missing claims must have explicit blocker');
  assert(newsroomBlocked.metrics.newsroomEvidenceRequired === true, 'fact metrics must expose newsroom evidence requirement');

  const newsroomVerified = {
    strategy: {
      topic: 'Developing global event',
      newsroomAssignmentId: 'assignment_test',
      newsroomAction: 'COVER',
      evidencePack: { sources: [{ status: 'verified', url: 'https://source.example/report', evidenceText: 'Confirmed event details.' }] }
    },
    script: {
      title: 'Developing global event',
      claims: [{ text: 'The event occurred.', sourceUrls: ['https://source.example/report'], verified: true }],
      evidenceReview: { status: 'verified' }
    },
    provenance: { status: 'verified', summary: { unresolvedClaims: 0, resolvedClaims: 1, verifiedSources: 1 } }
  };
  const newsroomPassed = factAgent(newsroomVerified);
  assert.strictEqual(newsroomPassed.passed, true, 'verified Global Newsroom claims must pass the factual gate');

  const indexSource = read('index.js');
  assert(indexSource.includes('generated.newsroomAssignmentId = strategyContext.newsroomAssignmentId || null;'), 'generation strategy must preserve newsroom assignment metadata');
  assert(indexSource.includes('generated.newsroomClusterId = strategyContext.newsroomClusterId || null;'), 'generation strategy must preserve newsroom cluster metadata');
  assert(indexSource.includes('generated.requiresNewsCorroboration = Boolean(strategyContext.requiresNewsCorroboration);'), 'generation strategy must preserve corroboration requirement');
  assert(indexSource.includes('passed quality but is waiting for human approval because approval_required=true'), 'runtime must expose human approval as the remaining publication hold');

  const scriptSource = read('agents/script-writer-agent.js');
  assert(scriptSource.includes("error.code = 'EVIDENCE_NEWS_CLAIMS_REQUIRED'"), 'news scripts without claims must fail before media production');
  assert(scriptSource.includes('Global Newsroom scripts must declare auditable factual claims with evidence URLs before production.'), 'news claim requirement must be explicit');

  console.log('News provenance/publication verification passed: contextual not_required, fail-closed news claims, preserved newsroom metadata, and explicit approval hold.');
})().catch(error => { console.error(error.stack || error.message || String(error)); process.exit(1); });
