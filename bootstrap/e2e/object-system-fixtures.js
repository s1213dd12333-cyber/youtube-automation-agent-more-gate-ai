'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');

function locationBinding(environmentId, locationId) {
  return { location: { id: locationId }, usage: { environmentId } };
}

function zoneBinding(locationId, zoneId, zoneKey) {
  return { zone: { id: zoneId, locationId, zoneKey } };
}

function shotPlan(sceneId, shotId, prompt = 'Cinematic establishing shot.') {
  return {
    fingerprint: `plan_${sceneId}`,
    scenes: [{ sceneId, scenePosition: 1, fingerprint: `scene_${sceneId}`, shots: [{ id: shotId, shotIndex: 0, prompt, fingerprint: `shot_${shotId}` }] }]
  };
}

function environment(environmentId, persistentObjects = [], extra = {}) {
  return { environmentId, persistentObjects, ...extra };
}

function car(overrides = {}) {
  return {
    id: overrides.id || 'car_decl',
    objectKey: overrides.objectKey,
    name: overrides.name || 'Miller Family Car',
    objectType: 'vehicle',
    brand: overrides.brand ?? 'Orion',
    model: overrides.model ?? 'Estate',
    color: overrides.color ?? 'red',
    material: overrides.material ?? 'metal',
    silhouette: overrides.silhouette ?? 'compact four-door family wagon',
    distinguishingMarks: overrides.distinguishingMarks ?? ['silver roof rails', 'small dent on rear bumper'],
    aliases: overrides.aliases || [],
    canonicalAsset: overrides.canonicalAsset,
    ...overrides
  };
}

async function createFixtureFiles() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase-11108-objects-'));
  const dataRoot = path.join(root, 'data');
  await fs.mkdir(dataRoot, { recursive: true });
  const files = {
    carCanonical: path.join(root, 'car-canonical.png'),
    carAlternative: path.join(root, 'car-alternative.png'),
    carFrameB: path.join(root, 'video-b-car.png'),
    carFrameC: path.join(root, 'video-c-car.png'),
    carReplacement: path.join(root, 'video-g-replacement.png'),
    jonesCarCanonical: path.join(root, 'jones-car-canonical.png'),
    offscreenFrame: path.join(root, 'video-f-offscreen.png')
  };
  await fs.writeFile(files.carCanonical, Buffer.from('fixture canonical miller car v1'));
  await fs.writeFile(files.carAlternative, Buffer.from('fixture later alternative must not replace canonical'));
  await fs.writeFile(files.carFrameB, Buffer.from('fixture same miller car video b'));
  await fs.writeFile(files.carFrameC, Buffer.from('fixture same miller car moved video c'));
  await fs.writeFile(files.carReplacement, Buffer.from('fixture wrong replacement vehicle'));
  await fs.writeFile(files.jonesCarCanonical, Buffer.from('fixture canonical jones car'));
  await fs.writeFile(files.offscreenFrame, Buffer.from('fixture frame without car'));
  return { root, dataRoot, files };
}

module.exports = { locationBinding, zoneBinding, shotPlan, environment, car, createFixtureFiles };
