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
  if (index === -1) throw new Error(`Topic duplicate handling anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function copyPolicy() {
  const template = path.join(root, 'bootstrap', 'templates', 'topic-duplicate-policy.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/topic-duplicate-policy.js');
  write('utils/topic-duplicate-policy.js', fs.readFileSync(template, 'utf8'));
}

function patchIndex() {
  const rel = 'index.js';
  let s = read(rel);

  s = replaceOnce(
    s,
    "const { AutonomyObservabilityV10 } = require('./utils/autonomy-observability-v10');\n",
    "const { AutonomyObservabilityV10 } = require('./utils/autonomy-observability-v10');\nconst { shouldEnforceExactTopicNovelty } = require('./utils/topic-duplicate-policy');\n",
    'topic duplicate policy import'
  );

  const from = `    const normalizedSource = input.source || 'manual';\n    if (validation.value.topic && !['retry'].includes(normalizedSource)) {\n      const previous = await this.db.getRow(\n        \`SELECT id, completed_at FROM generation_jobs\n         WHERE lower(trim(topic)) = lower(trim(?))\n         AND status = 'completed'\n         AND created_at >= datetime('now', '-90 days')\n         ORDER BY completed_at DESC LIMIT 1\`,\n        [validation.value.topic]\n      );\n      if (previous) {\n        const error = new Error('This exact topic already completed in the last 90 days. Choose a distinct angle or topic.');\n        error.status = 409;\n        throw error;\n      }\n    }`;

  const to = `    const normalizedSource = input.source || 'manual';\n    if (validation.value.topic && shouldEnforceExactTopicNovelty({ ...input, source: normalizedSource })) {\n      const previous = await this.db.getRow(\n        \`SELECT id, production_id, completed_at FROM generation_jobs\n         WHERE lower(trim(topic)) = lower(trim(?))\n         AND status = 'completed'\n         AND created_at >= datetime('now', '-90 days')\n         ORDER BY completed_at DESC LIMIT 1\`,\n        [validation.value.topic]\n      );\n      if (previous) {\n        const error = new Error('This exact topic already completed in the last 90 days. Automated generation skipped it to avoid duplicate spend.');\n        error.status = 409;\n        error.code = 'EXACT_TOPIC_DUPLICATE';\n        error.details = {\n          topic: validation.value.topic,\n          previousJobId: previous.id,\n          previousProductionId: previous.production_id || null,\n          previousCompletedAt: previous.completed_at || null,\n          source: normalizedSource\n        };\n        throw error;\n      }\n    }`;

  s = replaceOnce(s, from, to, '90-day exact-topic guard policy');
  write(rel, s);
}

function patchPackage() {
  const rel = 'package.json';
  const pkg = JSON.parse(read(rel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:topic-duplicate-policy'] = 'node ../bootstrap/verify-topic-duplicate-handling.js';
  write(rel, `${JSON.stringify(pkg, null, 2)}\n`);
}

copyPolicy();
patchIndex();
patchPackage();

console.log('Topic duplicate handling hardened: manual reruns are allowed, autonomous duplicate spend remains blocked, and automated 409s carry structured metadata.');
