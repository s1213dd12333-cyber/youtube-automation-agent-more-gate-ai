'use strict';

const OpenAI = require('openai');
const { AsyncLocalStorage } = require('async_hooks');
const { Logger } = require('./logger');

const usageContext = new AsyncLocalStorage();
const runtime = { db: null, logger: null };
const circuits = new Map();

const DEFAULT_ORDERS = Object.freeze({
  free_first: ['groq', 'gemini', 'nvidia', 'openrouter', 'cerebras', 'openai', 'kimi', 'mimo', 'glm'],
  fastest: ['groq', 'cerebras', 'nvidia', 'gemini', 'openrouter', 'openai', 'kimi', 'glm', 'mimo'],
  quality: ['openai', 'gemini', 'openrouter', 'nvidia', 'groq', 'cerebras', 'kimi', 'glm', 'mimo'],
  balanced: ['groq', 'gemini', 'nvidia', 'openrouter', 'cerebras', 'openai', 'kimi', 'mimo', 'glm']
});

const PROVIDER_ENV_IDS = Object.freeze({
  gemini: 'GEMINI',
  openai: 'OPENAI',
  openrouter: 'OPENROUTER',
  nvidia: 'NVIDIA',
  groq: 'GROQ',
  cerebras: 'CEREBRAS',
  kimi: 'KIMI',
  mimo: 'MIMO',
  glm: 'GLM'
});

function configureAIGatewayRuntime(options = {}) {
  if (options.db) runtime.db = options.db;
  if (options.logger) runtime.logger = options.logger;
  return getAIUsageService();
}

function withAIUsageContext(context = {}, fn) {
  const parent = usageContext.getStore() || {};
  return usageContext.run({ ...parent, ...context }, fn);
}

