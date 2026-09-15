'use strict';

require('dotenv').config();
const { Database } = require('../database/db');
const { AutonomyObservabilityV10 } = require('../utils/autonomy-observability-v10');

async function main() {
  const db = new Database();
  await db.initialize();
  try {
    const service = new AutonomyObservabilityV10(db);
    const doctor = await service.doctor();
    const latest = await db.getRow('SELECT id FROM productions ORDER BY created_at DESC LIMIT 1');
    let production = null;
    if (latest?.id) {
      production = {
        publication: await service.publicationState(latest.id),
        usage: await service.usageForProduction(latest.id),
        traces: await db.listAutonomyTraceSpans?.({ productionId: latest.id, limit: 50 }) || []
      };
    }
    const result = {
      version: 10,
      mode: 'safe-e2e-inspection',
      mutatingActions: false,
      networkCallsMade: false,
      doctor,
      latestProduction: production
    };
    console.log(JSON.stringify(result, null, 2));
    if (doctor.status === 'failed') process.exitCode = 1;
  } finally {
    if (typeof db.close === 'function') await db.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
