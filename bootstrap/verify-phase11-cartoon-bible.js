'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const servicePath = path.join(upstream, 'utils', 'cartoon-bible-v11.js');
if (!fs.existsSync(servicePath)) throw new Error('Phase 11.1 service is not materialized: utils/cartoon-bible-v11.js');

const {
  CARTOON_BIBLE_VERSION,
  CartoonBibleV11,
  detectCartoonMode,
  promptContext
} = require(servicePath);

const cartoonProduction = {
  id: 'prod_cartoon_phase11',
  strategy: {
    topic: 'Luna the Little Star Learns to Share',
    videoInstructions: `Create an original animated-style children's video for ages 4 to 7.
Main character: Luna, a small smiling star.
Supporting characters: Milo, a shy little cloud; Tico, a cheerful bird.
Use bright colorful cartoon visuals with a soft 2D children's illustration style.
All characters must be original.
Use rounded shapes, expressive faces, simple backgrounds, and friendly body language.`
  },
  script: {
    title: 'Luna the Little Star Learns to Share',
    hook: { text: 'Luna has a basket of sparkling star cookies, but Milo is sitting alone.' },
    mainContent: {
      sections: [
        { title: 'Luna notices Milo', content: ['Luna floats closer to Milo and asks why he looks sad.'] },
        { title: 'Sharing makes room for friendship', content: ['Luna shares her star cookies with Milo and Tico joins them.'] }
      ]
    },
    conclusion: { recap: ['Sharing can make someone feel included.'], finalThought: 'Luna, Milo, and Tico smile together.' }
  }
};

const documentaryProduction = {
  id: 'prod_science_phase11',
  strategy: {
    topic: 'How Atomic Clocks Measure Gravitational Time Dilation',
    videoInstructions: 'Use evidence-first scientific diagrams and real institutional imagery.'
  },
  script: { title: 'Atomic clocks and gravity', mainContent: { sections: [] } }
};

assert.strictEqual(CARTOON_BIBLE_VERSION, '11.1');
assert.strictEqual(detectCartoonMode(cartoonProduction, 'auto'), true);
assert.strictEqual(detectCartoonMode(documentaryProduction, 'auto'), false);

const service = new CartoonBibleV11({ mode: 'auto', logger: { info() {}, warn() {}, error() {} } });
const bible = service.buildProductionBible(cartoonProduction);
assert(bible && bible.mode === 'kids_cartoon_2d');
assert(bible.characters.length >= 3);
assert(bible.characters.some(character => character.name === 'Luna'));
assert(bible.characters.some(character => character.name === 'Milo'));
assert(bible.characters.some(character => character.name === 'Tico'));
assert.strictEqual(bible.characters.find(character => character.name === 'Luna').role, 'main');
assert.strictEqual(bible.style.mode, 'kids_cartoon_2d');

const rebuilt = service.buildProductionBible(cartoonProduction);
assert.strictEqual(rebuilt.fingerprint, bible.fingerprint, 'same creative specification must produce a stable bible fingerprint');
assert(promptContext(bible).includes('CARTOON BIBLE V11.1:'));

const applied = service.applyToVisualPlan({
  version: 7,
  identity: { name: 'documentary' },
  briefs: {
    scene_1: {
      sceneId: 'scene_1', visualType: 'documentary_explainer', prompt: 'A generic scene',
      identity: { name: 'documentary' }, quality: { accepted: true, specificity: 80, genericAiRisk: 20 }
    }
  },
  scenes: [{
    id: 'scene_1', label: 'Luna notices Milo', prompt: 'A generic scene',
    visualBrief: {
      sceneId: 'scene_1', visualType: 'documentary_explainer', prompt: 'A generic scene',
      identity: { name: 'documentary' }, quality: { accepted: true, specificity: 80, genericAiRisk: 20 }
    }
  }],
  summary: { sceneCount: 1 }
}, bible);
assert.strictEqual(applied.scenes[0].visualBrief.visualType, 'kids_cartoon_2d');
assert(applied.scenes[0].prompt.includes('CHARACTER BIBLE:'));
assert.strictEqual(applied.identity.name, 'Lumen Kids Cartoon Bible v11.1');

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const videoSource = fs.readFileSync(path.join(upstream, 'utils', 'ai-video-generator.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

assert(dbSource.includes('CREATE TABLE IF NOT EXISTS cartoon_visual_bibles'));
assert(dbSource.includes('async saveCartoonVisualBible(bible = {})'));
assert(dbSource.includes('const cartoonBible = await this.getLatestCartoonVisualBible(productionId);'));
assert(pipelineSource.includes("const { CartoonBibleV11 } = require('./cartoon-bible-v11');"));
assert(pipelineSource.includes('this.cartoonBible = options.cartoonBible || new CartoonBibleV11'));
assert(pipelineSource.includes("visualBrief?.visualType === 'kids_cartoon_2d'"));
assert(videoSource.includes('kids_cartoon_2d: "original polished 2D children'));
assert(dashboardSource.includes('function renderCartoonBible(bible)'));
assert.strictEqual(pkg.scripts['test:cartoon-bible'], 'node ../bootstrap/verify-phase11-cartoon-bible.js');
assert(envSource.includes('CARTOON_VISUAL_MODE=auto'));

console.log('Phase 11.1 Cartoon Bible OK: 24 regression checks passed.');
