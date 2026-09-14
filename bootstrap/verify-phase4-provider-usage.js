'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const gatewayPath = path.join(upstream, 'utils', 'ai-gateway-v4.js');
if (!fs.existsSync(gatewayPath)) throw new Error('Phase 4 gateway is not materialized: utils/ai-gateway-v4.js');

const {
  AIGatewayV4,
  AIUsageService,
  withAIUsageContext,
  classifyError,
  normalizeOpenAIUsage,
  normalizeGeminiUsage,
  rateLimitFromHeaders
} = require(gatewayPath);

const originalEnv = { ...process.env };
const checks = [];
function check(name, fn) {
  checks.push({ name, fn });
}

check('OpenAI-compatible usage is normalized without estimates', () => {
  const usage = normalizeOpenAIUsage({ usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165, completion_tokens_details: { reasoning_tokens: 12 } } });
  assert.deepStrictEqual(usage, { inputTokens: 120, outputTokens: 45, reasoningTokens: 12, totalTokens: 165, reported: true });
});

check('Gemini usageMetadata is normalized', () => {
  const usage = normalizeGeminiUsage({ usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20, thoughtsTokenCount: 5, totalTokenCount: 105 } });
  assert.strictEqual(usage.inputTokens, 80);
  assert.strictEqual(usage.outputTokens, 20);
  assert.strictEqual(usage.reasoningTokens, 5);
  assert.strictEqual(usage.totalTokens, 105);
  assert.strictEqual(usage.reported, true);
});

check('missing provider usage remains explicitly unreported', () => {
  const usage = normalizeOpenAIUsage({});
  assert.strictEqual(usage.totalTokens, 0);
  assert.strictEqual(usage.reported, false);
});

check('rate-limit headers are captured when exposed', () => {
  const headers = new Map([['x-ratelimit-remaining-tokens', '1234'], ['x-ratelimit-limit-tokens', '5000']]);
  headers.get = Map.prototype.get.bind(headers);
  const rate = rateLimitFromHeaders(headers);
  assert.strictEqual(rate.remaining, 1234);
  assert.strictEqual(rate.limit, 5000);
});

check('503 is eligible for provider failover', () => {
  assert.strictEqual(classifyError({ status: 503, message: 'service unavailable' }).failoverEligible, true);
});

check('401 is not silently routed around', () => {
  assert.strictEqual(classifyError({ status: 401, message: 'invalid key' }).failoverEligible, false);
});

check('quota zero opens failover without pretending it is transient capacity', () => {
  const result = classifyError({ status: 429, message: 'RESOURCE_EXHAUSTED quota limit: 0' });
  assert.strictEqual(result.quotaZero, true);
  assert.strictEqual(result.failoverEligible, true);
});

check('auto mode falls back from a transient Groq failure to NVIDIA', async () => {
  process.env.AI_PROVIDER_MODE = 'auto';
  process.env.AI_PROVIDER_ORDER = 'groq,nvidia';
  process.env.GROQ_API_KEY = 'test-groq';
  process.env.NVIDIA_API_KEY = 'test-nvidia';
  const events = [];
  const db = { async saveAIUsageEvent(event) { events.push(event); return `event_${events.length}`; } };
  const usage = new AIUsageService(db, { logger: { warn() {} } });
  const providers = {
    groq: { name: 'GroqCloud', baseURL: 'https://example.invalid/groq', defaultModel: 'groq-test', envKey: 'GROQ_API_KEY' },
    nvidia: { name: 'NVIDIA NIM', baseURL: 'https://example.invalid/nvidia', defaultModel: 'nvidia-test', envKey: 'NVIDIA_API_KEY' }
  };
  const gateway = new AIGatewayV4({}, providers, {}, { usage, logger: { warn() {} } });
  let calls = 0;
  gateway.callOpenAI = async candidate => {
    calls += 1;
    if (candidate.id === 'groq') {
      const error = new Error('temporary upstream outage');
      error.status = 503;
      throw error;
    }
    return {
      text: 'OK', model: candidate.model,
      usage: { inputTokens: 10, outputTokens: 2, reasoningTokens: 0, totalTokens: 12, reported: true },
      rateLimit: { remaining: 90, limit: 100, reset: null }
    };
  };
  const result = await gateway.generateText('test');
  assert.strictEqual(result.provider, 'nvidia');
  assert.strictEqual(result.text, 'OK');
  assert.strictEqual(calls, 2);
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].requestStatus, 'failed');
  assert.strictEqual(events[1].totalTokens, 12);
  gateway.markSuccess('groq');
});

check('auto mode does not hide non-retriable authentication failure', async () => {
  process.env.AI_PROVIDER_MODE = 'auto';
  process.env.AI_PROVIDER_ORDER = 'groq,nvidia';
  process.env.GROQ_API_KEY = 'test-groq';
  process.env.NVIDIA_API_KEY = 'test-nvidia';
  const db = { async saveAIUsageEvent() { return 'event'; } };
  const providers = {
    groq: { name: 'GroqCloud', baseURL: 'https://example.invalid/groq', defaultModel: 'groq-test', envKey: 'GROQ_API_KEY' },
    nvidia: { name: 'NVIDIA NIM', baseURL: 'https://example.invalid/nvidia', defaultModel: 'nvidia-test', envKey: 'NVIDIA_API_KEY' }
  };
  const gateway = new AIGatewayV4({}, providers, {}, { usage: new AIUsageService(db), logger: { warn() {} } });
  let calls = 0;
  gateway.callOpenAI = async () => {
    calls += 1;
    const error = new Error('unauthorized');
    error.status = 401;
    throw error;
  };
  await assert.rejects(() => gateway.generateText('test'), error => error.status === 401);
  assert.strictEqual(calls, 1);
});

