'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const servicePath = path.join(upstream, 'utils', 'research-evidence-v5.js');
if (!fs.existsSync(servicePath)) throw new Error('Phase 5 service is not materialized: utils/research-evidence-v5.js');

const {
  ResearchAgentV5,
  EvidenceDeskV5,
  canonicalUrl,
  reconstructAbstract,
  lexicalSupport
} = require(servicePath);

const originalEnv = { ...process.env };
const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('canonical URLs remove fragments and reject unsafe protocols', () => {
  assert.strictEqual(canonicalUrl('https://example.com/a#section'), 'https://example.com/a');
  assert.strictEqual(canonicalUrl('file:///tmp/test'), '');
});

check('OpenAlex inverted abstracts are reconstructed in word order', () => {
  assert.strictEqual(reconstructAbstract({ clocks: [1], Atomic: [0], differ: [2] }), 'Atomic clocks differ');
});

check('lexical support exposes transparent matched tokens', () => {
  const support = lexicalSupport(
    'Atomic clocks at higher elevation run faster because gravity affects time.',
    { title: 'Atomic clocks and gravity', evidenceText: 'Atomic clocks at higher elevation run faster because gravitational potential affects time.' }
  );
  assert(support.score >= 0.5);
  assert(support.matchedTokens.includes('atomic'));
  assert(support.matchedTokens.includes('clocks'));
});

const calls = [];
const fakeHttp = {
  async get(url, config) {
    calls.push({ url, config });
    if (url.includes('wikipedia.org')) {
      return { data: { query: { pages: {
        1: { title: 'Gravitational time dilation', fullurl: 'https://en.wikipedia.org/wiki/Gravitational_time_dilation', extract: 'Gravitational time dilation means clocks at different gravitational potentials can measure different elapsed time.' }
      } } } };
    }
    if (url.includes('crossref.org')) {
      return { data: { message: { items: [{
        DOI: '10.1000/atomic-clock-test',
        URL: 'https://doi.org/10.1000/atomic-clock-test',
        title: ['Atomic clocks and gravitational potential'],
        publisher: 'Example Physics Society',
        published: { 'date-parts': [[2020, 1, 2]] },
        abstract: '<jats:p>Atomic clocks at higher elevations run faster as gravitational potential changes.</jats:p>'
      }] } } };
    }
    if (url.includes('openalex.org')) {
      return { data: { results: [{
        id: 'https://openalex.org/W123',
        doi: 'https://doi.org/10.2000/openalex-clock',
        title: 'Relativistic clock comparisons',
        publication_date: '2021-04-05',
        primary_location: { source: { display_name: 'Journal of Precision Time' } },
        abstract_inverted_index: {
          Atomic: [0], clocks: [1], at: [2], different: [3], elevations: [4], reveal: [5], gravitational: [6], time: [7], dilation: [8]
        }
      }] } };
    }
    throw new Error(`Unexpected URL: ${url}`);
  }
};

const savedPacks = [];
const savedReviews = [];
const fakeDb = {
  async saveResearchEvidencePack(pack) { savedPacks.push(pack); return pack.id; },
  async saveEvidenceReview(review) { savedReviews.push(review); return review.id; }
};
let researchPack;

check('Research Agent queries Wikipedia, Crossref, and OpenAlex without paid APIs', async () => {
  const agent = new ResearchAgentV5(fakeDb, { http: fakeHttp, maxSources: 12, logger: { info() {}, warn() {}, error() {} } });
  researchPack = await agent.research({
    jobId: 'job_phase5',
    topic: 'atomic clocks gravitational time dilation',
    seedSources: [{ url: 'https://example.org/metadata-only', title: 'Metadata only source' }]
  });
  assert.strictEqual(calls.filter(call => /wikipedia|crossref|openalex/.test(call.url)).length, 3);
  assert(researchPack.sources.length >= 4);
  assert.strictEqual(researchPack.status, 'ready');
});

