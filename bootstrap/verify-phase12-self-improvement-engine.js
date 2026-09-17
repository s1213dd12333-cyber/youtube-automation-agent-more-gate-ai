'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const read = rel => fs.readFileSync(path.join(upstream, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

function mustContain(rel, needle, label) {
  const text = read(rel);
  assert(text.includes(needle), `${label} missing in ${rel}`);
}

function syntax(rel) {
  childProcess.execFileSync(process.execPath, ['--check', path.join(upstream, rel)], { stdio: 'pipe' });
}

class MemoryDb {
  constructor() { this.observations = new Map(); this.proposals = new Map(); this.runs = []; }
  async executeQuery(sql, params = []) {
    if (sql.includes('newsroom_self_improvement_observations') && sql.startsWith('INSERT')) {
      const [observation_id, source, category, severity, fingerprint, summary, evidence_json, context_json] = params;
      if (!this.observations.has(observation_id)) this.observations.set(observation_id, { observation_id, source, category, severity, fingerprint, summary, evidence_json, context_json, created_at: new Date().toISOString() });
      return {};
    }
    if (sql.includes('newsroom_self_improvement_proposals') && sql.startsWith('INSERT')) {
      const [proposal_id, kind, title, rationale, target_json, change_json, evidence_json, confidence, risk] = params;
      if (!this.proposals.has(proposal_id)) this.proposals.set(proposal_id, { proposal_id, kind, status: 'proposed', title, rationale, target_json, change_json, evidence_json, confidence, risk, requires_human_approval: 1, approved_by: null, approved_at: null, github_branch: null, github_pr_number: null, github_pr_url: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      return {};
    }
    if (sql.includes("status = 'approved'")) {
      const [actor, id] = params; const row = this.proposals.get(id); row.status = 'approved'; row.approved_by = actor; row.approved_at = new Date().toISOString(); row.updated_at = new Date().toISOString(); return {};
    }
    if (sql.includes("status = 'rejected'")) {
      const [actor, id] = params; const row = this.proposals.get(id); row.status = 'rejected'; row.approved_by = actor; row.updated_at = new Date().toISOString(); return {};
    }
    if (sql.includes("status = 'pr_open'")) {
      const [branch, number, url, id] = params; const row = this.proposals.get(id); row.status = 'pr_open'; row.github_branch = branch; row.github_pr_number = number; row.github_pr_url = url; row.updated_at = new Date().toISOString(); return {};
    }
    if (sql.includes('newsroom_self_improvement_runs') && sql.startsWith('INSERT')) { this.runs.push({ params }); return {}; }
    throw new Error(`Unhandled executeQuery: ${sql}`);
  }
  async getRow(sql, params = []) {
    if (sql.includes('WHERE proposal_id = ?')) return this.proposals.get(params[0]) || null;
    if (sql.includes('COUNT(*)') && sql.includes('observations')) return { count: this.observations.size };
    if (sql.includes('COUNT(*)') && sql.includes("status = 'pr_open'")) return { count: [...this.proposals.values()].filter(x => x.status === 'pr_open').length };
    if (sql.includes('COUNT(*)') && sql.includes('proposals')) return { count: this.proposals.size };
    return null;
  }
  async getAllRows(sql, params = []) {
    if (sql.includes('newsroom_self_improvement_proposals')) return [...this.proposals.values()].slice(0, Number(params[0] || 100));
    return [];
  }
}

(async () => {
  syntax('utils/self-improvement-engine-v1212.js');
  syntax('agents/analytics-optimization-agent.js');
  syntax('index.js');

  mustContain('database/db.js', 'newsroom_self_improvement_observations', 'observation schema');
  mustContain('database/db.js', 'newsroom_self_improvement_proposals', 'proposal schema');
  mustContain('agents/analytics-optimization-agent.js', 'SelfImprovementEngineV1212', 'analytics integration');
  mustContain('agents/analytics-optimization-agent.js', 'selfImprovement.inspectPerformance', 'automatic inspection');
  mustContain('index.js', '/api/newsroom/self-improvement/proposals/:id/open-pr', 'guarded PR endpoint');
  mustContain('.env.example', 'SELF_IMPROVEMENT_GITHUB_ENABLED=false', 'GitHub opt-in default');
  mustContain('package.json', 'test:self-improvement', 'test script');

  const { SelfImprovementEngineV1212 } = require(path.join(upstream, 'utils', 'self-improvement-engine-v1212.js'));
  const db = new MemoryDb();
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (url.includes('/git/ref/heads/main')) return { ok: true, status: 200, text: async () => JSON.stringify({ object: { sha: 'base123' } }) };
    if (url.endsWith('/git/refs')) return { ok: true, status: 201, text: async () => JSON.stringify({ ref: 'refs/heads/x' }) };
    if (url.includes('/contents/')) {
      if ((options.method || 'GET') === 'GET') return { ok: false, status: 404, text: async () => JSON.stringify({ message: 'Not Found' }) };
      return { ok: true, status: 201, text: async () => JSON.stringify({ content: { sha: 'newsha' } }) };
    }
    if (url.endsWith('/pulls')) return { ok: true, status: 201, text: async () => JSON.stringify({ number: 77, html_url: 'https://github.test/pr/77' }) };
    throw new Error(`Unexpected fake GitHub request: ${url}`);
  };
  const engine = new SelfImprovementEngineV1212(db, { fetch: fakeFetch });

  const observation = await engine.observe({ source: 'ci', category: 'regression', severity: 'high', summary: 'Verifier gate failed repeatedly.', evidence: [{ test: 'phase12' }] });
  assert(observation.observationId.startsWith('siobs_'));

  const promptProposal = await engine.propose({ kind: 'prompt', title: 'Clarify evidence prompt', rationale: 'Repeated hallucination guard misses.', change: { promptKey: 'research', replacement: 'Use only cited evidence.' }, confidence: 0.8, risk: 'low' });
  assert.equal(promptProposal.status, 'proposed');
  assert.equal(promptProposal.requiresHumanApproval, true);

  const codeProposal = await engine.propose({ kind: 'code', title: 'Harden retry gate', rationale: 'CI diagnostics show a deterministic retry bug.', change: { files: [{ path: 'utils/retry-gate.js', content: "'use strict';\nmodule.exports = { safe: true };\n" }] }, evidence: [{ failingTest: 'retry-gate' }], confidence: 0.9, risk: 'high' });
  assert.equal(codeProposal.status, 'proposed');

  let blocked = false;
  try { await engine.openCodePullRequest(codeProposal.proposalId); } catch (error) { blocked = error.code === 'self_improvement_human_approval_required'; }
  assert(blocked, 'code PR must be blocked before explicit human approval');
  assert.equal(calls.length, 0, 'GitHub must not be contacted before approval');

  await engine.approve(codeProposal.proposalId, 'human-reviewer');
  process.env.SELF_IMPROVEMENT_GITHUB_ENABLED = 'true';
  process.env.SELF_IMPROVEMENT_GITHUB_REPOSITORY = 'owner/repo';
  process.env.SELF_IMPROVEMENT_GITHUB_BASE_BRANCH = 'main';
  process.env.SELF_IMPROVEMENT_GITHUB_TOKEN = 'test-token';
  const opened = await engine.openCodePullRequest(codeProposal.proposalId);
  assert.equal(opened.status, 'pr_open');
  assert.equal(opened.githubPrNumber, 77);
  assert(calls.some(call => call.method === 'POST' && call.url.endsWith('/pulls')), 'approved code must be able to open a PR');
  assert(!calls.some(call => call.url.includes('/merge')), 'engine must expose no merge call');
  assert(!calls.some(call => call.method === 'PUT' && call.url.includes('/git/refs/heads/main')), 'engine must never write directly to production ref');

  const status = await engine.status();
  assert.equal(status.mergeCapability, false);
  assert.equal(status.productionWriteCapability, false);
  assert.equal(status.allowCodeAutoMerge, false);
  assert(String(status.approvalPolicy).includes('never merges'));

  delete process.env.SELF_IMPROVEMENT_GITHUB_ENABLED;
  delete process.env.SELF_IMPROVEMENT_GITHUB_REPOSITORY;
  delete process.env.SELF_IMPROVEMENT_GITHUB_BASE_BRANCH;
  delete process.env.SELF_IMPROVEMENT_GITHUB_TOKEN;

  console.log('Phase 12.12 Self-Improvement Engine verification passed.');
})().catch(error => { console.error(error); process.exit(1); });
