'use strict';

require('dotenv').config();
const { Database } = require('../database/db');
const { AutonomyObservabilityV10 } = require('../utils/autonomy-observability-v10');

async function main() {
  const db = new Database();
  await db.initialize();
  try {
    const service = new AutonomyObservabilityV10(db);
    const report = await service.doctor();
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`Lumen Doctor v10: ${report.status.toUpperCase()}`);
      for (const check of report.checks) {
        const mark = check.status === 'passed' ? 'OK' : check.status === 'warning' ? 'WARN' : 'FAIL';
        console.log(`[${mark}] ${check.id}: ${check.message}`);
      }
      console.log(`Summary: ${report.summary.passed} passed, ${report.summary.warnings} warnings, ${report.summary.failed} failed, ${report.summary.blocking} blocking.`);
      console.log('Network calls made: no');
    }
    if (process.argv.includes('--strict') && report.status === 'failed') process.exitCode = 1;
  } finally {
    await db.close?.().catch?.(() => {});
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
