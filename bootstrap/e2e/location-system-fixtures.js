'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');

function environment(environmentId, name, overrides = {}) {
  return {
    environmentId,
    name,
    category: 'house',
    construction: 'timber frame',
    architecturalStyle: 'craftsman',
    materials: ['wood', 'brick'],
    palette: ['cream', 'forest green'],
    layout: 'living room connected to hall with central staircase and kitchen beyond the hall',
    signatureElements: ['brick fireplace', 'central staircase'],
    forbiddenChanges: ['move central staircase'],
    ...overrides
  };
}

function propLocks(environmentId) {
  return [
    { id: `${environmentId}_sofa`, environmentId, required: true, name: 'green sofa', type: 'sofa', lockedAttributes: { color: 'green', material: 'fabric', silhouette: 'three seat sofa', relativePlacement: 'living room facing fireplace' }, forbiddenChanges: ['color'] },
    { id: `${environmentId}_table`, environmentId, required: true, name: 'oak coffee table', type: 'table', lockedAttributes: { color: 'oak', material: 'oak', silhouette: 'low rectangle', relativePlacement: 'living room center' }, forbiddenChanges: ['material'] }
  ];
}

function binding(result) { return { location: result.location, usage: result.usage }; }
function signature(fingerprint, rgb = [190, 170, 150], luminance = 170, grid = 120, dhash = '10'.repeat(32), edgeDensity = 20, aspect = 16 / 9) {
  return { width: 1600, height: 900, aspect, rgbMean: rgb, luminance, grid: Array(48).fill(grid), dhash, edgeDensity, fingerprint };
}

async function createFixtureFiles() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'location-system-e2e-'));
  const source = path.join(root, 'source');
  const dataRoot = path.join(root, 'data');
  await fs.mkdir(source, { recursive: true });
  const files = {
    master: path.join(source, 'master.png'),
    living: path.join(source, 'living.png'),
    kitchen: path.join(source, 'kitchen.png'),
    night: path.join(source, 'video-b-night.png'),
    drift: path.join(source, 'video-c-drift.png')
  };
  for (const [key, filePath] of Object.entries(files)) await fs.writeFile(filePath, `fixture:${key}:${'x'.repeat(50)}`);
  return { root, dataRoot, files };
}

module.exports = { environment, propLocks, binding, signature, createFixtureFiles };
