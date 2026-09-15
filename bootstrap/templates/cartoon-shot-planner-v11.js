'use strict';

const crypto = require('crypto');
const { promptContext } = require('./cartoon-bible-v11');

const VERSION = '11.2';
const DEFAULT_MIN_SHOTS = 3;
const DEFAULT_MAX_SHOTS = 6;

function clean(value, limit = 4000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  return Math.max(min, Math.min(max, number));
}

function splitBeats(text) {
  const normalized = clean(text, 12000);
  if (!normalized) return ['Hold on the established characters and advance the scene visually.'];
  const sentences = normalized.match(/[^.!?]+(?:[.!?]+|$)/g) || [normalized];
  const beats = [];
  for (const sentence of sentences) {
    const parts = sentence
      .split(/\s*(?:;|—|\bbut\b|\bthen\b|\bwhile\b|\band then\b)\s*/i)
      .map(item => clean(item, 500))
      .filter(Boolean);
    beats.push(...parts);
  }
  return beats.length ? beats.slice(0, 12) : [normalized];
}

function desiredShotCount(scene = {}, minShots = DEFAULT_MIN_SHOTS, maxShots = DEFAULT_MAX_SHOTS) {
  const min = clampInt(minShots, DEFAULT_MIN_SHOTS, 2, 8);
  const max = clampInt(maxShots, DEFAULT_MAX_SHOTS, min, 10);
  const duration = Number(scene.duration || 0);
  const beats = splitBeats(scene.scriptText || scene.label || '');
  let desired;
  if (duration >= 24) desired = 6;
  else if (duration >= 18) desired = 5;
  else if (duration >= 12) desired = 4;
  else if (duration > 0) desired = 3;
  else desired = 2 + Math.min(4, beats.length);
  return Math.max(min, Math.min(max, desired));
}

function shotSequence(count) {
  const sequences = {
    2: ['wide', 'close_up'],
    3: ['wide', 'medium', 'close_up'],
    4: ['wide', 'medium', 'close_up', 'ending'],
    5: ['wide', 'medium', 'reaction', 'action', 'ending'],
    6: ['wide', 'medium', 'close_up', 'action', 'reaction', 'ending'],
    7: ['wide', 'medium', 'close_up', 'action', 'reaction', 'medium', 'ending'],
    8: ['wide', 'medium', 'close_up', 'action', 'reaction', 'medium', 'close_up', 'ending'],
    9: ['wide', 'medium', 'close_up', 'action', 'reaction', 'medium', 'close_up', 'action', 'ending'],
    10: ['wide', 'medium', 'close_up', 'action', 'reaction', 'medium', 'close_up', 'action', 'reaction', 'ending']
  };
  return sequences[count] || sequences[DEFAULT_MIN_SHOTS];
}

function cameraFor(type) {
  const map = {
    wide: 'wide establishing shot, readable silhouettes, simple foreground/midground/background layers',
    medium: 'medium two-shot or character-focused medium shot at child eye level',
    close_up: 'gentle close-up emphasizing one clear facial emotion without distorting character proportions',
    reaction: 'reaction shot focused on readable face and body language; preserve screen direction from the previous shot',
    action: 'clear action shot with one dominant movement and uncluttered staging',
    ending: 'calm resolving wide or medium-wide composition that visually closes the beat'
  };
  return map[type] || map.medium;
}

function goalFor(type, index, count) {
  if (index === 0) return 'establish location, characters, and immediate story situation';
  if (index === count - 1) return 'resolve this scene beat and prepare a clean visual handoff to the next scene';
  if (type === 'close_up' || type === 'reaction') return 'make the current emotion instantly readable to a young viewer';
  if (type === 'action') return 'show the concrete story action instead of describing it abstractly';
  return 'advance the story with a visibly different composition and action from the previous shot';
}

