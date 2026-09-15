'use strict';

const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const target = path.join(upstream, 'agents', 'publishing-scheduling-agent.js');
let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

function replaceOnce(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`Phase 11.6 made-for-kids anchor not found: ${label}`);
  source = source.replace(from, to);
}

replaceOnce(
  "          containsSyntheticMedia: productionData.containsSyntheticMedia === true,\n",
  "          containsSyntheticMedia: productionData.containsSyntheticMedia === true,\n          madeForKids: gateBundle?.cartoonBible?.mode === 'kids_cartoon_2d',\n",
  'persist explicit kids cartoon audience metadata'
);

replaceOnce(
  "        selfDeclaredMadeForKids: false,\n",
  "        selfDeclaredMadeForKids: metadata.madeForKids === true,\n",
  'map audience metadata to YouTube status'
);

fs.writeFileSync(target, source, 'utf8');
console.log('Phase 11.6 made-for-kids hardening active: kids_cartoon_2d schedules persist audience metadata and YouTube upload uses it instead of hard-coding false.');
