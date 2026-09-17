'use strict';

const path = require('path');
const childProcess = require('child_process');

// Preserve the validated 12.5 materializer unchanged, then extend the canonical chain through 12.12.
require('./phase12-editorial-planning-ai-core-v125.js');
require('./phase12-autonomous-research.js');
childProcess.execFileSync(process.execPath, [path.join(__dirname, 'verify-phase12-autonomous-research.js')], { stdio: 'inherit' });
require('./phase12-claim-verification-engine.js');
childProcess.execFileSync(process.execPath, [path.join(__dirname, 'verify-phase12-claim-verification-engine.js')], { stdio: 'inherit' });
require('./phase12-autonomous-production-director.js');
childProcess.execFileSync(process.execPath, [path.join(__dirname, 'verify-phase12-autonomous-production-director.js')], { stdio: 'inherit' });
require('./phase12-autonomous-quality-council.js');
childProcess.execFileSync(process.execPath, [path.join(__dirname, 'verify-phase12-autonomous-quality-council.js')], { stdio: 'inherit' });
require('./phase12-autonomous-publishing-brain.js');
childProcess.execFileSync(process.execPath, [path.join(__dirname, 'verify-phase12-autonomous-publishing-brain.js')], { stdio: 'inherit' });
require('./phase12-performance-learning.js');
childProcess.execFileSync(process.execPath, [path.join(__dirname, 'verify-phase12-performance-learning.js')], { stdio: 'inherit' });
require('./phase12-self-improvement-engine.js');
childProcess.execFileSync(process.execPath, [path.join(__dirname, 'verify-phase12-self-improvement-engine.js')], { stdio: 'inherit' });
require('./fix-newsroom-source-resilience.js');
require('./fix-newsroom-default-rss.js');
childProcess.execFileSync(process.execPath, [path.join(__dirname, 'verify-newsroom-source-resilience.js')], { stdio: 'inherit' });
require('./fix-gemini-tts-transient-fallback.js');
childProcess.execFileSync(process.execPath, [path.join(__dirname, 'verify-gemini-tts-transient-fallback.js')], { stdio: 'inherit' });
require('./fix-content-strategy-json-parser.js');
childProcess.execFileSync(process.execPath, [path.join(__dirname, 'verify-content-strategy-json-parser.js')], { stdio: 'inherit' });
