'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const contractsPath = path.join(upstream, 'utils', 'content-contracts.js');
if (!fs.existsSync(contractsPath)) {
  throw new Error('utils/content-contracts.js is missing. Run materialize.ps1 first.');
}

const {
  CONTRACT_VERSION,
  CONTRACT_SCHEMAS,
  ContentContractError,
  normalizeStrategy,
  normalizeScript,
  validateStrategy,
  validateScript,
  assertValidStrategy,
  assertValidScript,
  normalizeGenerationArtifact
} = require(contractsPath);

function testStrategyNormalization() {
  const strategy = normalizeStrategy({
    topic: '  Why Time Moves Differently  ',
    contentType: 'explainer',
    keywords: 'relativity, time, relativity',
    requestedLengthKey: 'MEDIUM',
    researchSources: [
      { url: 'https://example.org/paper', title: 'Paper', publisher: 'Example' },
      { url: 'https://example.org/paper', title: 'Duplicate' },
      { url: 'not-a-url', title: 'Invalid' }
    ]
  });

  assert.strictEqual(strategy.contractVersion, CONTRACT_VERSION);
  assert.strictEqual(strategy.topic, 'Why Time Moves Differently');
  assert.strictEqual(strategy.contentType, 'Explainer');
  assert.deepStrictEqual(strategy.keywords, ['relativity', 'time']);
  assert.strictEqual(strategy.requestedLengthKey, 'medium');
  assert.strictEqual(strategy.requestedLength, '8-12 minutes');
  assert.strictEqual(strategy.researchSources.length, 1);
  assert.strictEqual(validateStrategy(strategy).valid, true);
  assert.strictEqual(assertValidStrategy(strategy), strategy);
}

function testLegacyScriptRepair() {
  const script = normalizeScript({
    title: '  Time Is Not the Same Everywhere  ',
    hook: 'Two clocks can disagree without either one being broken.',
    introduction: 'This video explains why altitude changes elapsed time.',
    mainContent: {
      sections: [
        {
          title: 'Atomic clocks',
          content: 'Precision clocks can measure tiny differences in elapsed time.',
          duration: '75'
        },
        {
          title: 'Measured effects',
          points: ['Gravity affects elapsed time.', 'Velocity also affects elapsed time.'],
          duration: 80
        }
      ]
    },
    conclusion: {
      keyPoints: ['Time depends on gravity and motion.'],
      summary: 'Relativity predicts measurable differences in elapsed time.',
      finalThought: 'Modern clocks make those differences observable.'
    },
    cta: 'Subscribe for more science explainers.',
    claims: [
      { claim: 'Atomic clocks can measure relativistic time differences.', sourceUrls: ['https://example.org/paper'] }
    ],
    keywords: ['time', 'relativity']
  });

  assert.strictEqual(script.contractVersion, CONTRACT_VERSION);
  assert.strictEqual(script.title, 'Time Is Not the Same Everywhere');
  assert.strictEqual(script.hook.text, 'Two clocks can disagree without either one being broken.');
  assert.strictEqual(script.mainContent.sections.length, 2);
  assert.deepStrictEqual(script.mainContent.sections[0].content, [
    'Precision clocks can measure tiny differences in elapsed time.'
  ]);
  assert.deepStrictEqual(script.mainContent.sections[1].content, [
    'Gravity affects elapsed time.',
    'Velocity also affects elapsed time.'
  ]);
  assert.deepStrictEqual(script.conclusion.recap, ['Time depends on gravity and motion.']);
  assert.deepStrictEqual(script.conclusion.keyPoints, ['Time depends on gravity and motion.']);
  assert.strictEqual(script.callToAction.subscribe, 'Subscribe for more science explainers.');
  assert.strictEqual(script.claims[0].text, 'Atomic clocks can measure relativistic time differences.');
  assert.strictEqual(validateScript(script).valid, true);
  assert.strictEqual(assertValidScript(script), script);
}

function testAlternateModelShapeRepair() {
  const script = normalizeScript({
    title: 'Alternate Shape',
    hook: { content: 'A valid hook from a different model shape.' },
    sections: [
      {
        description: 'A section supplied at the top level instead of mainContent.sections.',
        duration: null
      }
    ],
    conclusion: {
      summary: 'A summary-only conclusion should be promoted into recap and keyPoints.'
    },
    callToAction: { text: 'Subscribe.' }
  });

  assert.strictEqual(script.mainContent.sections.length, 1);
  assert.strictEqual(script.mainContent.sections[0].title, 'Section 1');
  assert.strictEqual(script.mainContent.sections[0].duration, 60);
  assert.deepStrictEqual(script.conclusion.recap, [
    'A summary-only conclusion should be promoted into recap and keyPoints.'
  ]);
  assert.deepStrictEqual(script.conclusion.keyPoints, script.conclusion.recap);
  assert.strictEqual(validateScript(script).valid, true);
}

function testInvalidScriptFailsClosed() {
  const invalid = normalizeScript({
    title: '',
    hook: '',
    mainContent: { sections: [] },
    conclusion: {}
  });
  const result = validateScript(invalid);
  assert.strictEqual(result.valid, false);
  assert(result.issues.some(issue => issue.includes('title')));
  assert(result.issues.some(issue => issue.includes('hook.text')));
  assert(result.issues.some(issue => issue.includes('mainContent.sections')));

  assert.throws(
    () => assertValidScript(invalid),
    error => error instanceof ContentContractError && error.code === 'CONTENT_CONTRACT_INVALID'
  );
}

function testStageBoundary() {
  const normalized = normalizeGenerationArtifact('strategy', {
    topic: 'Boundary test',
    contentType: 'story'
  });
  assert.strictEqual(normalized.contentType, 'Story');
  assert.deepStrictEqual(normalized.keywords, []);
  assert.deepStrictEqual(normalized.researchSources, []);

  const thumbnail = { path: 'unchanged.png' };
  assert.strictEqual(normalizeGenerationArtifact('thumbnail', thumbnail), thumbnail);
}

function testSchemasPublished() {
  assert.strictEqual(CONTRACT_SCHEMAS.strategy.$id, 'lumen.strategy.v1');
  assert.strictEqual(CONTRACT_SCHEMAS.script.$id, 'lumen.script.v1');
  assert(CONTRACT_SCHEMAS.script.required.includes('conclusion'));
}

function testIntegrationMarkers() {
  const recovery = fs.readFileSync(path.join(upstream, 'utils', 'generation-recovery-service.js'), 'utf8');
  const index = fs.readFileSync(path.join(upstream, 'index.js'), 'utf8');
  const writer = fs.readFileSync(path.join(upstream, 'agents', 'script-writer-agent.js'), 'utf8');
  const strategy = fs.readFileSync(path.join(upstream, 'agents', 'content-strategy-agent.js'), 'utf8');

  assert(recovery.includes('normalizeGenerationArtifact(stage, await producer())'));
  assert(recovery.includes('validateGenerationArtifact(stage, artifact).valid'));
  assert(index.includes("normalizeGenerationArtifact(stage, await producer())"));
  assert(writer.includes('normalizeScript(aiScript, strategy)'));
  assert(strategy.includes('normalizeStrategy(aiStrategy)'));
}

const tests = [
  testStrategyNormalization,
  testLegacyScriptRepair,
  testAlternateModelShapeRepair,
  testInvalidScriptFailsClosed,
  testStageBoundary,
  testSchemasPublished,
  testIntegrationMarkers
];

for (const test of tests) test();

console.log(`Phase 1 content contracts OK: ${tests.length} regression checks passed.`);
