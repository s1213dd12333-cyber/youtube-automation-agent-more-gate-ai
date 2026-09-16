'use strict';

const path = require('path');
const childProcess = require('child_process');

// Preserve the validated 12.5 materializer unchanged, then extend the canonical chain with 12.6.
require('./phase12-editorial-planning-ai-core-v125.js');
require('./phase12-autonomous-research.js');
childProcess.execFileSync(process.execPath, [path.join(__dirname, 'verify-phase12-autonomous-research.js')], { stdio: 'inherit' });
