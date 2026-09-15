'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');

function shotPlan(sceneId, shotId, sourceCharacterIds = [], prompt = 'Bright animated story frame.') {
  return {
    fingerprint: `plan_${sceneId}`,
    scenes: [{
      sceneId,
      scenePosition: 1,
      fingerprint: `scene_${sceneId}`,
      shots: [{
        id: shotId,
        shotIndex: 0,
        prompt,
        fingerprint: `shot_${shotId}`,
        action: 'story action',
        expression: 'neutral',
        characters: [...sourceCharacterIds]
      }]
    }]
  };
}

function scene(id, characterBindings = []) {
  return { id, position: 1, characterBindings };
}

function bible(id, characters = [], extra = {}) {
  return { id, mode: 'kids_cartoon_2d', characters, ...extra };
}

function luna(overrides = {}) {
  return {
    id: overrides.id || 'luna_decl',
    characterKey: overrides.characterKey,
    name: overrides.name || 'Luna',
    species: overrides.species || 'rabbit',
    descriptor: overrides.descriptor ?? 'small childlike rabbit with rounded cheeks and long upright ears',
    palette: overrides.palette ?? ['cream fur', 'warm gold inner ears', 'teal accent'],
    proportions: overrides.proportions ?? 'large head, short torso, small paws',
    face: overrides.face ?? 'wide brown eyes, tiny triangular nose, soft cheek tufts',
    shapeLanguage: overrides.shapeLanguage ?? 'rounded friendly silhouette with tall ears',
    outfit: overrides.outfit ?? 'teal overalls over a white shirt',
    markings: overrides.markings ?? ['golden ear tips'],
    accessories: overrides.accessories ?? ['small moon hair clip'],
    aliases: overrides.aliases || [],
    canonicalCharacterAsset: overrides.canonicalCharacterAsset,
    ...overrides
  };
}

function nova(overrides = {}) {
  return {
    id: overrides.id || 'nova_decl',
    characterKey: overrides.characterKey,
    name: overrides.name || 'Nova',
    species: overrides.species || 'rabbit',
    descriptor: overrides.descriptor ?? 'slender young rabbit with one ear tilted outward',
    palette: overrides.palette ?? ['silver gray fur', 'violet ear lining', 'coral accent'],
    proportions: overrides.proportions ?? 'medium head, longer legs, slim torso',
    face: overrides.face ?? 'green almond eyes, round nose, small freckles',
    shapeLanguage: overrides.shapeLanguage ?? 'soft triangular silhouette with asymmetrical ears',
    outfit: overrides.outfit ?? 'coral hoodie and navy shorts',
    markings: overrides.markings ?? ['three freckles under left eye'],
    accessories: overrides.accessories ?? [],
    aliases: overrides.aliases || [],
    canonicalCharacterAsset: overrides.canonicalCharacterAsset,
    ...overrides
  };
}

async function createFixtureFiles() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase-11118-characters-'));
  const dataRoot = path.join(root, 'data');
  await fs.mkdir(dataRoot, { recursive: true });
  const files = {
    lunaCanonical: path.join(root, 'luna-canonical.png'),
    lunaAlternative: path.join(root, 'luna-alternative.png'),
    lunaFrameB: path.join(root, 'episode-b-luna.png'),
    lunaFrameC: path.join(root, 'episode-c-luna.png'),
    lunaFrameG: path.join(root, 'episode-g-luna-raincoat.png'),
    lunaReplacement: path.join(root, 'episode-i-wrong-rabbit.png'),
    novaCanonical: path.join(root, 'nova-canonical.png'),
    offscreenFrame: path.join(root, 'episode-f-offscreen.png'),
    resetFrame: path.join(root, 'episode-h-mentioned.png')
  };
  await fs.writeFile(files.lunaCanonical, Buffer.from('fixture canonical luna rabbit v1'));
  await fs.writeFile(files.lunaAlternative, Buffer.from('fixture later alternative luna must not replace canonical'));
  await fs.writeFile(files.lunaFrameB, Buffer.from('fixture same luna wearing durable yellow raincoat'));
  await fs.writeFile(files.lunaFrameC, Buffer.from('fixture same luna in another episode'));
  await fs.writeFile(files.lunaFrameG, Buffer.from('fixture same luna with durable raincoat after scene pajamas'));
  await fs.writeFile(files.lunaReplacement, Buffer.from('fixture visually different rabbit replacement'));
  await fs.writeFile(files.novaCanonical, Buffer.from('fixture canonical nova rabbit'));
  await fs.writeFile(files.offscreenFrame, Buffer.from('fixture scene without luna visible'));
  await fs.writeFile(files.resetFrame, Buffer.from('fixture narrative mention only no character visible'));
  return { root, dataRoot, files };
}

module.exports = { shotPlan, scene, bible, luna, nova, createFixtureFiles };
