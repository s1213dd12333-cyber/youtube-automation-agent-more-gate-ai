'use strict';

const crypto = require('crypto');
const VERSION = '12.10';
const RESERVED = 'RESERVED';
const BLOCKED = 'BLOCKED';

function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function clamp(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function toIso(value) { const d = value instanceof Date ? value : new Date(value); return Number.isFinite(d.getTime()) ? d.toISOString() : null; }
function ceilSlot(date, intervalMinutes) {
  const ms = intervalMinutes * 60 * 1000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}
function defaultPolicy() {
  return { cadenceMinutes: 120, requireQualityCouncilPass: true, breakingPriority: 90, breakingImportance: 85, maxLookaheadSlots: 168, onePublishPerCycle: true };
}
function normalizePolicy(input = {}) {
  const p = { ...defaultPolicy(), ...(input || {}) };
  return {
    cadenceMinutes: Math.round(clamp(p.cadenceMinutes, 30, 1440, 120)),
    requireQualityCouncilPass: p.requireQualityCouncilPass !== false,
    breakingPriority: Math.round(clamp(p.breakingPriority, 50, 100, 90)),
    breakingImportance: Math.round(clamp(p.breakingImportance, 50, 100, 85)),
    maxLookaheadSlots: Math.round(clamp(p.maxLookaheadSlots, 12, 1000, 168)),
    onePublishPerCycle: p.onePublishPerCycle !== false
  };
}
function isBreaking(production = {}, policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const action = String(production.newsroomAction || production.editorialAction || production.action || '').toUpperCase();
  const importance = Number(production.globalImportanceScore || production.importanceScore || production.newsroomImportanceScore || 0);
  return action === 'BREAKING' || Number(production.priority || 0) >= policy.breakingPriority || importance >= policy.breakingImportance;
}

class AutonomousPublishingBrainV1210 {
  constructor(db, options = {}) { this.db = db || null; this.logger = options.logger || { info() {}, warn() {}, error() {} }; this.policyOverride = options.policy || null; }
  getConfig() {
    return {
      version: VERSION,
      enabled: String(process.env.NEWSROOM_PUBLISHING_BRAIN_ENABLED || 'true').toLowerCase() !== 'false',
      policy: normalizePolicy(this.policyOverride || {
        cadenceMinutes: process.env.NEWSROOM_PUBLISH_CADENCE_MINUTES || 120,
        requireQualityCouncilPass: String(process.env.NEWSROOM_PUBLISH_REQUIRE_QUALITY_PASS || 'true').toLowerCase() !== 'false',
        breakingPriority: process.env.NEWSROOM_PUBLISH_BREAKING_PRIORITY || 90,
        breakingImportance: process.env.NEWSROOM_PUBLISH_BREAKING_IMPORTANCE || 85
      })
    };
  }
  async qualityPassed(productionId) {
    const policy = this.getConfig().policy;
    if (!policy.requireQualityCouncilPass || !this.db || !productionId) return true;
    const row = await this.db.getRow("SELECT status FROM newsroom_quality_council_reviews WHERE phase = 'post_production' AND production_id = ? ORDER BY created_at DESC LIMIT 1", [productionId]);
    return row?.status === 'PASS';
  }
  async persistedReservations() {
    if (!this.db) return [];
    const rows = await this.db.getAllRows("SELECT * FROM newsroom_publishing_reservations WHERE status IN ('reserved','scheduled') ORDER BY publish_time ASC", []);
    return rows || [];
  }
  async persistDecision(kind, productionId, payload = {}) {
    if (!this.db) return null;
    const fingerprint = hash(JSON.stringify({ version: VERSION, kind, productionId, payload }));
    const id = `pubdec_${fingerprint.slice(0, 24)}`;
    await this.db.executeQuery('INSERT OR IGNORE INTO newsroom_publishing_decisions (id, engine_version, decision_kind, production_id, payload_json, decision_fingerprint) VALUES (?, ?, ?, ?, ?, ?)', [id, VERSION, kind, productionId || null, JSON.stringify(payload), fingerprint]);
    return id;
  }
  async reserveSlot(production = {}, queue = [], nowInput = new Date()) {
    const config = this.getConfig();
    if (!config.enabled) return { status: RESERVED, publishTime: production.scheduledPublishTime || toIso(nowInput), displacements: [], version: VERSION };
    if (!(await this.qualityPassed(production.id))) {
      const result = { status: BLOCKED, reason: 'quality_council_pass_required', version: VERSION };
      await this.persistDecision('BLOCK', production.id, result);
      return result;
    }
    const policy = config.policy;
    const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
    const persisted = await this.persistedReservations();
    const occupied = new Map();
    for (const item of [...persisted, ...(queue || [])]) {
      const t = toIso(item.publish_time || item.publishTime);
      if (t && item.production_id !== production.id && item.productionId !== production.id && !['failed','published','cancelled'].includes(String(item.status || '').toLowerCase())) occupied.set(t, item);
    }
    const breaking = isBreaking(production, policy);
    let slot = ceilSlot(now, policy.cadenceMinutes);
    const requested = toIso(production.scheduledPublishTime);
    if (!breaking && requested && new Date(requested) > slot) slot = ceilSlot(new Date(requested), policy.cadenceMinutes);
    const displacements = [];
    const intervalMs = policy.cadenceMinutes * 60 * 1000;
    if (breaking && occupied.has(slot.toISOString())) {
      const displaced = occupied.get(slot.toISOString());
      if (!isBreaking(displaced, policy)) {
        let next = new Date(slot.getTime() + intervalMs);
        let hops = 0;
        while (occupied.has(next.toISOString()) && hops++ < policy.maxLookaheadSlots) next = new Date(next.getTime() + intervalMs);
        displacements.push({ id: displaced.id || null, productionId: displaced.productionId || displaced.production_id || null, from: slot.toISOString(), to: next.toISOString() });
        occupied.delete(slot.toISOString()); occupied.set(next.toISOString(), displaced);
      }
    }
    let hops = 0;
    while (occupied.has(slot.toISOString()) && hops++ < policy.maxLookaheadSlots) slot = new Date(slot.getTime() + intervalMs);
    if (hops >= policy.maxLookaheadSlots) return { status: BLOCKED, reason: 'no_slot_available', version: VERSION };
    const publishTime = slot.toISOString();
    const fingerprint = hash(JSON.stringify({ version: VERSION, productionId: production.id, publishTime, breaking, cadenceMinutes: policy.cadenceMinutes }));
    if (this.db) {
      await this.db.executeQuery("INSERT OR REPLACE INTO newsroom_publishing_reservations (id, production_id, publish_time, cadence_minutes, is_breaking, status, reservation_fingerprint) VALUES (?, ?, ?, ?, ?, 'reserved', ?)", [`pubres_${fingerprint.slice(0,24)}`, production.id, publishTime, policy.cadenceMinutes, breaking ? 1 : 0, fingerprint]);
    }
    const result = { status: RESERVED, publishTime, breaking, displacements, cadenceMinutes: policy.cadenceMinutes, version: VERSION };
    await this.persistDecision('RESERVE', production.id, result);
    return result;
  }
  async selectReadyEntries(readyEntries = [], nowInput = new Date()) {
    const config = this.getConfig();
    if (!config.enabled) return readyEntries;
    const ready = [...(readyEntries || [])].sort((a,b) => new Date(a.publishTime) - new Date(b.publishTime));
    if (!ready.length) return [];
    const breaking = ready.find(item => isBreaking(item, config.policy));
    if (breaking) return [breaking];
    if (!this.db) return config.policy.onePublishPerCycle ? ready.slice(0,1) : ready;
    const last = await this.db.getRow("SELECT payload_json FROM newsroom_publishing_decisions WHERE decision_kind = 'PUBLISHED' ORDER BY created_at DESC LIMIT 1", []);
    if (last?.payload_json) {
      try {
        const payload = JSON.parse(last.payload_json);
        const at = new Date(payload.publishedAt || 0);
        if (Number.isFinite(at.getTime()) && (new Date(nowInput).getTime() - at.getTime()) < config.policy.cadenceMinutes * 60 * 1000) return [];
      } catch (_error) {}
    }
    return config.policy.onePublishPerCycle ? ready.slice(0,1) : ready;
  }
  async recordPublished(entry = {}, publishedAt = new Date()) {
    const at = toIso(publishedAt) || new Date().toISOString();
    if (this.db && entry.productionId) {
      await this.db.executeQuery("UPDATE newsroom_publishing_reservations SET status = 'published', published_at = ? WHERE production_id = ?", [at, entry.productionId]);
    }
    await this.persistDecision('PUBLISHED', entry.productionId || null, { scheduleId: entry.id || null, publishedAt: at, publishTime: entry.publishTime || null });
    return { publishedAt: at };
  }
  async listDecisions(limit = 100) { if (!this.db) return []; return this.db.getAllRows('SELECT * FROM newsroom_publishing_decisions ORDER BY created_at DESC LIMIT ?', [Math.max(1, Math.min(500, Number(limit) || 100))]); }
  async status() { const rows = await this.listDecisions(50); return { version: VERSION, enabled: this.getConfig().enabled, policy: this.getConfig().policy, decisions: rows.length, latest: rows[0] || null }; }
}

module.exports = { VERSION, RESERVED, BLOCKED, defaultPolicy, normalizePolicy, isBreaking, ceilSlot, AutonomousPublishingBrainV1210 };
