'use strict';

const crypto = require('crypto');

const VERSION = '12.12';
const VALID_KINDS = new Set(['prompt', 'rule', 'code']);
const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const VALID_RISKS = new Set(['low', 'medium', 'high']);

function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function parseJson(value, fallback = null) { try { return value == null ? fallback : JSON.parse(value); } catch (_error) { return fallback; } }
function clamp(value, min, max, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function slug(value) { return String(value || '').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72); }
function nowIso() { return new Date().toISOString(); }

class SelfImprovementEngineV1212 {
  constructor(db, options = {}) {
    this.db = db || null;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.fetch = options.fetch || global.fetch;
  }

  getConfig() {
    return {
      version: VERSION,
      enabled: String(process.env.SELF_IMPROVEMENT_ENABLED || 'true').toLowerCase() !== 'false',
      githubEnabled: String(process.env.SELF_IMPROVEMENT_GITHUB_ENABLED || 'false').toLowerCase() === 'true',
      repository: String(process.env.SELF_IMPROVEMENT_GITHUB_REPOSITORY || '').trim(),
      baseBranch: String(process.env.SELF_IMPROVEMENT_GITHUB_BASE_BRANCH || 'main').trim(),
      tokenConfigured: Boolean(String(process.env.SELF_IMPROVEMENT_GITHUB_TOKEN || '').trim()),
      allowPromptAutoApply: false,
      allowRuleAutoApply: false,
      allowCodeAutoMerge: false,
      approvalPolicy: 'Every proposal requires explicit human approval. Code may create a branch and pull request only after approval; this engine never merges pull requests or writes directly to the production branch.'
    };
  }

  async observe(input = {}) {
    const config = this.getConfig();
    if (!config.enabled) return { ignored: true, reason: 'self_improvement_disabled', version: VERSION };
    if (!this.db) return { ignored: true, reason: 'persistence_unavailable', version: VERSION };
    const source = String(input.source || 'system').slice(0, 120);
    const category = String(input.category || 'runtime_quality').slice(0, 120);
    const severity = VALID_SEVERITIES.has(input.severity) ? input.severity : 'medium';
    const summary = String(input.summary || '').trim();
    if (!summary) throw Object.assign(new Error('self_improvement_summary_required'), { code: 'self_improvement_summary_required' });
    const evidence = Array.isArray(input.evidence) ? input.evidence.slice(0, 50) : [];
    const context = input.context && typeof input.context === 'object' ? input.context : {};
    const fingerprint = hash(JSON.stringify({ source, category, summary: summary.toLowerCase(), evidence }));
    const observationId = `siobs_${fingerprint.slice(0, 24)}`;
    await this.db.executeQuery(
      'INSERT OR IGNORE INTO newsroom_self_improvement_observations (observation_id, source, category, severity, fingerprint, summary, evidence_json, context_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [observationId, source, category, severity, fingerprint, summary, JSON.stringify(evidence), JSON.stringify(context)]
    );
    return { observationId, source, category, severity, summary, fingerprint, version: VERSION };
  }

