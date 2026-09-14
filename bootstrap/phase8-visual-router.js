'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const file = rel => path.join(upstream, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (rel, value) => fs.writeFileSync(file(rel), value.replace(/\r\n/g, '\n'), 'utf8');

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  const index = text.indexOf(from);
  if (index === -1) throw new Error(`Anchor not found for ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Anchor not found for ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'visual-router-v8.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/visual-router-v8.js');
  write('utils/visual-router-v8.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const tables = [
    "      // Phase 8 real-source visual provenance and media-rights audit",
    "      `CREATE TABLE IF NOT EXISTS visual_asset_records (",
    "        id TEXT PRIMARY KEY,",
    "        production_id TEXT NOT NULL,",
    "        scene_id TEXT NOT NULL,",
    "        router_version INTEGER NOT NULL DEFAULT 8,",
    "        source_name TEXT NOT NULL,",
    "        source_key TEXT NOT NULL,",
    "        source_asset_id TEXT,",
    "        source_page_url TEXT,",
    "        media_url TEXT NOT NULL,",
    "        local_path TEXT NOT NULL,",
    "        title TEXT,",
    "        creator TEXT,",
    "        license TEXT,",
    "        license_url TEXT,",
    "        attribution TEXT,",
    "        rights_status TEXT NOT NULL DEFAULT 'unknown',",
    "        rights_confirmed INTEGER DEFAULT 0,",
    "        requires_attribution INTEGER DEFAULT 0,",
    "        relevance_score REAL DEFAULT 0,",
    "        query TEXT,",
    "        metadata TEXT NOT NULL DEFAULT '{}',",
    "        created_at TEXT DEFAULT CURRENT_TIMESTAMP,",
    "        FOREIGN KEY (production_id) REFERENCES productions(id),",
    "        FOREIGN KEY (scene_id) REFERENCES production_scenes(id)",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_visual_asset_records_production ON visual_asset_records(production_id, created_at)`,",
    "      `CREATE INDEX IF NOT EXISTS idx_visual_asset_records_scene ON visual_asset_records(scene_id, created_at)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, tables, 'phase 8 visual asset audit table');

  const methods = [
    "  async saveVisualAssetRecord(record = {}) {",
    "    const id = record.id || this.generateId('visual_asset');",
    "    await this.executeQuery(",
    "      `INSERT INTO visual_asset_records (",
    "        id, production_id, scene_id, router_version, source_name, source_key, source_asset_id,",
    "        source_page_url, media_url, local_path, title, creator, license, license_url, attribution,",
    "        rights_status, rights_confirmed, requires_attribution, relevance_score, query, metadata",
    "      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,",
    "      [",
    "        id, record.productionId, record.sceneId, Number(record.routerVersion || 8), record.sourceName || record.sourceKey || 'source',",
    "        record.sourceKey || 'source', record.sourceAssetId || null, record.sourcePageUrl || null, record.mediaUrl || '',",
    "        record.localPath || '', record.title || null, record.creator || null, record.license || null, record.licenseUrl || null,",
    "        record.attribution || null, record.rightsStatus || 'unknown', record.rightsConfirmed ? 1 : 0,",
    "        record.requiresAttribution ? 1 : 0, Number(record.relevanceScore || 0), record.query || null, JSON.stringify(record.metadata || {})",
    "      ]",
    "    );",
    "    return this.getVisualAssetRecord(id);",
    "  }",
    "",
    "  async getVisualAssetRecord(id) {",
    "    return this.parseVisualAssetRecord(await this.getRow('SELECT * FROM visual_asset_records WHERE id = ?', [id]));",
    "  }",
    "",
    "  async listVisualAssetRecords(productionId) {",
    "    const rows = await this.getAllRows('SELECT * FROM visual_asset_records WHERE production_id = ? ORDER BY created_at DESC, rowid DESC', [productionId]);",
    "    return rows.map(row => this.parseVisualAssetRecord(row));",
    "  }",
    "",
    "  parseVisualAssetRecord(row) {",
    "    if (!row) return null;",
    "    return {",
    "      ...row, productionId: row.production_id, sceneId: row.scene_id, routerVersion: Number(row.router_version || 8),",
    "      sourceName: row.source_name, sourceKey: row.source_key, sourceAssetId: row.source_asset_id, sourcePageUrl: row.source_page_url,",
    "      mediaUrl: row.media_url, localPath: row.local_path, licenseUrl: row.license_url, rightsStatus: row.rights_status,",
    "      rightsConfirmed: Boolean(row.rights_confirmed), requiresAttribution: Boolean(row.requires_attribution),",
    "      relevanceScore: Number(row.relevance_score || 0), metadata: JSON.parse(row.metadata || '{}')",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'phase 8 visual asset database methods');

  const oldList = `  async listProductionScenes(productionId) {\n    const rows = await this.getAllRows(\n      'SELECT * FROM production_scenes WHERE production_id = ? ORDER BY position, created_at',\n      [productionId]\n    );\n    return rows.map(row => this.parseProductionScene(row));\n  }`;
  const newList = `  async listProductionScenes(productionId) {\n    const rows = await this.getAllRows(\n      'SELECT * FROM production_scenes WHERE production_id = ? ORDER BY position, created_at',\n      [productionId]\n    );\n    const scenes = rows.map(row => this.parseProductionScene(row));\n    if (!scenes.length) return scenes;\n    const records = await this.listVisualAssetRecords(productionId);\n    const latestByScene = new Map();\n    for (const record of records) if (!latestByScene.has(record.sceneId)) latestByScene.set(record.sceneId, record);\n    return scenes.map(scene => ({ ...scene, sourceAsset: latestByScene.get(scene.id) || null }));\n  }`;
  s = replaceOnce(s, oldList, newList, 'attach real-source provenance to scene bundles');
  write(rel, s);
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { VisualDirectorV7 } = require('./visual-director-v7');\n",
    "const { VisualDirectorV7 } = require('./visual-director-v7');\nconst { VisualAssetRouterV8 } = require('./visual-router-v8');\n",
    'visual router import'
  );
  s = replaceOnce(
    s,
    "    this.visualDirector = options.visualDirector || new VisualDirectorV7({ logger: this.logger });\n",
    "    this.visualDirector = options.visualDirector || new VisualDirectorV7({ logger: this.logger });\n    this.visualRouter = options.visualRouter || new VisualAssetRouterV8(db, { logger: this.logger, dataRoot: this.dataRoot });\n",
    'visual router construction'
  );

  const oldGeneration = `        const assets = await this.videoGenerator.generateVisualAssets(scene.prompt, visualBrief?.visualType || 'documentary', 1);\n        const assetPath = Array.isArray(assets) ? assets[0] : null;`;
  const newGeneration = `        const routed = await this.visualRouter.resolve({ productionId, scene, brief: visualBrief || { subject: scene.label, sceneText: scene.scriptText, visualType: 'documentary_explainer', details: [] } });\n        let assetPath = routed?.path || null;\n        let assets = null;\n        if (!assetPath) {\n          assets = await this.videoGenerator.generateVisualAssets(scene.prompt, visualBrief?.visualType || 'documentary', 1);\n          assetPath = Array.isArray(assets) ? assets[0] : null;\n        }`;
  s = replaceOnce(s, oldGeneration, newGeneration, 'real-source router before image generation');

  const oldUpdate = `        const local = path.basename(assetPath).startsWith('visual_local_');\n        scene = await this.db.updateProductionScene(productionId, sceneId, {\n          assetType: 'image',\n          assetOrigin: 'generated',\n          assetPath,\n          provider: local ? 'local-renderer' : 'image-provider',\n          model: null,\n          externalTaskId: null,\n          status: 'visual_ready',\n          rightsConfirmed: true,\n          containsSyntheticMedia: !local\n        });`;
  const newUpdate = `        const local = !routed?.path && path.basename(assetPath).startsWith('visual_local_');\n        scene = await this.db.updateProductionScene(productionId, sceneId, {\n          assetType: 'image',\n          assetOrigin: routed?.path ? 'licensed-source' : 'generated',\n          assetPath,\n          provider: routed?.path ? routed.provider : (local ? 'local-renderer' : 'image-provider'),\n          model: routed?.path ? routed.model : null,\n          externalTaskId: null,\n          status: 'visual_ready',\n          rightsConfirmed: routed?.path ? routed.rightsConfirmed === true : true,\n          containsSyntheticMedia: routed?.path ? false : !local\n        });`;
  s = replaceOnce(s, oldUpdate, newUpdate, 'persist routed source asset on scene');

  s = replaceOnce(
    s,
    "          costEvidence: { billed: false, provider: scene.provider, visualDirectorVersion: 7, visualQuality: visualBrief?.quality || null }\n",
    "          costEvidence: { billed: false, provider: scene.provider, visualDirectorVersion: 7, visualRouterVersion: 8, visualQuality: visualBrief?.quality || null, sourceAsset: routed?.record || null }\n",
    'visual revision stores source provenance'
  );
  write(rel, s);
}

