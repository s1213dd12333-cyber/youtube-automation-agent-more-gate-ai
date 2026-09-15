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
  if (index === -1) throw new Error(`Phase 11.11.2 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}
function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.11.2 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyResolver() {
  write('utils/persistent-character-resolver-v11.js', template('persistent-character-resolver-v11.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(s, "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n", `${template('persistent-character-resolver-db-tables-v11.txt')}\n`, 'Character Resolver tables');
  s = insertBefore(s, '  // Content Strategy methods\n', `${template('persistent-character-resolver-db-methods-v11.txt')}\n`, 'Character Resolver DB methods');
  const loadAnchor = "    const persistentCharacters = await this.listProductionPersistentCharacters(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const persistentCharacterResolutions = await this.listPersistentCharacterResolutions(productionId);\n", 'load character resolutions in production bundle');
  s = replaceOnce(s, "      persistentCharacters,\n", "      persistentCharacters,\n      persistentCharacterResolutions,\n", 'expose character resolutions in production bundle');
  write('database/db.js', s);
}

function patchRegistry() {
  let s = read('utils/persistent-character-registry-v11.js');
  s = replaceOnce(s,
    "const crypto = require('crypto');\n",
    "const crypto = require('crypto');\nconst { PersistentCharacterResolverV11 } = require('./persistent-character-resolver-v11');\n",
    'resolver import');

  s = replaceOnce(s,
    "    accessories: unique(raw.accessories || []),\n    continuityRules: unique(raw.continuityRules || []),\n",
    "    accessories: unique(raw.accessories || []),\n    aliases: unique([\n      ...(Array.isArray(raw.aliases) ? raw.aliases : []),\n      ...(Array.isArray(raw.characterAliases) ? raw.characterAliases : []),\n      ...(Array.isArray(raw.localizedNames) ? raw.localizedNames : []),\n      ...(Array.isArray(raw.nicknames) ? raw.nicknames : [])\n    ]),\n    continuityRules: unique(raw.continuityRules || []),\n",
    'candidate aliases');

  s = replaceOnce(s,
    "    this.namespace = clean(options.namespace || process.env.PERSISTENT_CHARACTER_NAMESPACE || process.env.PERSISTENT_WORLD_OBJECT_NAMESPACE || 'default', 200) || 'default';\n",
    "    this.namespace = clean(options.namespace || process.env.PERSISTENT_CHARACTER_NAMESPACE || process.env.PERSISTENT_WORLD_OBJECT_NAMESPACE || 'default', 200) || 'default';\n    this.characterResolver = options.characterResolver || new PersistentCharacterResolverV11(db, { logger: this.logger });\n",
    'resolver construction');

  const oldLookup = [
    "    let character = await this.db.getPersistentCharacterByFingerprint(this.namespace, identityFingerprint);",
    "    let reused = Boolean(character);",
    "    let matchMode = reused ? 'identity_fingerprint_exact_reuse' : 'identity_fingerprint_exact_register';",
    "",
    "    if (!character && candidate.explicitCharacterKey && typeof this.db.getPersistentCharacterByKey === 'function') {",
    "      const keyed = await this.db.getPersistentCharacterByKey(this.namespace, characterKey);",
    "      if (keyed && keyed.identityFingerprint !== identityFingerprint) {",
    "        this.logger.warn(`Persistent Character v${VERSION}: explicit key ${characterKey} conflicts with canonical identity ${keyed.id}.`);",
    "        return {",
    "          status: 'identity_conflict', character: null, usage: null, reused: false, conflict: true,",
    "          existingCharacter: keyed, candidateFingerprint: identityFingerprint, reason: 'explicit_character_key_identity_conflict'",
    "        };",
    "      }",
    "      if (keyed) { character = keyed; reused = true; matchMode = 'explicit_character_key_exact_reuse'; }",
    "    }"
  ].join('\n');

  const newLookup = [
    "    let character = await this.db.getPersistentCharacterByFingerprint(this.namespace, identityFingerprint);",
    "    let reused = Boolean(character);",
    "    let resolution = null;",
    "    let matchMode = reused ? 'identity_fingerprint_exact_reuse' : 'identity_fingerprint_exact_register';",
    "",
    "    if (!character && this.characterResolver) {",
    "      resolution = await this.characterResolver.resolveCandidate({",
    "        namespace: this.namespace, production, candidate, scopeKey: candidate.sourceBibleId || candidate.sourceRef || 'production',",
    "        referenceText: candidate.displayName, identityFingerprint",
    "      });",
    "      if (resolution?.status === 'ambiguous') {",
    "        return { status: 'ambiguous', character: null, usage: null, reused: false, ambiguous: true, resolution, candidateFingerprint: identityFingerprint, reason: resolution.reason };",
    "      }",
    "      if (resolution?.status === 'conflict') {",
    "        return { status: 'identity_conflict', character: null, usage: null, reused: false, conflict: true, resolution, existingCharacter: resolution.candidates?.[0] || null, candidateFingerprint: identityFingerprint, reason: resolution.reason };",
    "      }",
    "      if (resolution?.character) { character = resolution.character; reused = true; matchMode = resolution.matchMode || 'character_resolver_reuse'; }",
    "    }",
    "",
    "    if (!character && candidate.explicitCharacterKey && typeof this.db.getPersistentCharacterByKey === 'function') {",
    "      const keyed = await this.db.getPersistentCharacterByKey(this.namespace, characterKey);",
    "      if (keyed && keyed.identityFingerprint !== identityFingerprint) {",
    "        this.logger.warn(`Persistent Character v${VERSION}: explicit key ${characterKey} conflicts with canonical identity ${keyed.id}.`);",
    "        return {",
    "          status: 'identity_conflict', character: null, usage: null, reused: false, conflict: true,",
    "          existingCharacter: keyed, candidateFingerprint: identityFingerprint, reason: 'explicit_character_key_identity_conflict'",
    "        };",
    "      }",
    "      if (keyed) { character = keyed; reused = true; matchMode = 'explicit_character_key_exact_reuse'; }",
    "    }"
  ].join('\n');
  s = replaceOnce(s, oldLookup, newLookup, 'resolver lookup before registration');

  const oldPost = [
    "    const usage = await this.db.savePersistentCharacterUsage({",
    "      characterId: character.id:"
  ].join('\n');
  const actualPost = "    const usage = await this.db.savePersistentCharacterUsage({\n      characterId: character.id,";
  const newPost = [
    "    if (this.characterResolver && character) {",
    "      if (reused) {",
    "        await this.characterResolver.ensureAliases(character, candidate, matchMode);",
    "        if (!resolution) await this.characterResolver.persistResolution({",
    "          namespace: this.namespace, production, candidate, scopeKey: candidate.sourceBibleId || candidate.sourceRef || 'production',",
    "          referenceText: candidate.displayName, identityFingerprint",
    "        }, { status: 'resolved', character, candidates: [character], matchMode, confidence: 1,",
    "          referenceKey: candidate.displayName, requestedSpecies: candidate.speciesType, reason: 'identity_fingerprint_exact' });",
    "      } else {",
    "        await this.characterResolver.recordRegistration({",
    "          namespace: this.namespace, production, candidate, scopeKey: candidate.sourceBibleId || candidate.sourceRef || 'production',",
    "          referenceText: candidate.displayName, identityFingerprint",
    "        }, character, candidate);",
    "      }",
    "    }",
    "",
    "    const usage = await this.db.savePersistentCharacterUsage({",
    "      characterId: character.id,"
  ].join('\n');
  s = replaceOnce(s, actualPost, newPost, 'resolver audit and aliases before usage');

  s = replaceOnce(s,
    "    return { status: reused ? 'reused' : 'registered', character, usage, reused, conflict: false, matchMode };\n",
    "    return { status: reused ? 'reused' : 'registered', character, usage, reused, conflict: false, resolution, matchMode };\n",
    'return resolver decision');
  write('utils/persistent-character-registry-v11.js', s);
}

function patchDashboard() {
  let s = read('dashboard/app.js');
  const helper = [
    "function renderPersistentCharacterResolutions(item) {",
    "  if (!Array.isArray(item?.persistentCharacterResolutions) || !item.persistentCharacterResolutions.length) return '';",
    "  const resolved = item.persistentCharacterResolutions.filter(row => ['resolved','registered_new'].includes(row.status)).length;",
    "  const ambiguous = item.persistentCharacterResolutions.filter(row => row.status === 'ambiguous').length;",
    "  const conflicts = item.persistentCharacterResolutions.filter(row => row.status === 'conflict').length;",
    "  const cards = item.persistentCharacterResolutions.slice(0, 60).map(row => {",
    "    const cls = ['resolved','registered_new'].includes(row.status) ? 'pass' : (row.status === 'ambiguous' || row.status === 'conflict' ? 'fail' : '');",
    "    return `<div class=\"quality-check ${cls}\"><strong>${escapeHTML(row.referenceText || row.referenceKey || 'character reference')} · ${escapeHTML(row.status || '')}</strong><br><small>species: ${escapeHTML(row.requestedSpecies || 'character')} · mode: ${escapeHTML(row.matchMode || 'none')}<br>character: ${escapeHTML(row.characterId || 'unresolved')} · confidence ${Math.round(Number(row.confidence || 0) * 100)}%<br>${escapeHTML(row.reason || '')}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel persistent-character-resolver-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">CHARACTER ALIASES + RESOLVER V11.11.2</p><h3>Safe cross-video character name resolution</h3></div></div><p>${resolved} resolved/registered · ${ambiguous} ambiguous · ${conflicts} conflict. Exact keys/aliases win; generic references resolve only with one compatible character.</p><div class=\"quality-grid\">${cards}</div><small>No broad fuzzy merge. Generic contextual references are never auto-promoted into permanent aliases.</small></section>`;",
    "}",
    ""
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Character Resolver dashboard renderer');
  s = replaceOnce(s,
    "        ${renderPersistentCharacters(item)}\n",
    "        ${renderPersistentCharacters(item)}\n        ${renderPersistentCharacterResolutions(item)}\n",
    'show character resolver after registry');
  write('dashboard/app.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:persistent-character-resolver'] = 'node ../bootstrap/verify-phase11-persistent-character-resolver.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  let env = read('.env.example');
  if (!env.includes('PERSISTENT_CHARACTER_RESOLVER_ENABLED=')) env += `\n# Phase 11.11.2 — exact alias + conservative contextual character resolver.\nPERSISTENT_CHARACTER_RESOLVER_ENABLED=true\n# Generic references resolve only when exactly one compatible character exists.\nPERSISTENT_CHARACTER_RESOLVER_ALLOW_CONTEXTUAL_GENERIC=true\n`;
  write('.env.example', env);
}

copyResolver();
patchDatabase();
patchRegistry();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 11.11.2 ativa: Character Aliases + Resolver com exact-match prioritario, contexto unico e ambiguidade fail-closed.');
