'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const upstream = path.resolve(__dirname, '..', 'upstream');
const target = path.join(upstream, 'utils', 'environment-bible-v11.js');
if (!fs.existsSync(target)) throw new Error('Phase 11.7.1 runtime is not materialized: utils/environment-bible-v11.js');

let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

function replaceIfPresent(from, to) {
  if (source.includes(to)) return;
  if (source.includes(from)) source = source.replace(from, to);
}

replaceIfPresent(
  "      signatureElements: ['main seating area', 'wooden table', 'windows', 'shelving or storage'],",
  "      signatureElements: ['main seating area', 'wooden table', 'window', 'shelving or storage'],"
);
replaceIfPresent(
  "    [/\\bwindow\\b|\\bjanela\\b/, 'window']",
  "    [/\\bwindows?\\b|\\bjanelas?\\b/, 'window']"
);

fs.writeFileSync(target, source, 'utf8');
execFileSync(process.execPath, ['--check', target], { stdio: 'inherit' });

const runtime = require(target);
const probe = runtime.buildEnvironment({
  source: 'explicit_instruction',
  text: 'uma casa mobiliada feita em madeira com janelas grandes',
  profile: {
    category: 'house',
    name: 'Probe House',
    defaults: {
      architecturalStyle: 'cozy rustic family home',
      construction: 'natural wood construction',
      palette: ['warm natural brown'],
      lighting: 'warm soft daylight',
      layout: 'stable readable domestic layout',
      materials: ['natural wood'],
      signatureElements: ['window'],
      forbiddenChanges: ['preserve layout']
    }
  }
});
if (!probe.signatureElements.includes('window')) throw new Error('Phase 11.7.1 signature hardening failed to canonicalize janelas/windows to window');

console.log('Phase 11.7.1 Environment Bible signatures hardened: window/janela singular-plural forms canonicalize to window and generated runtime is syntax/semantic checked.');