  async inspectPerformance(report = {}, context = {}) {
    const findings = [];
    const proposals = [];
    const qualityScore = Number(report.performance?.score ?? report.qualityScore ?? 100);
    if (Number.isFinite(qualityScore) && qualityScore < 60) {
      const evidence = [{ qualityScore, videoId: report.videoId || null }];
      findings.push(await this.observe({ source: 'analytics', category: 'content_quality', severity: qualityScore < 40 ? 'high' : 'medium', summary: `Published output quality score fell to ${qualityScore}/100.`, evidence, context }));
      proposals.push(await this.propose({ kind: 'rule', title: 'Strengthen quality retry gate', rationale: `Published quality reached ${qualityScore}/100, indicating the current acceptance gate may be too permissive.`, target: { subsystem: 'quality-council', rule: 'minimum_acceptance_score' }, change: { recommendation: 'Raise or conditionally tighten the pre-publication quality threshold and force a retry when the same failure category repeats.' }, evidence, confidence: qualityScore < 40 ? 0.9 : 0.75, risk: 'medium' }));
    }
    const ctr = Number(report.thumbnailMetrics?.clickThroughRate ?? report.analytics?.views?.averageCTR ?? 0);
    if (ctr > 0 && ctr < 2) {
      const evidence = [{ ctr, videoId: report.videoId || null }];
      findings.push(await this.observe({ source: 'analytics', category: 'packaging', severity: 'medium', summary: `CTR is unusually low at ${ctr}%.`, evidence, context }));
      proposals.push(await this.propose({ kind: 'prompt', title: 'Improve title and thumbnail hypothesis generation', rationale: `CTR measured ${ctr}%, so packaging ideation should generate clearer competing hypotheses before publication.`, target: { subsystem: 'content-strategy', prompt: 'packaging_ideation' }, change: { recommendation: 'Require multiple evidence-grounded title/thumbnail hypotheses, explicit audience promise, and a differentiation check before selecting packaging.' }, evidence, confidence: 0.72, risk: 'low' }));
    }
    const retention = Number(report.analytics?.watchTime?.averageViewPercentage ?? 0);
    if (retention > 0 && retention < 30) {
      const evidence = [{ retention, videoId: report.videoId || null }];
      findings.push(await this.observe({ source: 'analytics', category: 'retention', severity: 'medium', summary: `Average view percentage is low at ${retention}%.`, evidence, context }));
      proposals.push(await this.propose({ kind: 'prompt', title: 'Strengthen opening and retention structure', rationale: `Average view percentage measured ${retention}%, suggesting the narrative structure is not holding attention strongly enough.`, target: { subsystem: 'script-generation', prompt: 'retention_structure' }, change: { recommendation: 'Require a concrete opening promise, earlier payoff, fewer repeated setup beats, and explicit retention checkpoints without adding unsupported claims.' }, evidence, confidence: 0.78, risk: 'low' }));
    }
    return { findings: findings.filter(Boolean), proposals: proposals.filter(Boolean), version: VERSION };
  }

  async propose(input = {}) {
    if (!this.db) throw Object.assign(new Error('self_improvement_persistence_required'), { code: 'self_improvement_persistence_required' });
    const kind = String(input.kind || '').toLowerCase();
    if (!VALID_KINDS.has(kind)) throw Object.assign(new Error('self_improvement_invalid_kind'), { code: 'self_improvement_invalid_kind' });
    const title = String(input.title || '').trim();
    const rationale = String(input.rationale || '').trim();
    if (!title || !rationale) throw Object.assign(new Error('self_improvement_title_and_rationale_required'), { code: 'self_improvement_title_and_rationale_required' });
    const target = input.target && typeof input.target === 'object' ? input.target : {};
    const change = input.change && typeof input.change === 'object' ? input.change : {};
    const evidence = Array.isArray(input.evidence) ? input.evidence.slice(0, 50) : [];
    const confidence = clamp(input.confidence, 0, 1, 0.5);
    const risk = VALID_RISKS.has(input.risk) ? input.risk : (kind === 'code' ? 'high' : 'medium');
    if (kind === 'code') this.validateCodeChange(change);
    const fingerprint = hash(JSON.stringify({ kind, title, rationale, target, change, evidence }));
    const proposalId = `siprop_${fingerprint.slice(0, 24)}`;
    await this.db.executeQuery(
      `INSERT OR IGNORE INTO newsroom_self_improvement_proposals (proposal_id, kind, status, title, rationale, target_json, change_json, evidence_json, confidence, risk, requires_human_approval) VALUES (?, ?, 'proposed', ?, ?, ?, ?, ?, ?, ?, 1)`,
      [proposalId, kind, title, rationale, JSON.stringify(target), JSON.stringify(change), JSON.stringify(evidence), confidence, risk]
    );
    return this.getProposal(proposalId);
  }

