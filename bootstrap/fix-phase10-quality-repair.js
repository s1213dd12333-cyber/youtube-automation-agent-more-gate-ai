'use strict';

const fs = require('fs');
const path = require('path');
const upstream = path.join(__dirname, '..', 'upstream');

function read(rel) {
  return fs.readFileSync(path.join(upstream, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
function write(rel, value) {
  fs.writeFileSync(path.join(upstream, rel), value, 'utf8');
}
function replaceOnce(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Phase 10 quality-repair anchor not found: ${label}`);
  return source.replace(from, to);
}

{
  const rel = 'index.js';
  let source = read(rel);
  const from = [
    "    if (!['failed', 'interrupted'].includes(job.status)) {",
    "      const error = new Error('Only failed or interrupted generation jobs can be resumed');",
    "      error.status = 409;",
    "      throw error;",
    "    }"
  ].join('\n');
  const to = [
    "    const qualityRepair = job.status === 'completed' && options.qualityRepair === true && Boolean(options.stage);",
    "    if (!['failed', 'interrupted'].includes(job.status) && !qualityRepair) {",
    "      const error = new Error('Only failed or interrupted generation jobs can be resumed, except an explicit Phase 10 quality repair');",
    "      error.status = 409;",
    "      throw error;",
    "    }"
  ].join('\n');
  source = replaceOnce(source, from, to, 'completed job resume guard');
  write(rel, source);
}

{
  const rel = 'utils/autonomous-channel-operator.js';
  let source = read(rel);
  source = replaceOnce(
    source,
    "              job = await this.resumeGenerationJob(job.id, { stage: repair.stage });",
    "              job = await this.resumeGenerationJob(job.id, { stage: repair.stage, qualityRepair: true });",
    'autonomous quality repair flag'
  );

  const summaryFrom = [
    "      const completed = generatedJobs.filter(job => job.status === 'completed');",
    "      const needsReview = completed.filter(job => ['needs_review', 'needs_attention'].includes(job.reviewStatus));",
    "      const failed = generatedJobs.filter(job => job.status !== 'completed');",
    "      const allFailed = completed.length === 0 && failed.length > 0;",
    "      const status = allFailed ? 'failed' : needsReview.length ? 'waiting_review' : failed.length ? 'completed_with_issues' : 'completed';",
    "      const summary = {",
    "        planned: plan.length,",
    "        generated: completed.length,",
    "        needsReview: needsReview.length,",
    "        failed: failed.length",
    "      };"
  ].join('\n');
  const summaryTo = [
    "      const completed = generatedJobs.filter(job => job.status === 'completed');",
    "      for (const record of completed) {",
    "        if (!record.productionId || !this.observability) continue;",
    "        const publication = await this.observability.publicationState(record.productionId);",
    "        record.scheduleStatus = publication.scheduleStatus || null;",
    "        record.publicationBlockers = publication.blockers || [];",
    "      }",
    "      const needsReview = completed.filter(job => ['needs_review', 'needs_attention'].includes(job.reviewStatus));",
    "      const publicationIssues = completed.filter(job => job.reviewStatus === 'approved' && ((job.publicationBlockers || []).length > 0 || !['scheduled', 'paused', 'uploaded', 'published'].includes(job.scheduleStatus)));",
    "      const failed = generatedJobs.filter(job => job.status !== 'completed');",
    "      const allFailed = completed.length === 0 && failed.length > 0;",
    "      const status = allFailed ? 'failed' : needsReview.length ? 'waiting_review' : (publicationIssues.length || failed.length) ? 'completed_with_issues' : 'completed';",
    "      const summary = {",
    "        planned: plan.length,",
    "        generated: completed.length,",
    "        needsReview: needsReview.length,",
    "        publicationIssues: publicationIssues.length,",
    "        failed: failed.length",
    "      };"
  ].join('\n');
  source = replaceOnce(source, summaryFrom, summaryTo, 'operator completion publication state');

  source = replaceOnce(
    source,
    "      record.qualityStatus = bundle.qualityAgentReport?.status || null;",
    "      record.qualityStatus = bundle.qualityAgentReport?.status || null;\n      const publication = this.observability ? await this.observability.publicationState(record.productionId) : null;\n      record.publicationBlockers = publication?.blockers || [];",
    'operator reconciliation blocker refresh'
  );

  const reconcileFrom = [
    "    const completed = generatedJobs.filter(item => item.status === 'completed');",
    "    const waiting = completed.filter(item => ['needs_review', 'needs_attention'].includes(item.reviewStatus));",
    "    const failed = generatedJobs.filter(item => item.status !== 'completed');",
    "    const status = waiting.length ? 'waiting_review' : failed.length ? 'completed_with_issues' : 'completed';",
    "    const updated = await this.update(runId, {",
    "      status, stage: waiting.length ? 'waiting_for_review' : 'complete', progress: 100, generatedJobs,",
    "      summary: { planned: generatedJobs.length, generated: completed.length, needsReview: waiting.length, failed: failed.length },"
  ].join('\n');
  const reconcileTo = [
    "    const completed = generatedJobs.filter(item => item.status === 'completed');",
    "    const waiting = completed.filter(item => ['needs_review', 'needs_attention'].includes(item.reviewStatus));",
    "    const publicationIssues = completed.filter(item => item.reviewStatus === 'approved' && ((item.publicationBlockers || []).length > 0 || !['scheduled', 'paused', 'uploaded', 'published'].includes(item.scheduleStatus)));",
    "    const failed = generatedJobs.filter(item => item.status !== 'completed');",
    "    const status = waiting.length ? 'waiting_review' : (publicationIssues.length || failed.length) ? 'completed_with_issues' : 'completed';",
    "    const updated = await this.update(runId, {",
    "      status, stage: waiting.length ? 'waiting_for_review' : (publicationIssues.length ? 'publication_attention' : 'complete'), progress: 100, generatedJobs,",
    "      summary: { planned: generatedJobs.length, generated: completed.length, needsReview: waiting.length, publicationIssues: publicationIssues.length, failed: failed.length },"
  ].join('\n');
  source = replaceOnce(source, reconcileFrom, reconcileTo, 'operator reconciliation publication state');
  write(rel, source);
}

{
  const rel = 'utils/autonomy-observability-v10.js';
  let source = read(rel);
  source = replaceOnce(
    source,
    "  if (bundle.qualityAgentReport?.status === 'blocked') blockers.push('quality_agents');",
    "  if (!bundle.qualityAgentReport || bundle.qualityAgentReport.status === 'blocked') blockers.push('quality_agents');",
    'publication requires Phase 9 report'
  );
  const from = [
    "  // Text-only repairs are allowed automatically. Media regeneration can consume image/video credits and stays manual.",
    "  if (has(/^seo_/) || agents.has('seo')) return { automatic: true, stage: 'seo', reason: 'text_only_seo_repair' };",
    "  if (has(/^retention_/) || has(/^fact_/) || agents.has('retention') || agents.has('fact')) {",
    "    return { automatic: true, stage: 'script', reason: 'text_only_script_repair' };",
    "  }",
    "  if (has(/^visual_missing/) || has(/^visual_stale/)) return { automatic: true, stage: 'production', reason: 'resume_missing_media_only' };",
    "  if (has(/^thumbnail_/) || agents.has('thumbnail')) return { automatic: false, stage: 'thumbnail', reason: 'media_cost_confirmation_required' };",
    "  if (has(/^visual_/) || agents.has('visual')) return { automatic: false, stage: 'production', reason: 'visual_cost_or_rights_review_required' };"
  ].join('\n');
  const to = [
    "  // Only an SEO-only retry is automatic by default. Script/media changes can cascade into paid regeneration.",
    "  if (has(/^seo_/) || agents.has('seo')) return { automatic: true, stage: 'seo', reason: 'seo_only_repair_reuses_media' };",
    "  if (has(/^retention_/) || has(/^fact_/) || agents.has('retention') || agents.has('fact')) {",
    "    return { automatic: false, stage: 'script', reason: 'script_change_requires_media_regeneration' };",
    "  }",
    "  if (has(/^visual_missing/) || has(/^visual_stale/)) return { automatic: false, stage: 'production', reason: 'media_cost_confirmation_required' };",
    "  if (has(/^thumbnail_/) || agents.has('thumbnail')) return { automatic: false, stage: 'thumbnail', reason: 'media_cost_confirmation_required' };",
    "  if (has(/^visual_/) || agents.has('visual')) return { automatic: false, stage: 'production', reason: 'visual_cost_or_rights_review_required' };"
  ].join('\n');
  source = replaceOnce(source, from, to, 'automatic repair cost policy');

  source = replaceOnce(
    source,
    "       SUM(COALESCE(estimated_cost, 0)) AS estimated_cost, AVG(latency_ms) AS avg_latency_ms",
    "       SUM(estimated_cost) AS estimated_cost, SUM(CASE WHEN estimated_cost IS NOT NULL THEN 1 ELSE 0 END) AS cost_reports, AVG(latency_ms) AS avg_latency_ms",
    'per-production total cost evidence count'
  );
  source = replaceOnce(
    source,
    "       SUM(COALESCE(estimated_cost, 0)) AS estimated_cost\n       FROM ai_usage WHERE ${where} GROUP BY provider, resource_type ORDER BY requests DESC`,",
    "       SUM(estimated_cost) AS estimated_cost, SUM(CASE WHEN estimated_cost IS NOT NULL THEN 1 ELSE 0 END) AS cost_reports\n       FROM ai_usage WHERE ${where} GROUP BY provider, resource_type ORDER BY requests DESC`,",
    'per-provider cost evidence count'
  );
  source = replaceOnce(
    source,
    "        estimatedCost: Number(totals?.estimated_cost || 0), avgLatencyMs: Math.round(Number(totals?.avg_latency_ms || 0))",
    "        costReports: Number(totals?.cost_reports || 0), estimatedCost: Number(totals?.cost_reports || 0) > 0 ? Number(totals.estimated_cost || 0) : null, avgLatencyMs: Math.round(Number(totals?.avg_latency_ms || 0))",
    'unknown total estimated cost stays null'
  );
  source = replaceOnce(
    source,
    "        outputUnits: Number(row.output_units || 0), estimatedCost: Number(row.estimated_cost || 0)",
    "        outputUnits: Number(row.output_units || 0), costReports: Number(row.cost_reports || 0), estimatedCost: Number(row.cost_reports || 0) > 0 ? Number(row.estimated_cost || 0) : null",
    'unknown provider estimated cost stays null'
  );
  write(rel, source);
}

{
  const rel = 'database/db.js';
  let source = read(rel);
  source = replaceOnce(
    source,
    "       SUM(COALESCE(estimated_cost, 0)) AS estimated_cost, AVG(latency_ms) AS avg_latency_ms",
    "       SUM(estimated_cost) AS estimated_cost, SUM(CASE WHEN estimated_cost IS NOT NULL THEN 1 ELSE 0 END) AS cost_reports, AVG(latency_ms) AS avg_latency_ms",
    'global AI usage total cost evidence count'
  );
  source = replaceOnce(
    source,
    "       SUM(input_units) AS input_units, SUM(output_units) AS output_units, AVG(latency_ms) AS avg_latency_ms",
    "       SUM(input_units) AS input_units, SUM(output_units) AS output_units, SUM(estimated_cost) AS estimated_cost, SUM(CASE WHEN estimated_cost IS NOT NULL THEN 1 ELSE 0 END) AS cost_reports, AVG(latency_ms) AS avg_latency_ms",
    'global AI usage provider cost evidence count'
  );
  source = replaceOnce(
    source,
    "      estimatedCost: Number(row?.estimated_cost || 0), avgLatencyMs: Math.round(Number(row?.avg_latency_ms || 0))",
    "      costReports: Number(row?.cost_reports || 0), estimatedCost: Number(row?.cost_reports || 0) > 0 ? Number(row.estimated_cost || 0) : null, avgLatencyMs: Math.round(Number(row?.avg_latency_ms || 0))",
    'global unknown estimated cost stays null'
  );
  write(rel, source);
}

{
  const rel = 'agents/publishing-scheduling-agent.js';
  let source = read(rel);
  const from = [
    "        if (gateBundle.qualityAgentReport?.status === 'blocked') {",
    "          const error = new Error('Scheduling is blocked by Phase 9 Quality Agents');",
    "          error.status = 409; error.code = 'QUALITY_BLOCKED'; throw error;",
    "        }"
  ].join('\n');
  const to = [
    "        if (!gateBundle.qualityAgentReport || gateBundle.qualityAgentReport.status === 'blocked') {",
    "          const error = new Error(gateBundle.qualityAgentReport ? 'Scheduling is blocked by Phase 9 Quality Agents' : 'Scheduling requires a Phase 9 Quality Agents report');",
    "          error.status = 409; error.code = gateBundle.qualityAgentReport ? 'QUALITY_BLOCKED' : 'QUALITY_REPORT_REQUIRED'; throw error;",
    "        }"
  ].join('\n');
  source = replaceOnce(source, from, to, 'scheduling requires Quality Agents report');

  const publishFrom = [
    "        if (productionBundle?.qualityAgentReport?.status === 'blocked') {",
    "          const error = new Error('Publishing is blocked by Phase 9 Quality Agents');",
    "          error.status = 409; error.code = 'QUALITY_BLOCKED'; throw error;",
    "        }"
  ].join('\n');
  const publishTo = [
    "        if (productionBundle && (!productionBundle.qualityAgentReport || productionBundle.qualityAgentReport.status === 'blocked')) {",
    "          const error = new Error(productionBundle.qualityAgentReport ? 'Publishing is blocked by Phase 9 Quality Agents' : 'Publishing requires a Phase 9 Quality Agents report');",
    "          error.status = 409; error.code = productionBundle.qualityAgentReport ? 'QUALITY_BLOCKED' : 'QUALITY_REPORT_REQUIRED'; throw error;",
    "        }"
  ].join('\n');
  source = replaceOnce(source, publishFrom, publishTo, 'publishing requires Quality Agents report');
  write(rel, source);
}

console.log('Phase 10 hardened: scoped quality repair, cost-safe defaults, blocker-aware completion, honest global/per-video cost evidence, and mandatory Phase 9 review before schedule/upload.');