check('Wikipedia requests identify Lumen with a User-Agent', () => {
  const call = calls.find(item => item.url.includes('wikipedia.org'));
  assert(call.config.headers['User-Agent'].includes('LumenAtlas/1.0'));
  assert.strictEqual(call.config.headers.Accept, 'application/json');
});

check('metadata-only seed URLs are not mislabeled as verified evidence', () => {
  const seed = researchPack.sources.find(source => source.url === 'https://example.org/metadata-only');
  assert(seed);
  assert.strictEqual(seed.status, 'discovered');
  assert.strictEqual(seed.evidenceText, '');
});

check('scholarly adapters retain retrieved evidence text', () => {
  const scholarly = researchPack.sources.filter(source => source.sourceClass === 'scholarly');
  assert(scholarly.length >= 2);
  assert(scholarly.every(source => source.evidenceText.length > 0));
  assert(researchPack.summary.scholarlySources >= 2);
});

check('research packs are persisted for audit and resume visibility', () => {
  assert.strictEqual(savedPacks.length, 1);
  assert.strictEqual(savedPacks[0].jobId, 'job_phase5');
  assert(savedPacks[0].summary.verifiedEvidenceSources >= 3);
});

check('Evidence Desk supports a standard claim only from retrieved evidence', async () => {
  const desk = new EvidenceDeskV5(fakeDb, { standardThreshold: 0.2, highThreshold: 0.3 });
  const review = await desk.verifyScript({
    jobId: 'job_phase5', evidencePack: researchPack,
    script: {
      title: 'Time and altitude', fullScript: 'Atomic clocks at higher elevations run faster as gravitational potential changes.',
      claims: [{
        text: 'Atomic clocks at higher elevations run faster as gravitational potential changes.',
        riskLevel: 'standard', sourceUrls: ['https://doi.org/10.1000/atomic-clock-test']
      }]
    }
  });
  assert.strictEqual(review.status, 'verified');
  assert.strictEqual(review.claims[0].status, 'supported');
  assert(review.claims[0].confidence >= 0.5);
});

check('one strong scholarly source can satisfy a high-risk claim threshold', async () => {
  const desk = new EvidenceDeskV5(null, { standardThreshold: 0.2, highThreshold: 0.3 });
  const review = await desk.verifyScript({ evidencePack: researchPack, script: {
    title: 'High risk test', fullScript: 'Atomic clocks at higher elevations run faster as gravitational potential changes.',
    claims: [{ text: 'Atomic clocks at higher elevations run faster as gravitational potential changes.', riskLevel: 'high', sourceUrls: ['https://doi.org/10.1000/atomic-clock-test'] }]
  } });
  assert.strictEqual(review.status, 'verified');
});

check('an uncited factual claim is blocked', async () => {
  const desk = new EvidenceDeskV5(null, { standardThreshold: 0.2 });
  const review = await desk.verifyScript({ evidencePack: researchPack, script: {
    title: 'Unsupported', fullScript: 'A factual assertion.',
    claims: [{ text: 'A factual assertion about clocks.', sourceUrls: [] }]
  } });
  assert.strictEqual(review.status, 'blocked');
  assert(review.claims[0].notes.includes('No source URL'));
});

check('a citation outside the evidence packet does not count as support', async () => {
  const desk = new EvidenceDeskV5(null, { standardThreshold: 0.2 });
  const review = await desk.verifyScript({ evidencePack: researchPack, script: {
    title: 'Unknown citation', fullScript: 'Atomic clocks change.',
    claims: [{ text: 'Atomic clocks change with altitude.', sourceUrls: ['https://not-in-pack.example/source'] }]
  } });
  assert.strictEqual(review.status, 'blocked');
  assert(review.claims[0].notes.includes('not present'));
});