function getAIUsageContext() {
  return usageContext.getStore() || {};
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function providerEnvId(provider) {
  return PROVIDER_ENV_IDS[String(provider || '').toLowerCase()] || String(provider || 'unknown').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function configuredBudget(provider, resourceType = 'text') {
  const envId = providerEnvId(provider);
  const suffix = resourceType === 'text' ? 'DAILY_TOKEN_BUDGET' : resourceType === 'tts' ? 'DAILY_CHARACTER_BUDGET' : 'DAILY_REQUEST_BUDGET';
  const raw = process.env[`${envId}_${suffix}`] ?? process.env[`AI_${suffix}`];
  const value = nullableNumber(raw);
  return value !== null && value >= 0 ? value : null;
}

function safeHeader(headers, name) {
  if (!headers) return null;
  try {
    if (typeof headers.get === 'function') return headers.get(name);
    return headers[name] ?? headers[name.toLowerCase()] ?? null;
  } catch (_error) {
    return null;
  }
}

function rateLimitFromHeaders(headers) {
  return {
    remaining: nullableNumber(
      safeHeader(headers, 'x-ratelimit-remaining-tokens') ??
      safeHeader(headers, 'x-ratelimit-remaining-requests')
    ),
    limit: nullableNumber(
      safeHeader(headers, 'x-ratelimit-limit-tokens') ??
      safeHeader(headers, 'x-ratelimit-limit-requests')
    ),
    reset: safeHeader(headers, 'x-ratelimit-reset-tokens') ?? safeHeader(headers, 'x-ratelimit-reset-requests') ?? null
  };
}

function normalizeOpenAIUsage(response = {}) {
  const usage = response.usage || {};
  const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens ?? 0;
  return {
    inputTokens: finite(usage.prompt_tokens ?? usage.input_tokens, 0),
    outputTokens: finite(usage.completion_tokens ?? usage.output_tokens, 0),
    reasoningTokens: finite(reasoning, 0),
    totalTokens: finite(usage.total_tokens, finite(usage.prompt_tokens ?? usage.input_tokens, 0) + finite(usage.completion_tokens ?? usage.output_tokens, 0)),
    reported: Boolean(response.usage)
  };
}

function normalizeGeminiUsage(response = {}) {
  const usage = response.usageMetadata || response.usage_metadata || {};
  const input = finite(usage.promptTokenCount ?? usage.prompt_token_count, 0);
  const output = finite(usage.candidatesTokenCount ?? usage.candidates_token_count, 0);
  const reasoning = finite(usage.thoughtsTokenCount ?? usage.thoughts_token_count, 0);
  return {
    inputTokens: input,
    outputTokens: output,
    reasoningTokens: reasoning,
    totalTokens: finite(usage.totalTokenCount ?? usage.total_token_count, input + output + reasoning),
    reported: Boolean(response.usageMetadata || response.usage_metadata)
  };
}

function classifyError(error) {
  const status = finite(error?.status ?? error?.statusCode ?? error?.response?.status, 0);
  const code = String(error?.code || error?.response?.data?.error?.status || '').toUpperCase();
  const message = String(error?.message || error?.response?.data?.error?.message || '').toLowerCase();
  const quotaZero = /(?:quota|limit|remaining)[^\n]{0,120}(?:[:=]\s*)?0\b/.test(message) || /limit\s*:\s*0\b/.test(message);
  const network = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'].includes(code);
  const transient = network || [408, 409, 425, 429].includes(status) || status >= 500;
  return {
    status,
    code: code || (status ? `HTTP_${status}` : 'AI_REQUEST_FAILED'),
    quotaZero,
    transient,
    failoverEligible: quotaZero || transient
  };
}

class AIUsageService {
  constructor(db = null, options = {}) {
    this.db = db;
    this.logger = options.logger || runtime.logger || new Logger('AIUsage');
  }

  setDatabase(db) {
    this.db = db;
  }

  async record(event = {}) {
    if (!this.db?.saveAIUsageEvent) return null;
    const context = { ...getAIUsageContext(), ...(event.context || {}) };
    const payload = {
      jobId: event.jobId ?? context.jobId ?? null,
      productionId: event.productionId ?? context.productionId ?? null,
      provider: String(event.provider || 'unknown').toLowerCase(),
      model: event.model || null,
      operation: event.operation || context.stage || context.operation || 'text',
      resourceType: event.resourceType || 'text',
      inputTokens: finite(event.inputTokens, 0),
      outputTokens: finite(event.outputTokens, 0),
      reasoningTokens: finite(event.reasoningTokens, 0),
      totalTokens: finite(event.totalTokens, 0),
      inputUnits: finite(event.inputUnits, 0),
      outputUnits: finite(event.outputUnits, 0),
      estimatedCost: nullableNumber(event.estimatedCost),
      requestStatus: event.requestStatus || 'succeeded',
      latencyMs: Math.max(0, Math.round(finite(event.latencyMs, 0))),
      rateLimitRemaining: nullableNumber(event.rateLimitRemaining),
      rateLimitLimit: nullableNumber(event.rateLimitLimit),
      rateLimitReset: event.rateLimitReset || null,
      errorCode: event.errorCode || null,
      metadata: event.metadata || {}
    };
    try {
      return await this.db.saveAIUsageEvent(payload);
    } catch (error) {
      this.logger.warn(`AI usage persistence failed: ${error.message}`);
      return null;
    }
  }

  async summary(hours = 24) {
    const periodHours = Math.min(24 * 90, Math.max(1, Math.round(finite(hours, 24))));
    const raw = this.db?.getAIUsageSummary
      ? await this.db.getAIUsageSummary(periodHours)
      : { totals: {}, providers: [], resources: [], recent: [] };
    const warningPercent = Math.min(100, Math.max(1, finite(process.env.AI_BUDGET_WARNING_PERCENT, 80)));
    const criticalPercent = Math.min(100, Math.max(warningPercent, finite(process.env.AI_BUDGET_CRITICAL_PERCENT, 95)));
    const latestByProvider = new Map();
    for (const item of raw.recent || []) {
      if (!latestByProvider.has(item.provider)) latestByProvider.set(item.provider, item);
    }
    const providers = (raw.providers || []).map(item => {
      const budget = configuredBudget(item.provider, 'text');
      const used = finite(item.totalTokens, 0);
      const localRemaining = budget === null ? null : Math.max(0, budget - used);
      const latest = latestByProvider.get(item.provider);
      const reportedRemaining = nullableNumber(latest?.rateLimitRemaining);
      const remaining = reportedRemaining ?? localRemaining;
      const source = reportedRemaining !== null ? 'provider_header' : budget !== null ? 'local_budget' : 'unknown';
      const utilization = budget && budget > 0 ? (used / budget) * 100 : null;
      const level = utilization === null ? 'unknown' : utilization >= criticalPercent ? 'critical' : utilization >= warningPercent ? 'warning' : 'ok';
      return { ...item, budget, remaining, remainingSource: source, utilizationPercent: utilization, budgetLevel: level };
    });
    return {
      periodHours,
      mode: String(process.env.AI_PROVIDER_MODE || 'explicit').toLowerCase(),
      strategy: String(process.env.AI_ROUTER_STRATEGY || 'free_first').toLowerCase(),
      warningPercent,
      criticalPercent,
      totals: raw.totals || {},
      providers,
      resources: raw.resources || [],
      recent: raw.recent || [],
      circuits: getCircuitSnapshot(),
      quotaNote: 'Remaining quota is shown only when a provider returns a usable rate-limit header or a local budget is configured; otherwise it is unknown.'
    };
  }
}

let usageService = null;
function getAIUsageService() {
  if (!usageService) usageService = new AIUsageService(runtime.db, { logger: runtime.logger });
  else if (runtime.db) usageService.setDatabase(runtime.db);
  return usageService;
}

async function recordAIUsage(event = {}) {
  return getAIUsageService().record(event);
}

function getCircuitSnapshot() {
  const now = Date.now();
  return [...circuits.entries()].map(([provider, state]) => ({
    provider,
    failures: state.failures || 0,
    open: Number(state.until || 0) > now,
    until: state.until ? new Date(state.until).toISOString() : null,
    reason: state.reason || null
  }));
}

class AIGatewayV4 {
  constructor(credentials = {}, providers = {}, gemini = {}, options = {}) {
    this.credentials = credentials || {};
    this.providers = providers || {};
    this.geminiModels = gemini.models || [];
    this.geminiDefaultModel = gemini.defaultModel || this.geminiModels[0] || 'gemini-3.7-flash';
    this.logger = options.logger || new Logger('AIGatewayV4');
    this.usage = options.usage || getAIUsageService();
    this.clients = new Map();
  }

  mode(options = {}) {
    if (options.provider) return 'explicit';
    return String(options.mode || process.env.AI_PROVIDER_MODE || 'explicit').toLowerCase() === 'auto' ? 'auto' : 'explicit';
  }

  strategy(options = {}) {
    const value = String(options.strategy || process.env.AI_ROUTER_STRATEGY || 'free_first').toLowerCase();
    return DEFAULT_ORDERS[value] ? value : 'balanced';
  }

  requestModel(candidate, options = {}) {
    // A caller-supplied model is safe only for an explicit provider request. In auto mode,
    // each fallback must use that provider's own configured/default model.
    return this.mode(options) === 'auto' && !options.provider
      ? candidate.model
      : options.model || candidate.model;
  }

  availableCandidates(options = {}) {
    const candidates = [];
    const selected = this.credentials.aiProvider || {};
    for (const [id, preset] of Object.entries(this.providers)) {
      const selectedKey = selected.provider === id ? selected.apiKey : null;
      const apiKey = selectedKey || process.env[preset.envKey];
      if (!apiKey) continue;
      const configuredModel = selected.provider === id ? selected.model : process.env[`${providerEnvId(id)}_AI_MODEL`];
      candidates.push({ id, type: 'openai', name: preset.name || id, apiKey, preset, model: configuredModel || preset.defaultModel });
    }
    const geminiKey = this.credentials.gemini?.apiKey || process.env.GEMINI_API_KEY;
    if (geminiKey) {
      candidates.push({
        id: 'gemini', type: 'gemini', name: 'Google Gemini', apiKey: geminiKey,
        model: this.credentials.gemini?.model || process.env.GEMINI_TEXT_MODEL || this.geminiDefaultModel
      });
    }

    const unique = [];
    const seen = new Set();
    for (const candidate of candidates) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      unique.push(candidate);
    }

    const forced = String(options.provider || '').toLowerCase();
    if (forced) return unique.filter(candidate => candidate.id === forced);

    if (this.mode(options) === 'explicit') {
      if (selected.provider) return unique.filter(candidate => candidate.id === selected.provider).slice(0, 1);
      return unique.slice(0, 1);
    }

    const configuredOrder = String(process.env.AI_PROVIDER_ORDER || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
    const order = configuredOrder.length ? configuredOrder : DEFAULT_ORDERS[this.strategy(options)];
    const rank = new Map(order.map((id, index) => [id, index]));
    return unique.sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
  }

  isAvailable(options = {}) {
    return this.availableCandidates(options).length > 0;
  }

  circuitOpen(provider) {
    const state = circuits.get(provider);
    return Boolean(state && Number(state.until || 0) > Date.now());
  }

  markFailure(provider, classification) {
    const existing = circuits.get(provider) || { failures: 0 };
    const cooldown = classification.quotaZero
      ? Math.max(60_000, finite(process.env.AI_QUOTA_COOLDOWN_MS, 60 * 60 * 1000))
      : Math.max(5_000, finite(process.env.AI_PROVIDER_COOLDOWN_MS, 60 * 1000));
    circuits.set(provider, {
      failures: Number(existing.failures || 0) + 1,
      until: Date.now() + cooldown,
      reason: classification.quotaZero ? 'quota_exhausted' : classification.code
    });
  }

  markSuccess(provider) {
    circuits.delete(provider);
  }

  async generateText(prompt, options = {}) {
    const candidates = this.availableCandidates(options);
    if (!candidates.length) throw this.error('No AI text provider is configured', 'AI_PROVIDER_UNAVAILABLE');
    const auto = this.mode(options) === 'auto';
    const attempts = [];

    for (const candidate of candidates) {
      if (auto && this.circuitOpen(candidate.id)) {
        attempts.push({ provider: candidate.id, status: 'circuit_open' });
        continue;
      }
      const started = Date.now();
      try {
        const result = candidate.type === 'gemini'
          ? await this.callGemini(candidate, prompt, options)
          : await this.callOpenAI(candidate, prompt, options);
        const latencyMs = Date.now() - started;
        this.markSuccess(candidate.id);
        await this.usage.record({
          provider: candidate.id,
          model: result.model || candidate.model,
          operation: options.operation,
          resourceType: 'text',
          ...result.usage,
          requestStatus: 'succeeded',
          latencyMs,
          rateLimitRemaining: result.rateLimit?.remaining,
          rateLimitLimit: result.rateLimit?.limit,
          rateLimitReset: result.rateLimit?.reset,
          metadata: { usageReported: result.usage.reported, routed: auto, strategy: this.strategy(options) }
        });
        return { text: result.text, provider: candidate.id, providerName: candidate.name, model: result.model || candidate.model, usage: result.usage, latencyMs };
      } catch (error) {
        const latencyMs = Date.now() - started;
        const classification = classifyError(error);
        const rateLimit = rateLimitFromHeaders(error?.headers || error?.response?.headers);
        await this.usage.record({
          provider: candidate.id,
          model: candidate.model,
          operation: options.operation,
          resourceType: 'text',
          requestStatus: 'failed',
          latencyMs,
          rateLimitRemaining: rateLimit.remaining,
          rateLimitLimit: rateLimit.limit,
          rateLimitReset: rateLimit.reset,
          errorCode: classification.code,
          metadata: { routed: auto, quotaZero: classification.quotaZero, status: classification.status }
        });
        attempts.push({ provider: candidate.id, code: classification.code, status: classification.status, quotaZero: classification.quotaZero });
        if (!auto || !classification.failoverEligible) throw error;
        this.markFailure(candidate.id, classification);
        this.logger.warn(`AI provider ${candidate.id} failed (${classification.code}); trying next configured provider.`);
      }
    }

    const error = this.error('Every eligible AI text provider is unavailable or cooling down', 'AI_PROVIDER_ROUTING_FAILED');
    error.attempts = attempts;
    throw error;
  }

  async callOpenAI(candidate, prompt, options) {
    let client = this.clients.get(candidate.id);
    if (!client) {
      client = new OpenAI({ apiKey: candidate.apiKey, baseURL: candidate.preset.baseURL });
      this.clients.set(candidate.id, client);
    }
    const model = this.requestModel(candidate, options);
    const maxTokens = Math.max(1, Math.round(finite(options.maxTokens, 2048)));
    const params = { model, messages: [{ role: 'user', content: prompt }], temperature: options.temperature ?? 0.7 };
    const firstBudget = candidate.id === 'nvidia' ? { max_tokens: maxTokens } : { max_completion_tokens: maxTokens };
    let wrapped;
    try {
      wrapped = await this.openAIRequest(client, { ...params, ...firstBudget });
    } catch (error) {
      if (error?.status === 400 && /max(_completion)?_tokens/i.test(error.message || '')) {
        const fallbackBudget = firstBudget.max_tokens ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
        wrapped = await this.openAIRequest(client, { ...params, ...fallbackBudget });
      } else {
        throw error;
      }
    }
    const response = wrapped.data;
    const content = response?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      const choice = response?.choices?.[0] || {};
      const reasoning = choice?.message?.reasoning_content;
      const error = this.error(`${candidate.name} returned an empty response (finish_reason=${choice.finish_reason || 'unknown'}, reasoning_chars=${typeof reasoning === 'string' ? reasoning.length : 0}).`, 'AI_EMPTY_RESPONSE');
      error.status = 502;
      throw error;
    }
    return {
      text: content,
      model,
      usage: normalizeOpenAIUsage(response),
      rateLimit: rateLimitFromHeaders(wrapped.headers)
    };
  }

  async openAIRequest(client, params) {
    const request = client.chat.completions.create(params);
    if (request && typeof request.withResponse === 'function') {
      const wrapped = await request.withResponse();
      return { data: wrapped.data, headers: wrapped.response?.headers || null };
    }
    return { data: await request, headers: null };
  }

  async callGemini(candidate, prompt, options) {
    let client = this.clients.get('gemini');
    if (!client) {
      const { GoogleGenAI } = require('@google/genai');
      client = new GoogleGenAI({ apiKey: candidate.apiKey });
      this.clients.set('gemini', client);
    }
    const model = this.requestModel(candidate, options);
    const config = { maxOutputTokens: Math.max(1, Math.round(finite(options.maxTokens, 2048))) };
    if (!/^gemini-3\.(?:[5-9]|\d{2,})-/.test(model)) config.temperature = options.temperature ?? 0.7;
    const response = await client.models.generateContent({ model, contents: prompt, config });
    const content = response?.text;
    if (typeof content !== 'string' || !content.trim()) {
      const error = this.error('Google Gemini returned an empty response. Check model availability and quota.', 'AI_EMPTY_RESPONSE');
      error.status = 502;
      throw error;
    }
    return { text: content, model, usage: normalizeGeminiUsage(response), rateLimit: {} };
  }

  error(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
}

module.exports = {
  AIGatewayV4,
  AIUsageService,
  configureAIGatewayRuntime,
  withAIUsageContext,
  getAIUsageContext,
  getAIUsageService,
  recordAIUsage,
  classifyError,
  normalizeOpenAIUsage,
  normalizeGeminiUsage,
  rateLimitFromHeaders,
  getCircuitSnapshot,
  DEFAULT_ORDERS
};