  validateCodeChange(change = {}) {
    const files = Array.isArray(change.files) ? change.files : [];
    if (!files.length) throw Object.assign(new Error('self_improvement_code_files_required'), { code: 'self_improvement_code_files_required' });
    for (const file of files) {
      const path = String(file.path || '').trim();
      if (!path || path.startsWith('/') || path.includes('..')) throw Object.assign(new Error('self_improvement_invalid_code_path'), { code: 'self_improvement_invalid_code_path' });
      if (typeof file.content !== 'string') throw Object.assign(new Error('self_improvement_code_content_required'), { code: 'self_improvement_code_content_required' });
    }
  }

  async getProposal(proposalId) {
    const row = await this.db.getRow('SELECT * FROM newsroom_self_improvement_proposals WHERE proposal_id = ?', [proposalId]);
    return row ? this.mapProposal(row) : null;
  }

  mapProposal(row) {
    return {
      proposalId: row.proposal_id, kind: row.kind, status: row.status, title: row.title, rationale: row.rationale,
      target: parseJson(row.target_json, {}), change: parseJson(row.change_json, {}), evidence: parseJson(row.evidence_json, []),
      confidence: Number(row.confidence || 0), risk: row.risk, requiresHumanApproval: Boolean(row.requires_human_approval),
      approvedBy: row.approved_by || null, approvedAt: row.approved_at || null, githubBranch: row.github_branch || null,
      githubPrNumber: row.github_pr_number || null, githubPrUrl: row.github_pr_url || null, createdAt: row.created_at, updatedAt: row.updated_at,
      version: VERSION
    };
  }

  async listProposals(limit = 100) {
    if (!this.db) return [];
    const rows = await this.db.getAllRows('SELECT * FROM newsroom_self_improvement_proposals ORDER BY created_at DESC LIMIT ?', [Math.max(1, Math.min(500, Number(limit) || 100))]);
    return (rows || []).map(row => this.mapProposal(row));
  }

  async approve(proposalId, actor = 'operator') {
    const proposal = await this.getProposal(proposalId);
    if (!proposal) throw Object.assign(new Error('self_improvement_proposal_not_found'), { code: 'self_improvement_proposal_not_found' });
    if (proposal.status !== 'proposed') throw Object.assign(new Error('self_improvement_proposal_not_pending'), { code: 'self_improvement_proposal_not_pending' });
    await this.db.executeQuery("UPDATE newsroom_self_improvement_proposals SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE proposal_id = ?", [String(actor || 'operator').slice(0, 120), proposalId]);
    return this.getProposal(proposalId);
  }

  async reject(proposalId, actor = 'operator') {
    const proposal = await this.getProposal(proposalId);
    if (!proposal) throw Object.assign(new Error('self_improvement_proposal_not_found'), { code: 'self_improvement_proposal_not_found' });
    await this.db.executeQuery("UPDATE newsroom_self_improvement_proposals SET status = 'rejected', approved_by = ?, updated_at = CURRENT_TIMESTAMP WHERE proposal_id = ?", [String(actor || 'operator').slice(0, 120), proposalId]);
    return this.getProposal(proposalId);
  }

