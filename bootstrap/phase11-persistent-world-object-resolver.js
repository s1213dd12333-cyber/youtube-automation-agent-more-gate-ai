'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const file = rel => path.join(upstream, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (rel, value) => fs.writeFileSync(file(rel), value.replace(/\r\n/g, '\n'), 'utf8');
const template = name => fs.readFileSync(path.join(root, 'bootstrap', 'templates', name), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  const index = text.indexOf(from);
  if (index === -1) throw new Error(`Phase 11.10.2 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.10.2 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyResolver() {
  write('utils/persistent-world-object-resolver-v11.js', template('persistent-world-object-resolver-v11.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(s, "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n", `${template('persistent-world-object-resolver-db-tables-v11.txt')}\n`, 'Object Resolver tables');
  s = insertBefore(s, '  // Content Strategy methods\n', `${template('persistent-world-object-resolver-db-methods-v11.txt')}\n`, 'Object Resolver DB methods');
  const loadAnchor = "    const persistentWorldObjects = await this.listProductionPersistentWorldObjects(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const persistentWorldObjectResolutions = await this.listPersistentWorldObjectResolutions(productionId);\n", 'load object resolutions in production bundle');
  s = replaceOnce(s, "      persistentWorldObjects,\n", "      persistentWorldObjects,\n      persistentWorldObjectResolutions,\n", 'expose object resolutions in production bundle');
  write('database/db.js', s);
}

function patchRegistry() {
  let s = read('utils/persistent-world-object-registry-v11.js');
  s = replaceOnce(s,
    "const crypto = require('crypto');\n",
    "const crypto = require('crypto');\nconst { PersistentWorldObjectResolverV11 } = require('./persistent-world-object-resolver-v11');\n",
    'resolver import');

  s = replaceOnce(s,
    "    distinguishingMarks,\n    description: clean(raw.description || raw.sourceEvidence || '', 1600) || null,\n",
    "    distinguishingMarks,\n    aliases: unique([\n      ...(Array.isArray(raw.aliases) ? raw.aliases : []),\n      ...(Array.isArray(raw.objectAliases) ? raw.objectAliases : []),\n      ...(Array.isArray(raw.localizedNames) ? raw.localizedNames : [])\n    ]),\n    description: clean(raw.description || raw.sourceEvidence || '', 1600) || null,\n",
    'candidate aliases');

  s = replaceOnce(s,
    "    this.namespace = clean(options.namespace ?? process.env.PERSISTENT_WORLD_OBJECT_NAMESPACE ?? process.env.REUSABLE_LOCATION_NAMESPACE ?? 'default', 160) || 'default';\n",
    "    this.namespace = clean(options.namespace ?? process.env.PERSISTENT_WORLD_OBJECT_NAMESPACE ?? process.env.REUSABLE_LOCATION_NAMESPACE ?? 'default', 160) || 'default';\n    this.objectResolver = options.objectResolver || new PersistentWorldObjectResolverV11(db, { logger: this.logger });\n",
    'resolver construction');

  const oldLookup = [
    "    let existing = this.db?.getPersistentWorldObjectByFingerprint ? await this.db.getPersistentWorldObjectByFingerprint(this.namespace, fingerprint) : null;",
    "    if (!existing && candidate.explicitObjectKey && this.db?.getPersistentWorldObjectByKey) {",
    "      const keyExisting = await this.db.getPersistentWorldObjectByKey(this.namespace, slug(candidate.explicitObjectKey));",
    "      if (keyExisting && keyExisting.identityFingerprint !== fingerprint) {",
    "        this.logger.warn(`Persistent World Objects v${VERSION}: explicit object key ${candidate.explicitObjectKey} conflicts with existing canonical identity ${keyExisting.id}; refusing silent mutation.`);",
    "        return { status: 'identity_conflict', object: null, usage: null, reused: false, conflict: true, existingObject: keyExisting, candidateFingerprint: fingerprint, reason: 'explicit_object_key_identity_conflict' };",
    "      }",
    "      existing = keyExisting || null;",
    "    }"
  ].join('\n');
  const newLookup = [
    "    let existing = this.db?.getPersistentWorldObjectByFingerprint ? await this.db.getPersistentWorldObjectByFingerprint(this.namespace, fingerprint) : null;",
    "    let resolution = null;",
    "    if (!existing && this.objectResolver) {",
    "      resolution = await this.objectResolver.resolveCandidate({",
    "        namespace: this.namespace, production, candidate: scopedCandidate, locationId: location?.id || null, zoneId: zone?.id || null,",
    "        scopeKey: candidate.environmentId || candidate.sourceRef || location?.id || 'production', referenceText: candidate.displayName, identityFingerprint: fingerprint",
    "      });",
    "      if (resolution?.status === 'ambiguous') {",
    "        return { status: 'ambiguous', object: null, usage: null, reused: false, ambiguous: true, resolution, candidateFingerprint: fingerprint, reason: resolution.reason };",
    "      }",
    "      if (resolution?.status === 'conflict') {",
    "        return { status: 'identity_conflict', object: null, usage: null, reused: false, conflict: true, resolution, existingObject: resolution.candidates?.[0] || null, candidateFingerprint: fingerprint, reason: resolution.reason };",
    "      }",
    "      existing = resolution?.object || null;",
    "    }",
    "    if (!existing && candidate.explicitObjectKey && this.db?.getPersistentWorldObjectByKey) {",
    "      const keyExisting = await this.db.getPersistentWorldObjectByKey(this.namespace, slug(candidate.explicitObjectKey));",
    "      if (keyExisting && keyExisting.identityFingerprint !== fingerprint) {",
    "        this.logger.warn(`Persistent World Objects v${VERSION}: explicit object key ${candidate.explicitObjectKey} conflicts with existing canonical identity ${keyExisting.id}; refusing silent mutation.`);",
    "        return { status: 'identity_conflict', object: null, usage: null, reused: false, conflict: true, existingObject: keyExisting, candidateFingerprint: fingerprint, reason: 'explicit_object_key_identity_conflict' };",
    "      }",
    "      existing = keyExisting || null;",
    "    }"
  ].join('\n');
  s = replaceOnce(s, oldLookup, newLookup, 'resolver lookup before registration');

  s = replaceOnce(s,
    "    const saved = this.db?.savePersistentWorldObject ? await this.db.savePersistentWorldObject(draft) : draft;\n    const scopeKey = candidate.environmentId || zone?.id || location?.id || 'production';\n",
    "    const saved = this.db?.savePersistentWorldObject ? await this.db.savePersistentWorldObject(draft) : draft;\n    const scopeKey = candidate.environmentId || zone?.id || location?.id || 'production';\n    const matchMode = existing ? (resolution?.matchMode || 'identity_fingerprint_exact_reuse') : 'identity_fingerprint_exact_register';\n    if (this.objectResolver && saved) {\n      if (existing) await this.objectResolver.ensureAliases(saved, candidate, matchMode);\n      else await this.objectResolver.recordRegistration({ namespace: this.namespace, production, candidate: scopedCandidate, locationId: location?.id || null, zoneId: zone?.id || null, scopeKey, referenceText: candidate.displayName, identityFingerprint: fingerprint }, saved, candidate);\n    }\n",
    'resolver audit and aliases after save');

  s = replaceOnce(s,
    "      matchMode: existing ? 'identity_fingerprint_exact_reuse' : 'identity_fingerprint_exact_register',\n",
    "      matchMode,\n",
    'usage resolver match mode');
  s = replaceOnce(s,
    "    return { object: saved, usage, reused: Boolean(existing), matchMode: existing ? 'identity_fingerprint_exact_reuse' : 'identity_fingerprint_exact_register' };\n",
    "    return { object: saved, usage, reused: Boolean(existing), resolution, matchMode };\n",
    'return resolver match mode');

  write('utils/persistent-world-object-registry-v11.js', s);
}

function patchDashboard() {
  let s = read('dashboard/app.js');
  const helper = [
    "function renderPersistentWorldObjectResolutions(item) {",
    "  if (!Array.isArray(item?.persistentWorldObjectResolutions) || !item.persistentWorldObjectResolutions.length) return '';",
    "  const resolved = item.persistentWorldObjectResolutions.filter(row => ['resolved','registered_new'].includes(row.status)).length;",
    "  const ambiguous = item.persistentWorldObjectResolutions.filter(row => row.status === 'ambiguous').length;",
    "  const conflicts = item.persistentWorldObjectResolutions.filter(row => row.status === 'conflict').length;",
    "  const cards = item.persistentWorldObjectResolutions.slice(0, 60).map(row => {",
    "    const cls = ['resolved','registered_new'].includes(row.status) ? 'pass' : (row.status === 'ambiguous' || row.status === 'conflict' ? 'fail' : '');",
    "    return `<div class=\"quality-check ${cls}\"><strong>${escapeHTML(row.referenceText || row.referenceKey || 'object reference')} · ${escapeHTML(row.status || '')}</strong><br><small>type: ${escapeHTML(row.requestedType || 'object')} · mode: ${escapeHTML(row.matchMode || 'none')}<br>object: ${escapeHTML(row.objectId || 'unresolved')} · confidence ${Math.round(Number(row.confidence || 0) * 100)}%<br>${escapeHTML(row.reason || '')}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel persistent-world-object-resolver-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">OBJECT ALIASES + RESOLVER V11.10.2</p><h3>Safe narrative object reuse</h3></div></div><p>${resolved} resolved/registered · ${ambiguous} ambiguous · ${conflicts} conflict. Exact aliases win; generic references resolve only when one compatible canonical object remains.</p><div class=\"quality-grid\">${cards}</div><small>No broad fuzzy merge. Canonical attribute mismatches, duplicate aliases and multiple generic candidates fail closed.</small></section>`;",
    "}",
    ""
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Object Resolver dashboard renderer');
  s = replaceOnce(s,
    "        ${renderPersistentWorldObjects(item)}\n        ${renderCartoonShotPlan(item)}\n",
    "        ${renderPersistentWorldObjects(item)}\n        ${renderPersistentWorldObjectResolutions(item)}\n        ${renderCartoonShotPlan(item)}\n",
    'show object resolver after object registry');
  write('dashboard/app.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:persistent-world-object-resolver'] = 'node ../bootstrap/verify-phase11-persistent-world-object-resolver.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  let env = read('.env.example');
  if (!env.includes('PERSISTENT_WORLD_OBJECT_RESOLVER_ENABLED=')) env += `\n# Phase 11.10.2 — exact alias + conservative contextual resolver for persistent objects.\nPERSISTENT_WORLD_OBJECT_RESOLVER_ENABLED=true\n# Generic references such as \"their car\" resolve only when exactly one compatible candidate exists.\nPERSISTENT_WORLD_OBJECT_RESOLVER_ALLOW_CONTEXTUAL_GENERIC=true\n`;
  write('.env.example', env);
}

copyResolver();
patchDatabase();
patchRegistry();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 11.10.2 ativa: aliases persistentes e resolver de objetos com exact-match prioritario, contexto unico para referencias genericas e ambiguidade fail-closed.');