function expressionFor(beat) {
  const text = clean(beat, 600).toLowerCase();
  if (/sad|alone|lonely|upset|cry|worried|afraid/.test(text)) return 'gentle concern or mild sadness; child-safe and not intense';
  if (/surpris|wow|discover|notice|realize/.test(text)) return 'curious surprise with wide readable eyes';
  if (/laugh|happy|smile|cheer|friend|share|together|celebrat/.test(text)) return 'warm happy expression with an easy-to-read smile';
  if (/ask|think|wonder|curious|look/.test(text)) return 'curious and attentive';
  return 'friendly, emotionally readable, and appropriate to the spoken beat';
}

function charactersForBeat(beat, bible = {}, index = 0) {
  const characters = Array.isArray(bible.characters) ? bible.characters : [];
  const text = clean(beat, 1000).toLowerCase();
  const mentioned = characters.filter(character => text.includes(String(character.name || '').toLowerCase()));
  if (mentioned.length) return mentioned.slice(0, 3).map(character => character.id);
  const main = characters.find(character => character.role === 'main') || characters[0];
  if (index === 0 && main) return [main.id];
  return characters.slice(0, Math.min(2, characters.length)).map(character => character.id);
}

function distributeDuration(sceneDuration, count) {
  const total = Number(sceneDuration || 0);
  if (!(total > 0)) return Array.from({ length: count }, () => null);
  const base = total / count;
  const values = Array.from({ length: count }, (_, index) => {
    const bias = index === 0 || index === count - 1 ? 1.08 : 0.96;
    return Number((base * bias).toFixed(3));
  });
  const sum = values.reduce((acc, value) => acc + value, 0);
  values[values.length - 1] = Number((values[values.length - 1] + (total - sum)).toFixed(3));
  return values;
}

function makeShotPrompt({ scene, bible, shot, previousShot }) {
  const characterById = new Map((bible.characters || []).map(character => [character.id, character]));
  const cast = (shot.characters || []).map(id => characterById.get(id)).filter(Boolean);
  const castText = cast.length
    ? cast.map(character => `${character.name}: ${character.descriptor}; palette ${(character.palette || []).join('/')}`).join(' | ')
    : 'preserve the established cast from the Character Bible';
  const continuity = previousShot
    ? `Continue from shot ${previousShot.shotIndex + 1}; preserve screen direction, location landmarks, character design, costume, palette, and carried props.`
    : 'Establish the scene cleanly while obeying the Character Bible and Style Bible.';
  return [
    promptContext(bible),
    '',
    'SHOT PLAN V11.2:',
    `SCENE: ${clean(scene.label || `Scene ${Number(scene.position || 0) + 1}`, 160)}`,
    `SHOT: ${shot.shotIndex + 1}/${shot.shotCount} · ${shot.shotType}`,
    `GOAL: ${shot.goal}`,
    `STORY BEAT: ${shot.storyBeat}`,
    `ACTION: ${shot.action}`,
    `CHARACTERS: ${castText}`,
    `EXPRESSION: ${shot.expression}`,
    `CAMERA: ${shot.camera}`,
    `BACKGROUND: ${shot.background}`,
    `CONTINUITY: ${continuity}`,
    'FRAME RULE: one dominant action, readable silhouette, no embedded text, no random props, no unmotivated costume/location changes.'
  ].filter(Boolean).join('\n').slice(0, 14000);
}

class CartoonShotPlannerV11 {
  constructor(options = {}) {
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.minShots = clampInt(options.minShots ?? process.env.CARTOON_SHOTS_PER_SCENE_MIN, DEFAULT_MIN_SHOTS, 2, 8);
    this.maxShots = clampInt(options.maxShots ?? process.env.CARTOON_SHOTS_PER_SCENE_MAX, DEFAULT_MAX_SHOTS, this.minShots, 10);
  }

