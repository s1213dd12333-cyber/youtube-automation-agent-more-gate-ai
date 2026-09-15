'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const upstream = path.resolve(__dirname, '..', 'upstream');
const target = path.join(upstream, 'utils', 'prop-lock-v11.js');
if (!fs.existsSync(target)) throw new Error('Phase 11.7.2 runtime is not materialized: utils/prop-lock-v11.js');
let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

function replaceOnce(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`Phase 11.7.2 hardening anchor not found: ${label}`);
  source = source.replace(from, to);
}

// Self-heal runtimes produced by the original 11.7.2 hardener, where `\n`
// inside a template literal became a literal line break inside the generated RegExp.
const brokenClauseRegex = "  const clauses = source.split(/[,;|" + "\n" + "]+/).map(value => value.trim()).filter(Boolean);";
const fixedClauseRegex = "  const clauses = source.split(/[,;|\\n]+/).map(value => value.trim()).filter(Boolean);";
if (source.includes(brokenClauseRegex)) source = source.replace(brokenClauseRegex, fixedClauseRegex);

replaceOnce(
`function definitionFor(value) {
  const text = clean(value, 240);
  return PROP_DEFINITIONS.find(definition => definition.pattern.test(text)) || null;
}
`,
`function definitionFor(value) {
  const text = clean(value, 240);
  const matches = PROP_DEFINITIONS
    .map(definition => ({ definition, match: text.match(definition.pattern) }))
    .filter(item => item.match);
  if (!matches.length) return null;
  matches.sort((a, b) =>
    String(b.match[0] || '').length - String(a.match[0] || '').length ||
    String(b.definition.name || '').length - String(a.definition.name || '').length
  );
  return matches[0].definition;
}
`,
  'prefer the most specific overlapping prop definition'
);

replaceOnce(
`function nearbyWindow(text, definition, rawName) {
  const source = String(text || '');
  let match = definition ? source.match(definition.pattern) : null;
  if (!match && rawName) {
    const needle = clean(rawName, 120);
    const index = source.toLowerCase().indexOf(needle.toLowerCase());
    if (index >= 0) return source.slice(Math.max(0, index - 80), Math.min(source.length, index + needle.length + 100));
  }
  if (!match || typeof match.index !== 'number') return '';
  return source.slice(Math.max(0, match.index - 80), Math.min(source.length, match.index + match[0].length + 100));
}
`,
`function nearbyWindow(text, definition, rawName) {
  const source = String(text || '');
  const clauses = source.split(/[,;|\\n]+/).map(value => value.trim()).filter(Boolean);
  if (definition) {
    const clause = clauses.find(value => definition.pattern.test(value));
    if (clause) return clause.slice(0, 260);
  }
  if (rawName) {
    const needle = clean(rawName, 120).toLowerCase();
    const clause = clauses.find(value => value.toLowerCase().includes(needle));
    if (clause) return clause.slice(0, 260);
  }
  const match = definition ? source.match(definition.pattern) : null;
  if (!match || typeof match.index !== 'number') return '';
  return source.slice(Math.max(0, match.index - 24), Math.min(source.length, match.index + match[0].length + 48));
}
`,
  'scope prop attributes to the prop clause'
);

replaceOnce(
`  const color = detectColor(localEvidence);
  const material = detectMaterial(localEvidence, environment, definition);
  const lockedAttributes = {
    identity: name,
    type,
    color,
    material,
`,
`  const color = detectColor(localEvidence);
  const directMaterial = MATERIALS.find(([, pattern]) => pattern.test(localEvidence))?.[0] || null;
  const material = directMaterial || detectMaterial('', environment, definition);
  const lockedAttributes = {
    identity: name,
    type,
    color,
    colorSource: color ? sourceType : null,
    material,
    materialSource: directMaterial ? sourceType : (material ? 'environment_material_inference' : null),
`,
  'record truthful color/material provenance'
);

fs.writeFileSync(target, source, 'utf8');
execFileSync(process.execPath, ['--check', target], { stdio: 'inherit' });
execFileSync(process.execPath, ['-e', `const p=require(${JSON.stringify(target)}); if(p.canonicalName('flower bed')!=='flower bed') process.exit(2); if(p.canonicalName('coffee table')!=='coffee table') process.exit(3);`], { stdio: 'inherit' });
console.log('Phase 11.7.2 Prop Lock attributes hardened: specific prop definitions win overlaps, per-prop clause scoping prevents cross-prop color bleed, material provenance is recorded, and the generated runtime is syntax/semantic checked.');
