'use strict';
const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '..', 'upstream', 'index.js');
let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const from = "    const { jobId = null, strategyContext = {} } = options;";
const to = "    const { jobId = null } = options;\n    const strategyContext = options.strategyContext || {};";

if (source.includes(to)) {
  console.log('Strategy context null-safety fix already applied.');
  process.exit(0);
}

if (!source.includes(from)) {
  throw new Error('Anchor not found for strategyContext null-safety fix');
}

source = source.replace(from, to);
fs.writeFileSync(target, source, 'utf8');
console.log('Applied strategyContext null-safety fix.');
