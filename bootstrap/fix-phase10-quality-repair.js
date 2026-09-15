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
  write(rel, source);
}

{
  const rel = 'utils/autonomy-observability-v10.js';
  let source = read(rel);
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
  write(rel, source);
}

console.log('Phase 10 quality repair hardened: completed jobs reopen only for an explicit scoped repair, and default auto-repair cannot trigger media regeneration.');