function patchSceneRepair() {
  const rel = 'utils/scene-repair-service.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { SceneNarrationV3 } = require('./scene-narration-v3');\n",
    "const { SceneNarrationV3 } = require('./scene-narration-v3');\nconst { VisualAssetRouterV8 } = require('./visual-router-v8');\n",
    'scene repair visual router import'
  );
  s = replaceOnce(
    s,
    "    this.sceneNarration = new SceneNarrationV3(videoGenerator, { logger: this.logger, dataRoot: this.dataRoot });\n",
    "    this.sceneNarration = new SceneNarrationV3(videoGenerator, { logger: this.logger, dataRoot: this.dataRoot });\n    this.visualRouter = options.visualRouter || new VisualAssetRouterV8(db, { logger: this.logger, dataRoot: this.dataRoot });\n",
    'scene repair visual router construction'
  );

  const oldImage = `        const assets = await this.videoGenerator.generateVisualAssets(scene.prompt, 'ethereal', 1);\n        const assetPath = assets[0];\n        if (!assetPath || !IMAGE_EXTENSIONS.has(path.extname(assetPath).toLowerCase()) || !await this.pathExists(assetPath)) {\n          throw this.error('No real replacement image was generated; configure an image provider or upload an asset', 422, 'SCENE_ASSET_UNAVAILABLE');\n        }\n        visual = { assetType: 'image', assetOrigin: 'generated', assetPath, provider: 'image-provider', model: null, externalTaskId: null, containsSyntheticMedia: true };`;
  const newImage = `        const visualBrief = bundle.assets?.sceneManifest?.visualBriefs?.[scene.id] || {\n          subject: scene.label, sceneLabel: scene.label, sceneText: scene.scriptText, visualType: 'documentary_explainer', details: []\n        };\n        const routed = await this.visualRouter.resolve({ productionId, scene, brief: visualBrief });\n        let assetPath = routed?.path || null;\n        if (!assetPath) {\n          const assets = await this.videoGenerator.generateVisualAssets(scene.prompt, visualBrief.visualType || 'ethereal', 1);\n          assetPath = assets[0];\n        }\n        if (!assetPath || !IMAGE_EXTENSIONS.has(path.extname(assetPath).toLowerCase()) || !await this.pathExists(assetPath)) {\n          throw this.error('No real replacement image was generated; configure an image provider or upload an asset', 422, 'SCENE_ASSET_UNAVAILABLE');\n        }\n        visual = routed?.path\n          ? { assetType: 'image', assetOrigin: 'licensed-source', assetPath, provider: routed.provider, model: routed.model, externalTaskId: null, rightsConfirmed: routed.rightsConfirmed === true, containsSyntheticMedia: false }\n          : { assetType: 'image', assetOrigin: 'generated', assetPath, provider: 'image-provider', model: null, externalTaskId: null, rightsConfirmed: true, containsSyntheticMedia: true };`;
  s = replaceOnce(s, oldImage, newImage, 'scene repair routes real source before AI image');

  s = replaceOnce(
    s,
    "      if (scene.assetOrigin === 'uploaded' && !scene.rightsConfirmed) missing.push(`${scene.label}: media rights are not confirmed`);\n",
    "      if (['uploaded', 'licensed-source', 'source'].includes(scene.assetOrigin) && !scene.rightsConfirmed) missing.push(`${scene.label}: media rights are not confirmed`);\n",
    'rebuild blocks source assets with unresolved rights'
  );
  write(rel, s);
}

