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

console.log('Phase 10 quality repair hardened: completed jobs reopen only for an explicit scoped repair stage.');
