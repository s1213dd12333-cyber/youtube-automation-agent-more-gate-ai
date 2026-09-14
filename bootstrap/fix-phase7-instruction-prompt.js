'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'upstream', 'utils', 'visual-director-v7.js');
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const from = "    `STYLE: ${brief.identity.style}; ${brief.identity.lighting}; ${brief.identity.palette}`,\n    `AVOID: ${(brief.avoid || []).join('; ')}`,\n";
const to = "    `STYLE: ${brief.identity.style}; ${brief.identity.lighting}; ${brief.identity.palette}`,\n    brief.videoInstructions ? `VIDEO DIRECTION: ${brief.videoInstructions}` : 'VIDEO DIRECTION: none',\n    `AVOID: ${(brief.avoid || []).join('; ')}`,\n";

if (!source.includes(to)) {
  if (!source.includes(from)) throw new Error('Phase 7 instruction prompt anchor not found');
  source = source.replace(from, to);
}

fs.writeFileSync(file, source, 'utf8');
console.log('Phase 7 visual prompts preserve Phase 6 per-video direction.');