function patchRightsGates() {
  const rel = 'utils/operator-service.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "      const unlicensedUploads = scenes.filter(scene => scene.assetOrigin === 'uploaded' && !scene.rightsConfirmed);\n",
    "      const unlicensedMedia = scenes.filter(scene => ['uploaded', 'licensed-source', 'source'].includes(scene.assetOrigin) && !scene.rightsConfirmed);\n",
    'quality gate checks routed source rights'
  );
  s = replaceOnce(
    s,
    "      checks.push(this.check('scene_rights', unlicensedUploads.length === 0,\n        unlicensedUploads.length === 0\n          ? 'Replacement scene assets have rights confirmation'\n          : `${unlicensedUploads.length} uploaded scene asset${unlicensedUploads.length === 1 ? '' : 's'} lack rights confirmation`));",
    "      checks.push(this.check('scene_rights', unlicensedMedia.length === 0,\n        unlicensedMedia.length === 0\n          ? 'Uploaded and real-source scene assets have a recorded rights basis'\n          : `${unlicensedMedia.length} scene asset${unlicensedMedia.length === 1 ? '' : 's'} lack machine-confirmed or operator-confirmed media rights`));",
    'quality gate message for source rights'
  );
  write(rel, s);

  const shortsRel = 'utils/shorts-repurposing-service.js';
  let shorts = read(shortsRel);
  shorts = replaceOnce(
    shorts,
    "    const unlicensed = (bundle.scenes || []).filter(scene => scene.assetOrigin === 'uploaded' && !scene.rightsConfirmed);\n",
    "    const unlicensed = (bundle.scenes || []).filter(scene => ['uploaded', 'licensed-source', 'source'].includes(scene.assetOrigin) && !scene.rightsConfirmed);\n",
    'shorts inherit real-source rights gate'
  );
  write(shortsRel, shorts);
}

