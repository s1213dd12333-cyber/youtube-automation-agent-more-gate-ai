'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const publishingSource = fs.readFileSync(path.join(upstream, 'agents', 'publishing-scheduling-agent.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

const checks = [
  () => assert(publishingSource.includes("madeForKids: gateBundle?.cartoonBible?.mode === 'kids_cartoon_2d'")),
  () => assert(publishingSource.includes('selfDeclaredMadeForKids: metadata.madeForKids === true')),
  () => assert(!publishingSource.includes('selfDeclaredMadeForKids: false')),
  () => assert.strictEqual(pkg.scripts['test:made-for-kids'], 'node ../bootstrap/verify-phase11-made-for-kids.js')
];

for (const fn of checks) fn();
console.log(`Phase 11.6 Made-for-Kids Mapping OK: ${checks.length} regression checks passed.`);
