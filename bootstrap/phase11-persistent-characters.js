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
  if (index === -1) throw new Error(`Phase 11.11.1 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.11.1 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  write('utils/persistent-character-registry-v11.js', template('persistent-character-registry-v11.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(s, "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n", `${template('persistent-character-db-tables-v11.txt')}\n`, 'Persistent Character tables');
  s = insertBefore(s, '  // Content Strategy methods\n', `${template('persistent-character-db-methods-v11.txt')}\n`, 'Persistent Character DB methods');
  const loadAnchor = "    const persistentWorldObjects = await this.listProductionPersistentWorldObjects(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const persistentCharacters = await this.listProductionPersistentCharacters(productionId);\n", 'load persistent characters in production bundle');
  s = replaceOnce(s, "      persistentWorldObjects,\n", "      persistentWorldObjects,\n      persistentCharacters,\n", 'expose persistent characters in production bundle');
  write('database/db.js', s);
}

function patchScenePipeline() {
  let s = read('utils/scene-pipeline-v2.js');
  s = replaceOnce(
    s,
    "const { CartoonBibleV11 } = require('./cartoon-bible-v11');\n",
    "const { CartoonBibleV11 } = require('./cartoon-bible-v11');\nconst { PersistentCharacterRegistryV11 } = require('./persistent-character-registry-v11');\n",
    'Persistent Character import'
  );
  s = replaceOnce(
    s,
    "    this.cartoonBible = options.cartoonBible || new CartoonBibleV11({ logger: this.logger });\n",
    "    this.cartoonBible = options.cartoonBible || new CartoonBibleV11({ logger: this.logger });\n    this.persistentCharacters = options.persistentCharacters || new PersistentCharacterRegistryV11(db, { logger: this.logger });\n",
    'Persistent Character construction'
  );
  const block = [
    "    let persistentCharacterPlan = null;",
    "    if (cartoonBible?.mode === 'kids_cartoon_2d') {",
    "      persistentCharacterPlan = await this.persistentCharacters.ensureProductionCharacters(production, cartoonBible);",
    "      if (persistentCharacterPlan?.active && persistentCharacterPlan.promptContext) {",
    "        cartoonBible = {",
    "          ...cartoonBible,",
    "          promptContext: `${cartoonBible.promptContext || ''}\\n\\n${persistentCharacterPlan.promptContext}`.trim().slice(0, 30000),",
    "          persistentCharacters: persistentCharacterPlan.characters.map(item => ({",
    "            id: item.character.id,",
    "            characterKey: item.character.characterKey,",
    "            displayName: item.character.displayName,",
    "            sourceCharacterId: item.usage?.sourceCharacterId || null,",
    "            reusedAcrossVideos: item.reused === true",
    "          }))",
    "        };",
    "      }",
    "      if (persistentCharacterPlan?.active) this.logger.info(`Persistent Characters v11.11.1: total=${persistentCharacterPlan.summary.total}, registered=${persistentCharacterPlan.summary.registered}, reused=${persistentCharacterPlan.summary.reused}, conflicts=${persistentCharacterPlan.summary.conflicts}.`);",
    "    }",
    ""
  ].join('\n');
  s = insertBefore(s, "    if (!scenes.length || scriptChanged) {\n", block, 'register persistent characters before visual planning');
  write('utils/scene-pipeline-v2.js', s);
}

function patchDashboard() {
  let s = read('dashboard/app.js');
  const helper = [
    "function renderPersistentCharacters(item) {",
    "  if (!Array.isArray(item?.persistentCharacters) || !item.persistentCharacters.length) return '';",
    "  const reused = item.persistentCharacters.filter(character => character.reusedAcrossVideos === true).length;",
    "  const cards = item.persistentCharacters.map(character => {",
    "    const palette = Array.isArray(character.canonicalIdentity?.palette) ? character.canonicalIdentity.palette.join(' / ') : '';",
    "    return `<div class=\"quality-check pass\"><strong>${escapeHTML(character.displayName || character.characterKey)} · ${character.reusedAcrossVideos ? 'REUSED CROSS-VIDEO' : 'REGISTERED'}</strong><br><small>ID: ${escapeHTML(character.id || '')}<br>${escapeHTML(character.speciesType || 'character')} · ${escapeHTML(palette)}<br>match: ${escapeHTML(character.usage?.matchMode || 'unknown')}<br>identity: ${escapeHTML((character.identityFingerprint || '').slice(0, 16))}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel persistent-characters-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">PERSISTENT CHARACTERS V11.11.1</p><h3>Cross-video canonical character identities</h3></div></div><p>${item.persistentCharacters.length} character binding(s) · ${reused} reused from earlier videos.</p><div class=\"quality-grid\">${cards}</div><small>Expressions, poses, actions, current location and temporary props are excluded from canonical identity. Wardrobe/lifecycle changes are reserved for 11.11.4.</small></section>`;",
    "}",
    ""
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Persistent Character dashboard renderer');
  s = replaceOnce(
    s,
    "        ${renderCartoonBible(item.cartoonBible)}\n",
    "        ${renderCartoonBible(item.cartoonBible)}\n        ${renderPersistentCharacters(item)}\n",
    'show persistent characters after cartoon bible'
  );
  write('dashboard/app.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:persistent-characters'] = 'node ../bootstrap/verify-phase11-persistent-characters.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  let env = read('.env.example');
  if (!env.includes('PERSISTENT_CHARACTERS_ENABLED=')) env += `\n# Phase 11.11.1 — production-independent persistent cartoon character identities.\nPERSISTENT_CHARACTERS_ENABLED=true\n# Use one namespace per channel/story universe when possible.\nPERSISTENT_CHARACTER_NAMESPACE=default\n`;
  write('.env.example', env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 11.11.1 ativa: Persistent Character Registry cross-video com identidade visual canonica separada de pose, emocao e props temporarios.');
