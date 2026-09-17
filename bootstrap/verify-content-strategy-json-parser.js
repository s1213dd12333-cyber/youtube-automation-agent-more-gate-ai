'use strict';

const assert = require('assert');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const { ContentStrategyAgent } = require(path.join(upstream, 'agents', 'content-strategy-agent.js'));

const agent = Object.create(ContentStrategyAgent.prototype);

const cleanArray = agent.parseAIJsonResponse('[{"topic":"A","pillar":"World News"}]');
assert(Array.isArray(cleanArray) && cleanArray.length === 1, 'clean JSON array should parse');

const fencedArray = agent.parseAIJsonResponse('```json\n[{"topic":"B"}]\n```');
assert(Array.isArray(fencedArray) && fencedArray[0].topic === 'B', 'fenced array should parse');

const trailedArray = agent.parseAIJsonResponse('Here is the plan:\n[{"topic":"C"}]\nAdditional explanation that must be ignored.');
assert(Array.isArray(trailedArray) && trailedArray[0].topic === 'C', 'balanced array with surrounding text should parse');

const trailedObject = agent.parseAIJsonResponse('Result: {"topic":"D","contentType":"News"} trailing prose');
assert(trailedObject.topic === 'D', 'balanced object with surrounding text should parse');

const truncated = '[{"topic":"Complete","pillar":"World News"},{"topic":"Incomplete';
const salvaged = agent.parseAIJsonResponse(truncated);
assert(Array.isArray(salvaged), 'truncated array should return an array');
assert.strictEqual(salvaged.length, 1, 'only complete objects should be salvaged');
assert.strictEqual(salvaged[0].topic, 'Complete', 'complete object must be preserved exactly');

let rejected = false;
try { agent.parseAIJsonResponse('not json at all'); } catch (_error) { rejected = true; }
assert(rejected, 'non-JSON response must remain rejected');

console.log('Content strategy JSON parser verification passed.');
