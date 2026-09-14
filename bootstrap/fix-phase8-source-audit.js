'use strict';

const fs = require('fs');
const path = require('path');

const upstream = path.join(__dirname, '..', 'upstream');

{
  const file = path.join(upstream, 'database', 'db.js');
  let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const fkFrom = "        FOREIGN KEY (production_id) REFERENCES productions(id),\n        FOREIGN KEY (scene_id) REFERENCES production_scenes(id)\n      )`,\n      `CREATE INDEX IF NOT EXISTS idx_visual_asset_records_production";
  const fkTo = "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE,\n        FOREIGN KEY (scene_id) REFERENCES production_scenes(id) ON DELETE CASCADE\n      )`,\n      `CREATE INDEX IF NOT EXISTS idx_visual_asset_records_production";
  if (!source.includes(fkTo)) {
    if (!source.includes(fkFrom)) throw new Error('Phase 8 visual audit foreign-key anchor not found');
    source = source.replace(fkFrom, fkTo);
  }
  source = source.replace('`INSERT INTO visual_asset_records (', '`INSERT OR REPLACE INTO visual_asset_records (');
  fs.writeFileSync(file, source, 'utf8');
}

{
  const file = path.join(upstream, 'utils', 'visual-router-v8.js');
  let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const from = "      const rights = clean([...(item.rights || []), ...(item.rights_advisory || [])].join(' '), 1200);";
  const to = "      const rightsParts = [item.rights, item.rights_advisory].flatMap(value => Array.isArray(value) ? value : value ? [value] : []);\n      const rights = clean(rightsParts.join(' '), 1200);";
  if (!source.includes(to)) {
    if (!source.includes(from)) throw new Error('Phase 8 Library of Congress rights anchor not found');
    source = source.replace(from, to);
  }
  fs.writeFileSync(file, source, 'utf8');
}

console.log('Phase 8 source audit hardened: cascade-safe replans, idempotent asset records, and normalized archive rights metadata.');
