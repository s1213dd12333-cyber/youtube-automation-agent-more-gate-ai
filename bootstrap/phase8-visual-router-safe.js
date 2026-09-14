'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const target = path.join(__dirname, 'phase8-visual-router.js');
let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const startMarker = '  const helper = `  appendMediaCredits(description, scenes = []) {';
const endMarker = "  s = insertBefore(s, '  async approveContent(productionId, input) {\\n', helper, 'media attribution helper before approval');";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start === -1 || end === -1) throw new Error('Phase 8 attribution bootstrap markers not found');

const safeHelper = [
  "  const helper = [",
  "    \"  appendMediaCredits(description, scenes = []) {\",",
  "    \"    const base = String(description || '').trim();\",",
  "    \"    const seen = new Set();\",",
  "    \"    const credits = [];\",",
  "    \"    for (const scene of scenes || []) {\",",
  "    \"      const asset = scene.sourceAsset;\",",
  "    \"      if (!asset?.sourcePageUrl) continue;\",",
  "    \"      const key = asset.id || asset.sourcePageUrl;\",",
  "    \"      if (seen.has(key)) continue;\",",
  "    \"      seen.add(key);\",",
  "    \"      const parts = [asset.title, asset.creator, asset.license].filter(Boolean).map(value => String(value).replace(/\\\\s+/g, ' ').trim());\",",
  "    \"      const licenseUrl = asset.licenseUrl ? ' · ' + asset.licenseUrl : '';\",",
  "    \"      credits.push(('- ' + parts.join(' — ') + ' · ' + asset.sourcePageUrl + licenseUrl).slice(0, 650));\",",
  "    \"    }\",",
  "    \"    if (!credits.length) return base;\",",
  "    \"    const block = 'Media credits / source assets:\\\\n' + credits.join('\\\\n');\",",
  "    \"    const room = Math.max(0, 5000 - block.length - 2);\",",
  "    \"    return (base.slice(0, room).trim() + '\\\\n\\\\n' + block).trim().slice(0, 5000);\",",
  "    \"  }\",",
  "    \"\"",
  "  ].join('\\n');",
  ""
].join('\n');

source = source.slice(0, start) + safeHelper + source.slice(end);

const compiled = new Module(target, module);
compiled.filename = target;
compiled.paths = Module._nodeModulePaths(path.dirname(target));
compiled._compile(source, target);