  planScene(production, scene, bible) {
    if (!bible || bible.mode !== 'kids_cartoon_2d') return null;
    const beats = splitBeats(scene.scriptText || scene.label || '');
    const count = desiredShotCount(scene, this.minShots, this.maxShots);
    const types = shotSequence(count);
    const durations = distributeDuration(scene.duration, count);
    const sceneFingerprint = hash(JSON.stringify({
      version: VERSION,
      productionId: production?.id || null,
      sceneId: scene.id,
      sceneText: scene.scriptText || '',
      sceneDuration: scene.duration || null,
      bibleFingerprint: bible.fingerprint,
      count,
      minShots: this.minShots,
      maxShots: this.maxShots
    }));

    const shots = [];
    for (let index = 0; index < count; index += 1) {
      const beat = beats[Math.min(beats.length - 1, Math.floor(index * beats.length / count))] || beats[0];
      const shotType = types[index] || 'medium';
      const shot = {
        version: VERSION,
        id: `shot_${hash(`${scene.id}\u0000${sceneFingerprint}\u0000${index}`).slice(0, 22)}`,
        productionId: production?.id || null,
        sceneId: scene.id,
        scenePosition: Number(scene.position || 0),
        shotIndex: index,
        shotCount: count,
        shotType,
        duration: durations[index],
        goal: goalFor(shotType, index, count),
        storyBeat: beat,
        action: `Visually show: ${clean(beat, 420)}`,
        characters: charactersForBeat(beat, bible, index),
        expression: expressionFor(beat),
        background: 'use the same established location and recurring landmarks for this scene; simplify background detail so the character action remains dominant',
        camera: cameraFor(shotType),
        continuityNotes: [
          'preserve Character Bible identity exactly',
          'preserve established color placement, outfit, markings, proportions, and props',
          index > 0 ? 'match location geography and screen direction from the previous shot' : 'establish stable scene geography for following shots',
          index < count - 1 ? 'leave a readable pose/action handoff for the next shot' : 'finish on a clean transition pose'
        ],
        planFingerprint: sceneFingerprint,
        status: 'planned'
      };
      shot.prompt = makeShotPrompt({ scene, bible, shot, previousShot: shots[index - 1] || null });
      shot.fingerprint = hash(JSON.stringify({
        planFingerprint: sceneFingerprint,
        shotIndex: shot.shotIndex,
        shotType: shot.shotType,
        storyBeat: shot.storyBeat,
        characters: shot.characters,
        camera: shot.camera
      }));
      shots.push(shot);
    }

    return {
      version: VERSION,
      productionId: production?.id || null,
      sceneId: scene.id,
      scenePosition: Number(scene.position || 0),
      fingerprint: sceneFingerprint,
      shotCount: shots.length,
      shots
    };
  }

  planProduction(production = {}, scenes = [], bible = null) {
    if (!bible || bible.mode !== 'kids_cartoon_2d') return null;
    const scenePlans = scenes.map(scene => this.planScene(production, scene, bible)).filter(Boolean);
    const shots = scenePlans.flatMap(plan => plan.shots);
    const fingerprint = hash(scenePlans.map(plan => plan.fingerprint).join('\u0000'));
    const result = {
      version: VERSION,
      productionId: production.id || null,
      fingerprint,
      sceneCount: scenePlans.length,
      shotCount: shots.length,
      minShotsPerScene: this.minShots,
      maxShotsPerScene: this.maxShots,
      scenes: scenePlans,
      shots,
      summary: {
        sceneCount: scenePlans.length,
        shotCount: shots.length,
        minShotsPerScene: scenePlans.length ? Math.min(...scenePlans.map(plan => plan.shotCount)) : 0,
        maxShotsPerScene: scenePlans.length ? Math.max(...scenePlans.map(plan => plan.shotCount)) : 0,
        averageShotsPerScene: scenePlans.length ? Number((shots.length / scenePlans.length).toFixed(2)) : 0
      },
      createdAt: new Date().toISOString()
    };
    this.logger.info(`Cartoon Shot Planner v11.2 planned ${result.shotCount} shot(s) across ${result.sceneCount} scene(s).`);
    return result;
  }
}

module.exports = {
  CARTOON_SHOT_PLANNER_VERSION: VERSION,
  CartoonShotPlannerV11,
  splitBeats,
  desiredShotCount,
  shotSequence,
  cameraFor,
  expressionFor
};