  githubHeaders() {
    const token = String(process.env.SELF_IMPROVEMENT_GITHUB_TOKEN || '').trim();
    if (!token) throw Object.assign(new Error('self_improvement_github_token_required'), { code: 'self_improvement_github_token_required' });
    return { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' };
  }

  async githubRequest(method, path, body) {
    if (typeof this.fetch !== 'function') throw Object.assign(new Error('self_improvement_fetch_unavailable'), { code: 'self_improvement_fetch_unavailable' });
    const response = await this.fetch(`https://api.github.com${path}`, { method, headers: this.githubHeaders(), body: body == null ? undefined : JSON.stringify(body) });
    const text = await response.text();
    const payload = text ? parseJson(text, { message: text }) : {};
    if (!response.ok) throw Object.assign(new Error(payload?.message || `github_http_${response.status}`), { code: 'self_improvement_github_error', status: response.status, details: payload });
    return payload;
  }

  async openCodePullRequest(proposalId) {
    const config = this.getConfig();
    const proposal = await this.getProposal(proposalId);
    if (!proposal) throw Object.assign(new Error('self_improvement_proposal_not_found'), { code: 'self_improvement_proposal_not_found' });
    if (proposal.kind !== 'code') throw Object.assign(new Error('self_improvement_code_proposal_required'), { code: 'self_improvement_code_proposal_required' });
    if (proposal.status !== 'approved') throw Object.assign(new Error('self_improvement_human_approval_required'), { code: 'self_improvement_human_approval_required' });
    if (!config.githubEnabled || !config.repository || !config.tokenConfigured) throw Object.assign(new Error('self_improvement_github_not_configured'), { code: 'self_improvement_github_not_configured' });
    if (proposal.githubPrNumber) return proposal;
    this.validateCodeChange(proposal.change);

    const [owner, repo] = config.repository.split('/');
    if (!owner || !repo) throw Object.assign(new Error('self_improvement_invalid_repository'), { code: 'self_improvement_invalid_repository' });
    const base = await this.githubRequest('GET', `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(config.baseBranch)}`);
    const branch = `self-improvement/${slug(proposal.title) || proposal.proposalId.slice(-8)}-${proposal.proposalId.slice(-6)}`;
    await this.githubRequest('POST', `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: base.object.sha });

    for (const file of proposal.change.files) {
      let currentSha = null;
      try {
        const existing = await this.githubRequest('GET', `/repos/${owner}/${repo}/contents/${file.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`);
        currentSha = existing.sha || null;
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      const body = { message: `Self-improvement ${proposal.proposalId}: ${proposal.title}`, content: Buffer.from(file.content, 'utf8').toString('base64'), branch };
      if (currentSha) body.sha = currentSha;
      await this.githubRequest('PUT', `/repos/${owner}/${repo}/contents/${file.path.split('/').map(encodeURIComponent).join('/')}`, body);
    }

    const pr = await this.githubRequest('POST', `/repos/${owner}/${repo}/pulls`, {
      title: `[Self-Improvement] ${proposal.title}`,
      head: branch,
      base: config.baseBranch,
      body: `${proposal.rationale}\n\nProposal: ${proposal.proposalId}\nRisk: ${proposal.risk}\n\nGuardrail: this PR was generated after explicit human approval. The Self-Improvement Engine cannot merge it; normal review and CI remain mandatory.`,
      draft: true
    });
    await this.db.executeQuery("UPDATE newsroom_self_improvement_proposals SET status = 'pr_open', github_branch = ?, github_pr_number = ?, github_pr_url = ?, updated_at = CURRENT_TIMESTAMP WHERE proposal_id = ?", [branch, pr.number, pr.html_url, proposalId]);
    await this.recordRun(proposalId, 'open_code_pull_request', 'success', { branch, prNumber: pr.number, prUrl: pr.html_url });
    return this.getProposal(proposalId);
  }

  async recordRun(proposalId, action, status, details = {}) {
    if (!this.db) return null;
    const runId = `sirun_${hash(JSON.stringify({ proposalId, action, status, details, at: nowIso() })).slice(0, 24)}`;
    await this.db.executeQuery('INSERT INTO newsroom_self_improvement_runs (run_id, proposal_id, action, status, details_json) VALUES (?, ?, ?, ?, ?)', [runId, proposalId, action, status, JSON.stringify(details)]);
    return runId;
  }

  async status() {
    const config = this.getConfig();
    if (!this.db) return { ...config, observations: 0, proposals: 0 };
    const [observations, proposals, prOpen] = await Promise.all([
      this.db.getRow('SELECT COUNT(*) AS count FROM newsroom_self_improvement_observations', []),
      this.db.getRow('SELECT COUNT(*) AS count FROM newsroom_self_improvement_proposals', []),
      this.db.getRow("SELECT COUNT(*) AS count FROM newsroom_self_improvement_proposals WHERE status = 'pr_open'", [])
    ]);
    return {
      ...config,
      observations: Number(observations?.count || 0),
      proposals: Number(proposals?.count || 0),
      openPullRequests: Number(prOpen?.count || 0),
      mergeCapability: false,
      productionWriteCapability: false
    };
  }
}

module.exports = { SelfImprovementEngineV1212, VERSION };