function patchAttributionPublishing() {
  const rel = 'index.js';
  let s = read(rel);
  const helper = `  appendMediaCredits(description, scenes = []) {\n    const base = String(description || '').trim();\n    const seen = new Set();\n    const credits = [];\n    for (const scene of scenes || []) {\n      const asset = scene.sourceAsset;\n      if (!asset?.sourcePageUrl) continue;\n      const key = asset.id || asset.sourcePageUrl;\n      if (seen.has(key)) continue;\n      seen.add(key);\n      const parts = [asset.title, asset.creator, asset.license].filter(Boolean).map(value => String(value).replace(/\\s+/g, ' ').trim());\n      const licenseUrl = asset.licenseUrl ? ` · ${asset.licenseUrl}` : '';\n      credits.push(`- ${parts.join(' — ')} · ${asset.sourcePageUrl}${licenseUrl}`.slice(0, 650));\n    }\n    if (!credits.length) return base;\n    const block = `Media credits / source assets:\\n${credits.join('\\n')}`;\n    const room = Math.max(0, 5000 - block.length - 2);\n    return `${base.slice(0, room).trim()}\\n\\n${block}`.trim().slice(0, 5000);\n  }\n\n`;
  s = insertBefore(s, '  async approveContent(productionId, input) {\n', helper, 'media attribution helper before approval');
  s = replaceOnce(
    s,
    '        description: editorData.description || bundle.seo.description,\n',
    '        description: this.appendMediaCredits(editorData.description || bundle.seo.description, bundle.scenes || []),\n',
    'append real-source media credits to YouTube description'
  );
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const anchor = "          ${visualBrief ? `<div class=\"callout visual-brief-summary\"><strong>Visual Director v7 · ${escapeHTML(visualBrief.visualType || 'scene')}</strong><p>${escapeHTML(visualBrief.subject || '')}</p><small>Specificity ${escapeHTML(visualQuality?.specificity ?? '—')}/100 · Generic-AI risk ${escapeHTML(visualQuality?.genericAiRisk ?? '—')}/100 · Evidence alignment ${escapeHTML(visualQuality?.evidenceAlignment ?? '—')}/100</small></div>` : ''}\n";
  const replacement = anchor + "          ${scene.sourceAsset ? `<div class=\"callout source-asset-summary\"><strong>Real source · ${escapeHTML(scene.sourceAsset.sourceName || scene.sourceAsset.sourceKey || 'source')}</strong><p>${escapeHTML(scene.sourceAsset.title || scene.label)}</p><small>${escapeHTML(scene.sourceAsset.license || 'rights unknown')} · rights ${escapeHTML(scene.sourceAsset.rightsStatus || 'unknown')} · relevance ${Math.round(Number(scene.sourceAsset.relevanceScore || 0) * 100)}%</small>${scene.sourceAsset.sourcePageUrl ? `<a class=\"source-link\" href=\"${escapeHTML(scene.sourceAsset.sourcePageUrl)}\" target=\"_blank\" rel=\"noopener noreferrer\">Open original source ↗</a>` : ''}</div>` : ''}\n";
  s = replaceOnce(s, anchor, replacement, 'show routed source and license in scene editor');
  write(rel, s);
}

function patchPackageAndEnv() {
  const rel = 'package.json';
  const pkg = JSON.parse(read(rel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:visual-router'] = 'node ../bootstrap/verify-phase8-visual-router.js';
  write(rel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('VISUAL_ROUTER_ENABLED=')) {
    env += `\n# Phase 8 — Visual Router + real-source media\nVISUAL_ROUTER_ENABLED=true\n# Fail-closed by default: ambiguous agency/archive rights are candidates but not selected.\nVISUAL_ROUTER_ALLOW_REVIEW_REQUIRED=false\nVISUAL_ROUTER_TIMEOUT_MS=7000\nVISUAL_ROUTER_MAX_CANDIDATES=12\nVISUAL_ROUTER_MIN_SCORE=0.34\nVISUAL_ROUTER_MAX_DOWNLOAD_BYTES=20971520\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchSceneRepair();
patchRightsGates();
patchAttributionPublishing();
patchDashboard();
patchPackageAndEnv();

console.log('Phase 8 Visual Router installed: real-source discovery, license gating, local source caching, attribution, provenance, and source-first scene generation.');
