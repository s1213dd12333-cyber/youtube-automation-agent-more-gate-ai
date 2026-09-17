'use strict';

const assert = require('assert');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const { ContentStrategyAgent } = require(path.join(upstream, 'agents', 'content-strategy-agent.js'));

const agent = Object.create(ContentStrategyAgent.prototype);

const arrayWithTrailingText = '[{"topic":"World news","pillar":"News"}]\nHere is your plan.';
const parsedArray = agent.parseAIJsonResponse(arrayWithTrailingText);
assert(Array.isArray(parsedArray), 'Expected array extraction from response with trailing prose');
assert.strictEqual(parsedArray[0].topic, 'World news');

const fencedObject = '```json\n{"topic":"Global markets","keywords":["markets"]}\n```';
const parsedObject = agent.parseAIJsonResponse(fencedObject);
assert.strictEqual(parsedObject.topic, 'Global markets');

const trailingComma = '[{"topic":"Weather",}] trailing';
const repaired = agent.parseAIJsonResponse(trailingComma);
assert.strictEqual(repaired[0].topic, 'Weather');

let malformedError = null;
try {
  agent.parseAIJsonResponse('[{"topic":"unterminated}');
} catch (error) {
  malformedError = error;
}
assert(malformedError, 'Malformed/truncated JSON must still fail closed');
assert.strictEqual(malformedError.code, 'AI_JSON_PARSE_FAILED');

const methodText = ContentStrategyAgent.prototype.generateAutonomousPlanWithAI.toString();
assert(methodText.includes('AI channel plan JSON retry after malformed response'), 'Missing one-shot malformed JSON retry');
assert(methodText.includes('temperature: 0.1'), 'Strict retry must lower temperature');
assert(methodText.includes('maxTokens: 2600'), 'Strict retry must provide enough bounded output budget');

console.log('ContentStrategy JSON hardening verification passed.');