check('explicit mode honors the configured provider', () => {
  process.env.AI_PROVIDER_MODE = 'explicit';
  process.env.GROQ_API_KEY = 'env-groq';
  process.env.NVIDIA_API_KEY = 'env-nvidia';
  const providers = {
    groq: { name: 'GroqCloud', baseURL: 'https://example.invalid/groq', defaultModel: 'groq-test', envKey: 'GROQ_API_KEY' },
    nvidia: { name: 'NVIDIA NIM', baseURL: 'https://example.invalid/nvidia', defaultModel: 'nvidia-test', envKey: 'NVIDIA_API_KEY' }
  };
  const gateway = new AIGatewayV4({ aiProvider: { provider: 'nvidia', apiKey: 'selected', model: 'chosen-model' } }, providers);
  const candidates = gateway.availableCandidates();
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].id, 'nvidia');
  assert.strictEqual(candidates[0].model, 'chosen-model');
});

check('usage context attaches generation job and stage centrally', async () => {
  const events = [];
  const service = new AIUsageService({ async saveAIUsageEvent(event) { events.push(event); return 'saved'; } });
  await withAIUsageContext({ jobId: 'job_phase4', stage: 'script' }, () => service.record({ provider: 'groq', totalTokens: 9 }));
  assert.strictEqual(events[0].jobId, 'job_phase4');
  assert.strictEqual(events[0].operation, 'script');
});

check('configured local budget reports remaining tokens', async () => {
  process.env.GROQ_DAILY_TOKEN_BUDGET = '100';
  const service = new AIUsageService({
    async getAIUsageSummary() {
      return {
        totals: { totalTokens: 40, requests: 2, errors: 0 },
        providers: [{ provider: 'groq', totalTokens: 40, requests: 2, errors: 0 }],
        resources: [], recent: []
      };
    }
  });
  const summary = await service.summary(24);
  assert.strictEqual(summary.providers[0].budget, 100);
  assert.strictEqual(summary.providers[0].remaining, 60);
  assert.strictEqual(summary.providers[0].remainingSource, 'local_budget');
});

check('provider-reported remaining quota takes precedence over local budget', async () => {
  process.env.GROQ_DAILY_TOKEN_BUDGET = '100';
  const service = new AIUsageService({
    async getAIUsageSummary() {
      return {
        totals: { totalTokens: 40, requests: 2, errors: 0 },
        providers: [{ provider: 'groq', totalTokens: 40, requests: 2, errors: 0 }],
        resources: [], recent: [{ provider: 'groq', rateLimitRemaining: 17 }]
      };
    }
  });
  const summary = await service.summary(24);
  assert.strictEqual(summary.providers[0].remaining, 17);
  assert.strictEqual(summary.providers[0].remainingSource, 'provider_header');
});

check('materialized database contains AI usage persistence', () => {
  const source = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
  assert(source.includes('CREATE TABLE IF NOT EXISTS ai_usage'));
  assert(source.includes('async saveAIUsageEvent(event = {})'));
  assert(source.includes('async getAIUsageSummary(hours = 24)'));
});

check('AITextService delegates to AIGatewayV4', () => {
  const source = fs.readFileSync(path.join(upstream, 'utils', 'ai-text-service.js'), 'utf8');
  assert(source.includes("const { AIGatewayV4 } = require('./ai-gateway-v4');"));
  assert(source.includes('this.gateway = new AIGatewayV4'));
  assert(source.includes('await this.gateway.generateText'));
});

check('generation stages propagate usage context', () => {
  const source = fs.readFileSync(path.join(upstream, 'index.js'), 'utf8');
  assert(source.includes('withAIUsageContext({ jobId, stage, operation: stage }'));
  assert(source.includes("this.app.get('/api/ai/usage'"));
  assert(source.includes('experiments, aiUsage'));
});

check('scene TTS records resource-specific usage instead of fake tokens', () => {
  const source = fs.readFileSync(path.join(upstream, 'utils', 'scene-narration-v3.js'), 'utf8');
  assert(source.includes("resourceType: 'tts'"));
  assert(source.includes('inputUnits: chunk.length'));
});

check('dashboard exposes the AI Usage & Quota Center', () => {
  const html = fs.readFileSync(path.join(upstream, 'dashboard', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
  assert(html.includes('id="ai-usage-view"'));
  assert(html.includes('AI Usage &amp; Quota Center'));
  assert(app.includes('function renderAIUsage'));
});

(async () => {
  try {
    for (const item of checks) await item.fn();
    console.log(`Phase 4 provider router and usage center OK: ${checks.length} regression checks passed.`);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;
  }
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
