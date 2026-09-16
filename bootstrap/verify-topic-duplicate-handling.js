'use strict';

const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const read = rel => fs.readFileSync(path.join(upstream, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

let checks = 0;
function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(`Topic duplicate policy regression: ${message}`);
}

const policy = require(path.join(upstream, 'utils', 'topic-duplicate-policy.js'));

assert(policy.normalizeGenerationSource() === 'manual', 'missing source must normalize to manual');
assert(policy.normalizeGenerationSource(' MANUAL ') === 'manual', 'source normalization must trim/lowercase');
assert(policy.shouldEnforceExactTopicNovelty({ source: 'manual' }) === false, 'manual generation must allow intentional reruns');
assert(policy.shouldEnforceExactTopicNovelty({ source: 'manual', enforceNovelty: true }) === true, 'manual caller must be able to opt into novelty enforcement');
assert(policy.shouldEnforceExactTopicNovelty({ source: 'scheduler' }) === true, 'scheduler must keep exact-topic duplicate protection');
assert(policy.shouldEnforceExactTopicNovelty({ source: 'autonomous_operator' }) === true, 'autonomous operator must keep exact-topic duplicate protection');
assert(policy.shouldEnforceExactTopicNovelty({ source: 'retry' }) === false, 'retry must bypass exact-topic duplicate protection');
assert(policy.shouldEnforceExactTopicNovelty({ source: 'scheduler', allowDuplicate: true }) === false, 'explicit duplicate override must bypass automated protection');

const index = read('index.js');
assert(index.includes("const { shouldEnforceExactTopicNovelty } = require('./utils/topic-duplicate-policy');"), 'runtime must import the policy helper');
assert(index.includes("const normalizedSource = input.source || 'manual';"), 'startGenerationJob must default unspecified/operator requests to manual');
assert(index.includes('shouldEnforceExactTopicNovelty({ ...input, source: normalizedSource })'), 'startGenerationJob must gate the 90-day query through the source policy');
assert(!index.includes("validation.value.topic && !['retry'].includes(normalizedSource)"), 'legacy all-source exact-topic guard must be removed');
assert(index.includes("error.code = 'EXACT_TOPIC_DUPLICATE';"), 'automated exact duplicates must expose a stable error code');
assert(index.includes('previousJobId: previous.id'), 'duplicate error must expose the prior job identifier');
assert(index.includes('previousProductionId: previous.production_id || null'), 'duplicate error must expose the prior production identifier when available');
assert(index.includes('res.status(error.status || 500).json({ success: false, error: error.message });'), 'generation API must catch startGenerationJob errors instead of letting them escape Express');

const pkg = JSON.parse(read('package.json'));
assert(pkg.scripts?.['test:topic-duplicate-policy'] === 'node ../bootstrap/verify-topic-duplicate-handling.js', 'package must expose the dedicated regression command');

console.log(`Topic duplicate handling verified: ${checks} checks passed.`);
