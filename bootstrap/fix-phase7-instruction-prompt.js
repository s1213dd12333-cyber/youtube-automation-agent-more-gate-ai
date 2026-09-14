'use strict';

const fs = require('fs');
const path = require('path');

const upstream = path.join(__dirname, '..', 'upstream');

{
  const file = path.join(upstream, 'utils', 'visual-director-v7.js');
  let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const from = "    `STYLE: ${brief.identity.style}; ${brief.identity.lighting}; ${brief.identity.palette}`,\n    `AVOID: ${(brief.avoid || []).join('; ')}`,\n";
  const to = "    `STYLE: ${brief.identity.style}; ${brief.identity.lighting}; ${brief.identity.palette}`,\n    brief.videoInstructions ? `VIDEO DIRECTION: ${brief.videoInstructions}` : 'VIDEO DIRECTION: none',\n    `AVOID: ${(brief.avoid || []).join('; ')}`,\n";
  if (!source.includes(to)) {
    if (!source.includes(from)) throw new Error('Phase 7 instruction prompt anchor not found');
    source = source.replace(from, to);
  }
  fs.writeFileSync(file, source, 'utf8');
}

// Phase 6 allows 4000 characters of per-video direction. A structured v7 prompt
// also carries subject, evidence context, composition and avoid rules, so the scene
// editor needs headroom beyond the instruction field itself.
{
  const file = path.join(upstream, 'utils', 'scene-repair-service.js');
  let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  source = source.replace(
    "this.text(input.prompt, 4000, 'Scene prompt')",
    "this.text(input.prompt, 8000, 'Scene prompt')"
  );
  fs.writeFileSync(file, source, 'utf8');
}

{
  const file = path.join(upstream, 'dashboard', 'app.js');
  let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  source = source.replace('data-scene-field="prompt" rows="6" maxlength="4000"', 'data-scene-field="prompt" rows="6" maxlength="8000"');
  fs.writeFileSync(file, source, 'utf8');
}

console.log('Phase 7 visual prompts preserve Phase 6 per-video direction with structured-prompt headroom.');
