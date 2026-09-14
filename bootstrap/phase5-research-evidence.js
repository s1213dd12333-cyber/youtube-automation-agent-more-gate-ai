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
  if (index === -1) throw new Error(`Anchor not found for ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Anchor not found for ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'research-evidence-v5.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/research-evidence-v5.js');
  write('utils/research-evidence-v5.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const tables = [
    "      // Phase 5 research/evidence audit trail",
    "      `CREATE TABLE IF NOT EXISTS research_evidence_packs (",
    "        id TEXT PRIMARY KEY,",
    "        job_id TEXT,",
    "        topic TEXT NOT NULL,",
    "        status TEXT NOT NULL,",
    "        sources TEXT NOT NULL DEFAULT '[]',",
    "        adapter_status TEXT NOT NULL DEFAULT '{}',",
    "        summary TEXT NOT NULL DEFAULT '{}',",
    "        created_at TEXT DEFAULT CURRENT_TIMESTAMP,",
    "        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,",
    "        FOREIGN KEY (job_id) REFERENCES generation_jobs(id)",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_research_evidence_job ON research_evidence_packs(job_id, created_at)`,",
    "      `CREATE TABLE IF NOT EXISTS evidence_reviews (",
    "        id TEXT PRIMARY KEY,",
    "        job_id TEXT,",
    "        script_title TEXT,",
    "        script_hash TEXT NOT NULL,",
    "        status TEXT NOT NULL,",
    "        claims TEXT NOT NULL DEFAULT '[]',",
    "        summary TEXT NOT NULL DEFAULT '{}',",
    "        created_at TEXT DEFAULT CURRENT_TIMESTAMP,",
    "        FOREIGN KEY (job_id) REFERENCES generation_jobs(id)",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_evidence_reviews_job ON evidence_reviews(job_id, created_at)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, tables, 'phase 5 research/evidence tables');

  const methods = [
    "  async saveResearchEvidencePack(pack = {}) {",
    "    const id = pack.id || this.generateId('research');",
    "    await this.executeQuery(",
    "      `INSERT INTO research_evidence_packs (id, job_id, topic, status, sources, adapter_status, summary, created_at, updated_at)",
    "       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
    "       ON CONFLICT(id) DO UPDATE SET job_id = excluded.job_id, topic = excluded.topic, status = excluded.status,",
    "       sources = excluded.sources, adapter_status = excluded.adapter_status, summary = excluded.summary, updated_at = CURRENT_TIMESTAMP`,",
    "      [id, pack.jobId || null, pack.topic || '', pack.status || 'unavailable', JSON.stringify(pack.sources || []),",
    "       JSON.stringify(pack.adapterStatus || {}), JSON.stringify(pack.summary || {}), pack.createdAt || new Date().toISOString()]",
    "    );",
    "    return id;",
    "  }",
    "",
    "  async getResearchEvidencePack(jobId) {",
    "    if (!jobId) return null;",
    "    const row = await this.getRow('SELECT * FROM research_evidence_packs WHERE job_id = ? ORDER BY created_at DESC LIMIT 1', [jobId]);",
    "    if (!row) return null;",
    "    return { id: row.id, jobId: row.job_id, topic: row.topic, status: row.status, sources: JSON.parse(row.sources || '[]'),",
    "      adapterStatus: JSON.parse(row.adapter_status || '{}'), summary: JSON.parse(row.summary || '{}'), createdAt: row.created_at, updatedAt: row.updated_at };",
    "  }",
    "",
    "  async saveEvidenceReview(review = {}) {",
    "    const id = review.id || this.generateId('evidence');",
    "    await this.executeQuery(",
    "      `INSERT INTO evidence_reviews (id, job_id, script_title, script_hash, status, claims, summary, created_at)",
    "       VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    "       ON CONFLICT(id) DO UPDATE SET job_id = excluded.job_id, script_title = excluded.script_title,",
    "       script_hash = excluded.script_hash, status = excluded.status, claims = excluded.claims, summary = excluded.summary`,",
    "      [id, review.jobId || null, review.scriptTitle || null, review.scriptHash || '', review.status || 'blocked',",
    "       JSON.stringify(review.claims || []), JSON.stringify(review.summary || {}), review.createdAt || new Date().toISOString()]",
    "    );",
    "    return id;",
    "  }",
    "",
    "  async getEvidenceReview(jobId) {",
    "    if (!jobId) return null;",
    "    const row = await this.getRow('SELECT * FROM evidence_reviews WHERE job_id = ? ORDER BY created_at DESC LIMIT 1', [jobId]);",
    "    if (!row) return null;",
    "    return { id: row.id, jobId: row.job_id, scriptTitle: row.script_title, scriptHash: row.script_hash, status: row.status,",
    "      claims: JSON.parse(row.claims || '[]'), summary: JSON.parse(row.summary || '{}'), createdAt: row.created_at };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'phase 5 research/evidence database methods');
  write(rel, s);
}

function patchIndex() {
  const rel = 'index.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { ProvenanceService } = require('./utils/provenance-service');\n",
    "const { ProvenanceService } = require('./utils/provenance-service');\nconst { ResearchAgentV5 } = require('./utils/research-evidence-v5');\n",
    'research agent import'
  );
  s = replaceOnce(
    s,
    "    this.provenance = null;\n",
    "    this.provenance = null;\n    this.researchAgent = null;\n",
    'research agent runtime field'
  );
  s = replaceOnce(
    s,
    "      this.provenance = new ProvenanceService(this.db);\n",
    "      this.provenance = new ProvenanceService(this.db);\n      this.researchAgent = new ResearchAgentV5(this.db, { logger: this.logger });\n",
    'research agent construction'
  );

  const oldStrategyResearch = `      generated.researchSources = Array.isArray(strategyContext.researchSources)\n        ? strategyContext.researchSources\n        : [];\n      if (generated.researchSources.length === 0 && typeof this.agents.strategy.researchTopicSources === 'function') {\n        generated.researchSources = await this.agents.strategy.researchTopicSources(generated.topic);\n      }\n      return generated;`;
  const newStrategyResearch = `      generated.researchSources = Array.isArray(strategyContext.researchSources)\n        ? strategyContext.researchSources\n        : [];\n      if (this.researchAgent) {\n        const evidencePack = await this.researchAgent.research({\n          jobId, topic: generated.topic, seedSources: generated.researchSources\n        });\n        generated.researchSources = evidencePack.sources;\n        generated.evidencePack = evidencePack;\n      } else if (generated.researchSources.length === 0 && typeof this.agents.strategy.researchTopicSources === 'function') {\n        generated.researchSources = await this.agents.strategy.researchTopicSources(generated.topic);\n      }\n      return generated;`;
  s = replaceOnce(s, oldStrategyResearch, newStrategyResearch, 'research agent inside strategy checkpoint');

  const oldPostStrategy = `    if (!Array.isArray(strategy.researchSources) || strategy.researchSources.length === 0) {\n      strategy.researchSources = await this.agents.strategy.researchTopicSources(strategy.topic);\n    }\n    this.logger.info(\`Strategy generated: \${strategy.topic} (\${strategy.researchSources.length} research source(s))\`);`;
  const newPostStrategy = `    // Migrate reused pre-Phase-5 strategy checkpoints before script generation.\n    if (this.researchAgent && !strategy.evidencePack) {\n      const evidencePack = await this.researchAgent.research({\n        jobId, topic: strategy.topic, seedSources: strategy.researchSources || []\n      });\n      strategy.researchSources = evidencePack.sources;\n      strategy.evidencePack = evidencePack;\n      if (jobId) {\n        await this.db.saveGenerationCheckpoint(jobId, 'strategy', {\n          status: 'completed', artifact: strategy, error: null, completedAt: new Date().toISOString()\n        });\n      }\n    } else if ((!Array.isArray(strategy.researchSources) || strategy.researchSources.length === 0) && typeof this.agents.strategy.researchTopicSources === 'function') {\n      strategy.researchSources = await this.agents.strategy.researchTopicSources(strategy.topic);\n    }\n    this.logger.info(\`Strategy generated: \${strategy.topic} (\${strategy.researchSources.length} research source(s), evidence=\${strategy.evidencePack?.status || 'legacy'})\`);`;
  s = replaceOnce(s, oldPostStrategy, newPostStrategy, 'migrate old strategy checkpoints to evidence packs');

  const oldJobDetail = `      job.checkpoints = await this.db.listGenerationCheckpoints(job.id);\n      job.mediaTasks = await this.db.listMediaGenerationTasks(job.id);\n      job.resumeFrom = this.recovery?.resumePoint(job.checkpoints);\n      return res.json(job);`;
  const newJobDetail = `      job.checkpoints = await this.db.listGenerationCheckpoints(job.id);\n      job.mediaTasks = await this.db.listMediaGenerationTasks(job.id);\n      job.researchEvidence = await this.db.getResearchEvidencePack(job.id);\n      job.evidenceReview = await this.db.getEvidenceReview(job.id);\n      job.resumeFrom = this.recovery?.resumePoint(job.checkpoints);\n      return res.json(job);`;
  s = replaceOnce(s, oldJobDetail, newJobDetail, 'job evidence detail payload');

  const route = [
    "    this.app.get('/api/jobs/:jobId/evidence', async (req, res) => {",
    "      const job = await this.db.getGenerationJob(req.params.jobId);",
    "      if (!job) return res.status(404).json({ error: 'Job not found' });",
    "      const [research, review] = await Promise.all([",
    "        this.db.getResearchEvidencePack(job.id),",
    "        this.db.getEvidenceReview(job.id)",
    "      ]);",
    "      return res.json({ success: true, result: { research, review } });",
    "    });",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.post('/api/jobs/:jobId/resume', protect, async (req, res) => {\n", route, 'job evidence API route');
  write(rel, s);
}

function patchScriptWriter() {
  const rel = 'agents/script-writer-agent.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { normalizeScript, assertValidScript } = require('../utils/content-contracts');\n",
    "const { normalizeScript, assertValidScript } = require('../utils/content-contracts');\nconst { EvidenceDeskV5 } = require('../utils/research-evidence-v5');\n",
    'evidence desk import'
  );
  s = replaceOnce(
    s,
    "    this.aiTextService = new AITextService(credentials?.credentials || credentials || {});\n",
    "    this.aiTextService = new AITextService(credentials?.credentials || credentials || {});\n    this.evidenceDesk = new EvidenceDeskV5(db, { logger: this.logger });\n",
    'evidence desk construction'
  );

  const oldPrompt = `Research sources: \${JSON.stringify(strategy.researchSources || [])}\nAvoid fabricated statistics, unsupported claims, fake urgency, invented personal experience, invented research effort, or claims such as "I spent months researching". Never imply first-hand work, interviews, experiments, or expertise that did not occur. List every externally verifiable factual claim in claims. Every factual claim should cite one or more exact URLs from Research sources when supported; otherwise keep sourceUrls empty so provenance blocks approval. The conclusion must summarize this specific topic and its remaining uncertainty; never use generic tutorial phrases such as "practical steps", "long-term success", or "journey, not a destination" unless they genuinely fit the topic.\`;`;
  const newPrompt = `Evidence packet: \${JSON.stringify((strategy.evidencePack?.sources || strategy.researchSources || []).slice(0, 12).map(source => ({\n  url: source.url, title: source.title, publisher: source.publisher, sourceType: source.sourceType,\n  sourceClass: source.sourceClass, status: source.status, evidenceText: String(source.evidenceText || '').slice(0, 1800)\n})))}\nAvoid fabricated statistics, unsupported claims, fake urgency, invented personal experience, invented research effort, or claims such as "I spent months researching". Never imply first-hand work, interviews, experiments, or expertise that did not occur. Every externally verifiable factual assertion in the spoken script must also appear in claims. Use a factual assertion only when the retrieved evidenceText directly supports it; otherwise omit it or explicitly frame the uncertainty. Every claim must cite one or more exact URLs from the Evidence packet in sourceUrls. Do not cite a source only because its title sounds relevant. The conclusion must summarize this specific topic and its remaining uncertainty; never use generic tutorial phrases such as "practical steps", "long-term success", or "journey, not a destination" unless they genuinely fit the topic.\`;`;
  s = replaceOnce(s, oldPrompt, newPrompt, 'evidence-grounded script prompt');

  const helperAnchor = '  parseAIJsonResponse(response) {';
  const helper = `  async verifyEvidenceBeforePersistence(script, strategy) {\n    const review = await this.evidenceDesk.verifyScript({\n      jobId: strategy?.evidencePack?.jobId || null,\n      script,\n      evidencePack: strategy?.evidencePack || { sources: strategy?.researchSources || [] }\n    });\n    script.evidenceReview = review;\n    this.evidenceDesk.assertReview(review);\n    return script;\n  }\n\n`;
  s = insertBefore(s, helperAnchor, helper, 'evidence verification helper');

  const persistenceAnchor = `        normalizedScript.fullScript = this.formatFullScript(normalizedScript);\n        assertValidScript(normalizedScript);\n        await this.db.saveScript(normalizedScript);`;
  const persistenceReplacement = `        normalizedScript.fullScript = this.formatFullScript(normalizedScript);\n        assertValidScript(normalizedScript);\n        await this.verifyEvidenceBeforePersistence(normalizedScript, strategy);\n        await this.db.saveScript(normalizedScript);`;
  s = replaceOnce(s, persistenceAnchor, persistenceReplacement, 'AI script evidence gate before persistence');

  const templatePersistenceAnchor = `      normalizedScript.fullScript = this.formatFullScript(normalizedScript);\n      assertValidScript(normalizedScript);\n      \n      // Save only the canonical script contract.\n      await this.db.saveScript(normalizedScript);`;
  const templatePersistenceReplacement = `      normalizedScript.fullScript = this.formatFullScript(normalizedScript);\n      assertValidScript(normalizedScript);\n      await this.verifyEvidenceBeforePersistence(normalizedScript, strategy);\n      \n      // Save only the canonical, evidence-reviewed script contract.\n      await this.db.saveScript(normalizedScript);`;
  s = replaceOnce(s, templatePersistenceAnchor, templatePersistenceReplacement, 'template script evidence gate before persistence');
  write(rel, s);
}

function patchProvenance() {
  const rel = 'utils/provenance-service.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "    const claims = this.normalizeClaims(production.script?.claims || [], sources, sourceIdByUrl);\n",
    "    const reviewedClaims = production.script?.evidenceReview?.claims;\n    const claims = this.normalizeClaims(Array.isArray(reviewedClaims) ? reviewedClaims : (production.script?.claims || []), sources, sourceIdByUrl);\n",
    'reuse evidence desk decisions in provenance'
  );
  write(rel, s);
}

function patchPackageAndEnv() {
  const rel = 'package.json';
  const pkg = JSON.parse(read(rel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:evidence'] = 'node ../bootstrap/verify-phase5-research-evidence.js';
  write(rel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('EVIDENCE_STRICT_MODE=')) {
    env += `\n# Phase 5 — Research Agent + Evidence Desk\nEVIDENCE_STRICT_MODE=true\nRESEARCH_MAX_SOURCES=12\nRESEARCH_HTTP_TIMEOUT_MS=8000\nEVIDENCE_STANDARD_THRESHOLD=0.24\nEVIDENCE_HIGH_THRESHOLD=0.32\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchIndex();
patchScriptWriter();
patchProvenance();
patchPackageAndEnv();

console.log('Phase 5 research/evidence installed: dedicated research agent, evidence packets, pre-persistence claim gate, audit tables, and evidence API.');
