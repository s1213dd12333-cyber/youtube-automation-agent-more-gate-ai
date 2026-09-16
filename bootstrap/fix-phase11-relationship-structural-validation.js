'use strict';

const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const target = path.join(upstream, 'utils', 'relationship-state-graph-v12.js');
let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

function replaceOnce(from, to, label) {
  if (source.includes(to)) return;
  const index = source.indexOf(from);
  if (index === -1) throw new Error(`Phase 11.12.5 structural-validation anchor not found: ${label}`);
  source = source.slice(0, index) + to + source.slice(index + from.length);
}

replaceOnce(
  "    const ep = Math.max(1, Math.floor(Number(episodeNumber || 0) || 0));\n    const memory = await this.db.getSerializedEpisodeMemory(seriesId, ep);\n",
  "    const ep = Math.max(1, Math.floor(Number(episodeNumber || 0) || 0));\n    const source = Array.isArray(updates) ? updates : [updates];\n    if (!source.length) return { status: 'invalid', reason: 'relationship_updates_required' };\n\n    // Reject malformed directed edges before temporal/backfill policy so API errors are deterministic.\n    const edgeKeys = new Set();\n    for (const raw of source) {\n      const sourceKey = slug(raw?.sourceCharacterKey || '');\n      const targetKey = slug(raw?.targetCharacterKey || '');\n      const edgeKey = relationshipKey(sourceKey, targetKey);\n      if (!sourceKey || !targetKey) return { status: 'invalid', reason: 'relationship_endpoints_required' };\n      if (sourceKey === targetKey) return { status: 'invalid', reason: 'relationship_self_edge_forbidden', sourceCharacterKey: sourceKey };\n      if (edgeKeys.has(edgeKey)) return { status: 'conflict', reason: 'duplicate_relationship_edge_in_commit', edgeKey };\n      edgeKeys.add(edgeKey);\n    }\n\n    const memory = await this.db.getSerializedEpisodeMemory(seriesId, ep);\n",
  'structural validation must precede episode/backfill policy'
);

replaceOnce(
  "    const source = Array.isArray(updates) ? updates : [updates];\n    if (!source.length) return { status: 'invalid', reason: 'relationship_updates_required' };\n\n    const edgeKeys = new Set();\n    const prepared = [];\n    for (const raw of source) {\n      const sourceKey = slug(raw?.sourceCharacterKey || '');\n      const targetKey = slug(raw?.targetCharacterKey || '');\n      const edgeKey = relationshipKey(sourceKey, targetKey);\n      if (!sourceKey || !targetKey) return { status: 'invalid', reason: 'relationship_endpoints_required' };\n      if (sourceKey === targetKey) return { status: 'invalid', reason: 'relationship_self_edge_forbidden', sourceCharacterKey: sourceKey };\n      if (edgeKeys.has(edgeKey)) return { status: 'conflict', reason: 'duplicate_relationship_edge_in_commit', edgeKey };\n      edgeKeys.add(edgeKey);\n      const item = await this.prepareUpdate(seriesId, ep, raw);\n",
  "    const prepared = [];\n    for (const raw of source) {\n      const sourceKey = slug(raw?.sourceCharacterKey || '');\n      const targetKey = slug(raw?.targetCharacterKey || '');\n      const edgeKey = relationshipKey(sourceKey, targetKey);\n      const item = await this.prepareUpdate(seriesId, ep, raw);\n",
  'remove duplicate structural validation after temporal policy'
);

fs.writeFileSync(target, source, 'utf8');

if (!source.includes('Reject malformed directed edges before temporal/backfill policy')) {
  throw new Error('Relationship structural prevalidation was not materialized');
}

console.log('Phase 11.12.5 hardening: malformed/self/duplicate directed edges are rejected before episode and backfill policy.');
