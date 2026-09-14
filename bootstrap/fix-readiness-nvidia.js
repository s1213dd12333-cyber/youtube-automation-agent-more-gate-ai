'use strict';
const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '..', 'upstream', 'utils', 'production-readiness-service.js');
let s = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const oldLine = "    const response = await service.generateText('Reply with exactly READY.', { maxTokens: 16, temperature: 0 });";
const newBlock = "    const readinessMaxTokens = service.providerName === 'NVIDIA NIM' ? 1024 : 16;\n    const response = await service.generateText('Reply with exactly READY.', { maxTokens: readinessMaxTokens, temperature: 0 });";

if (!s.includes(newBlock)) {
  if (!s.includes(oldLine)) {
    throw new Error('Anchor not found for NVIDIA readiness token budget');
  }
  s = s.replace(oldLine, newBlock);
  fs.writeFileSync(target, s, 'utf8');
}

console.log('NVIDIA readiness probe token budget fixed.');