check('strict Evidence Desk throws before production on blocked claims', () => {
  process.env.EVIDENCE_STRICT_MODE = 'true';
  const desk = new EvidenceDeskV5(null);
  assert.throws(
    () => desk.assertReview({ status: 'blocked', claims: [{ id: 'c1', text: 'unsupported', status: 'unsupported', notes: 'missing evidence' }] }),
    error => error.code === 'EVIDENCE_CLAIMS_UNVERIFIED' && error.status === 422
  );
});

check('strict mode can be explicitly disabled for operator-controlled diagnostics', () => {
  process.env.EVIDENCE_STRICT_MODE = 'false';
  const desk = new EvidenceDeskV5(null);
  const review = { status: 'blocked', claims: [{ status: 'unsupported' }] };
  assert.strictEqual(desk.assertReview(review), review);
  process.env.EVIDENCE_STRICT_MODE = 'true';
});

check('evidence reviews are persisted as an audit artifact', () => {
  assert(savedReviews.length >= 1);
  assert.strictEqual(savedReviews[0].jobId, 'job_phase5');
  assert(savedReviews[0].scriptHash);
});

check('database materialization includes research and evidence audit tables', () => {
  const source = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
  assert(source.includes('CREATE TABLE IF NOT EXISTS research_evidence_packs'));
  assert(source.includes('CREATE TABLE IF NOT EXISTS evidence_reviews'));
  assert(source.includes('async saveResearchEvidencePack(pack = {})'));
  assert(source.includes('async saveEvidenceReview(review = {})'));
});

check('Research Agent runs inside the strategy checkpoint', () => {
  const source = fs.readFileSync(path.join(upstream, 'index.js'), 'utf8');
  assert(source.includes('const evidencePack = await this.researchAgent.research({'));
  assert(source.includes('generated.evidencePack = evidencePack;'));
  assert(source.includes('artifact: strategy'));
});

check('old strategy checkpoints are migrated to evidence packets', () => {
  const source = fs.readFileSync(path.join(upstream, 'index.js'), 'utf8');
  assert(source.includes('!strategy.evidencePack'));
  assert(source.includes("saveGenerationCheckpoint(jobId, 'strategy'"));
});

check('script prompt receives evidence excerpts rather than URL-only research', () => {
  const source = fs.readFileSync(path.join(upstream, 'agents', 'script-writer-agent.js'), 'utf8');
  assert(source.includes('Evidence packet:'));
  assert(source.includes("evidenceText: String(source.evidenceText || '').slice(0, 1800)"));
  assert(source.includes('Do not cite a source only because its title sounds relevant.'));
});

check('Evidence Desk gates scripts before saveScript', () => {
  const source = fs.readFileSync(path.join(upstream, 'agents', 'script-writer-agent.js'), 'utf8');
  const verifyIndex = source.indexOf('await this.verifyEvidenceBeforePersistence(normalizedScript, strategy);');
  const saveIndex = source.indexOf('await this.db.saveScript(normalizedScript);', verifyIndex);
  assert(verifyIndex >= 0 && saveIndex > verifyIndex);
  assert(source.includes('this.evidenceDesk.assertReview(review);'));
});

check('provenance reuses Evidence Desk decisions instead of resetting them to pending', () => {
  const source = fs.readFileSync(path.join(upstream, 'utils', 'provenance-service.js'), 'utf8');
  assert(source.includes('production.script?.evidenceReview?.claims'));
  assert(source.includes('Array.isArray(reviewedClaims)'));
});

check('job evidence is inspectable through the API', () => {
  const source = fs.readFileSync(path.join(upstream, 'index.js'), 'utf8');
  assert(source.includes("this.app.get('/api/jobs/:jobId/evidence'"));
  assert(source.includes('job.researchEvidence = await this.db.getResearchEvidencePack(job.id);'));
  assert(source.includes('job.evidenceReview = await this.db.getEvidenceReview(job.id);'));
});

(async () => {
  try {
    for (const item of checks) await item.fn();
    console.log(`Phase 5 research and evidence desk OK: ${checks.length} regression checks passed.`);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;
  }
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
