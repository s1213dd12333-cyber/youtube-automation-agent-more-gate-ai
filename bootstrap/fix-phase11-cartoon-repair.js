'use strict';

const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '..', 'upstream', 'utils', 'scene-repair-service.js');
let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const from = "        const routed = await this.visualRouter.resolve({ productionId, scene, brief: visualBrief });\n";
const to = "        const routed = visualBrief?.visualType === 'kids_cartoon_2d'\n          ? null\n          : await this.visualRouter.resolve({ productionId, scene, brief: visualBrief });\n";

if (!source.includes(to)) {
  if (!source.includes(from)) throw new Error('Phase 11.1 scene repair visual-router anchor not found');
  source = source.replace(from, to);
}

fs.writeFileSync(target, source, 'utf8');
console.log('Phase 11.1 cartoon repair routing hardened: manual cartoon regeneration cannot fall back to documentary source search.');

// Runtime hardening: duplicate protection is automatic for autonomous sources,
// while operator-directed/manual reruns remain possible without crashing the app.
require('./fix-topic-duplicate-handling.js');
require('./verify-topic-duplicate-handling.js');
