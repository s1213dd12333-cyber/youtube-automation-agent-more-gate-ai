'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');

const VERSION = 8;
const SOURCE_NAMES = Object.freeze({
  wikimedia: 'Wikimedia Commons',
  nasa: 'NASA Image and Video Library',
  loc: 'Library of Congress',
  internet_archive: 'Internet Archive',
  usgs: 'USGS ScienceBase'
});

const SOURCE_HOST_RULES = Object.freeze({
  wikimedia: ['upload.wikimedia.org'],
  nasa: ['.nasa.gov'],
  loc: ['.loc.gov'],
  internet_archive: ['archive.org', '.archive.org'],
  usgs: ['.sciencebase.gov', '.usgs.gov']
});

function clean(value, limit = 4000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function decodeHtml(value) {
  return clean(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function tokenize(value) {
  return clean(value, 12000)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3 && !new Set([
      'and','the','for','with','from','into','this','that','these','those','about','scene','visual','image','video'
    ]).has(token));
}

function overlapScore(needle, haystack) {
  const left = [...new Set(tokenize(needle))];
  const right = new Set(tokenize(haystack));
  if (!left.length || !right.size) return 0;
  return left.filter(token => right.has(token)).length / left.length;
}

function extValue(metadata, key) {
  const value = metadata?.[key];
  if (value && typeof value === 'object' && 'value' in value) return decodeHtml(value.value);
  return decodeHtml(value);
}

function classifyLicense(input = {}) {
  const source = String(input.source || '').toLowerCase();
  const label = clean(input.license || input.licenseShortName || input.rights || input.usageTerms, 500);
  const url = clean(input.licenseUrl, 1000);
  const combined = `${label} ${url} ${clean(input.rights, 1000)} ${clean(input.usageTerms, 1000)}`.toLowerCase();

  if (/public domain|publicdomain|cc0|creative commons zero|pd-usgov|pd-us/.test(combined)) {
    return { label: label || 'Public Domain', url: url || null, status: 'confirmed', autoUseEligible: true, requiresAttribution: false, reason: 'public-domain or CC0 metadata' };
  }

  const ccBy = /cc\s*by(?:\s|$|-)|creativecommons\.org\/licenses\/by\//.test(combined);
  const shareAlike = /by-sa|sharealike|share alike/.test(combined);
  const nonCommercial = /by-nc|noncommercial|non-commercial/.test(combined);
  const noDerivatives = /by-nd|no derivatives|noderivatives/.test(combined);
  if (ccBy && !shareAlike && !nonCommercial && !noDerivatives) {
    return { label: label || 'CC BY', url: url || null, status: 'confirmed', autoUseEligible: true, requiresAttribution: true, reason: 'Creative Commons Attribution metadata' };
  }

  if (shareAlike || nonCommercial || noDerivatives) {
    return { label: label || 'Creative Commons restricted variant', url: url || null, status: 'review_required', autoUseEligible: false, requiresAttribution: true, reason: 'license has ShareAlike, NonCommercial, or NoDerivatives conditions requiring operator review' };
  }

  if (source === 'nasa' || source === 'usgs') {
    return { label: label || 'U.S. agency media policy', url: url || null, status: 'review_required', autoUseEligible: false, requiresAttribution: true, reason: 'agency provenance alone does not prove that every individual asset is unrestricted' };
  }

  if (/no known restrictions/.test(combined)) {
    return { label: label || 'No known restrictions', url: url || null, status: 'review_required', autoUseEligible: false, requiresAttribution: true, reason: 'no-known-restrictions wording is not treated as a machine-verifiable license grant' };
  }

  return { label: label || 'Rights not machine-verified', url: url || null, status: 'unknown', autoUseEligible: false, requiresAttribution: true, reason: 'no supported reusable-license metadata was found' };
}

function safeRemoteUrl(source, value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return (SOURCE_HOST_RULES[source] || []).some(rule => rule.startsWith('.') ? host.endsWith(rule) : host === rule);
  } catch (_error) {
    return false;
  }
}

function preferredSources(brief = {}) {
  const type = String(brief.visualType || 'documentary_explainer');
  const text = `${brief.subject || ''} ${brief.sceneText || ''}`.toLowerCase();
  if (type === 'archival_timeline') return ['loc', 'internet_archive', 'wikimedia', 'nasa', 'usgs'];
  if (type === 'location_map') return ['usgs', 'wikimedia', 'nasa', 'loc', 'internet_archive'];
  if (/space|satellite|orbit|planet|rocket|spacecraft|nasa|telescope/.test(text)) return ['nasa', 'wikimedia', 'usgs', 'loc', 'internet_archive'];
  if (/geology|earthquake|volcano|terrain|topograph|geographic|river|coast/.test(text)) return ['usgs', 'wikimedia', 'nasa', 'loc', 'internet_archive'];
  return ['wikimedia', 'nasa', 'loc', 'internet_archive', 'usgs'];
}

function institutionalHints(brief = {}) {
  const hints = [];
  for (const evidence of brief.evidenceHints || []) {
    const publisher = clean(evidence.publisher, 120);
    if (/\b(?:NASA|NIST|NOAA|USGS|ESA|Library of Congress)\b/i.test(publisher) && !hints.includes(publisher)) hints.push(publisher);
  }
  return hints.slice(0, 2);
}

function buildQuery(brief = {}) {
  const subject = clean(brief.subject, 220);
  const details = (brief.details || []).map(item => clean(item, 100)).filter(Boolean).slice(0, 3);
  const hints = institutionalHints(brief);
  return [...hints, subject, ...details].filter(Boolean).join(' ').slice(0, 500);
}

function candidateScore(candidate, brief = {}) {
  const query = `${brief.subject || ''} ${(brief.details || []).join(' ')} ${brief.sceneLabel || ''}`;
  const candidateText = `${candidate.title || ''} ${candidate.description || ''} ${candidate.creator || ''}`;
  const lexical = overlapScore(query, candidateText);
  const sourceOrder = preferredSources(brief);
  const sourceRank = sourceOrder.indexOf(candidate.source);
  const sourceBoost = sourceRank < 0 ? 0 : Math.max(0, 0.18 - sourceRank * 0.035);
  const rightsBoost = candidate.rights?.autoUseEligible ? 0.25 : candidate.rights?.status === 'review_required' ? 0.04 : 0;
  const width = Number(candidate.width || 0);
  const height = Number(candidate.height || 0);
  const sizeBoost = width >= 1280 && height >= 720 ? 0.08 : width >= 800 ? 0.03 : 0;
  return Math.max(0, Math.min(1, Number((lexical * 0.62 + sourceBoost + rightsBoost + sizeBoost).toFixed(4))));
}

class VisualAssetRouterV8 {
  constructor(db, options = {}) {
    this.db = db || null;
    this.http = options.http || axios;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.dataRoot = options.dataRoot || path.join(__dirname, '..', 'data');
    this.enabled = options.enabled !== undefined
      ? Boolean(options.enabled)
      : String(process.env.VISUAL_ROUTER_ENABLED || 'true').toLowerCase() !== 'false';
    this.allowReviewRequired = options.allowReviewRequired !== undefined
      ? Boolean(options.allowReviewRequired)
      : String(process.env.VISUAL_ROUTER_ALLOW_REVIEW_REQUIRED || 'false').toLowerCase() === 'true';
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs || process.env.VISUAL_ROUTER_TIMEOUT_MS || 7000));
    this.maxCandidates = Math.max(3, Math.min(30, Number(options.maxCandidates || process.env.VISUAL_ROUTER_MAX_CANDIDATES || 12)));
    this.minScore = Math.max(0, Math.min(1, Number(options.minScore || process.env.VISUAL_ROUTER_MIN_SCORE || 0.34)));
    this.maxDownloadBytes = Math.max(1024 * 1024, Number(options.maxDownloadBytes || process.env.VISUAL_ROUTER_MAX_DOWNLOAD_BYTES || 20 * 1024 * 1024));
  }

  async resolve(input = {}) {
    const productionId = input.productionId;
    const scene = input.scene || {};
    const brief = input.brief || {};
    if (!this.enabled || !productionId || !scene.id || !brief.subject) return { status: 'disabled_or_incomplete', path: null };

    const query = buildQuery(brief);
    const order = preferredSources(brief);
    const adapterStatus = {};
    const settled = await Promise.all(order.map(async source => {
      try {
        const found = await this.searchSource(source, query, brief);
        adapterStatus[source] = { status: 'ok', candidates: found.length };
        return found;
      } catch (error) {
        adapterStatus[source] = { status: 'unavailable', error: clean(error.message, 300) };
        this.logger.warn(`Visual source ${source} unavailable: ${error.message}`);
        return [];
      }
    }));

    const candidates = settled.flat().map(candidate => {
      const rights = classifyLicense({ ...candidate, source: candidate.source });
      const normalized = { ...candidate, rights };
      return { ...normalized, score: candidateScore(normalized, brief) };
    }).filter(candidate => safeRemoteUrl(candidate.source, candidate.mediaUrl));

    candidates.sort((a, b) => b.score - a.score || Number(b.rights.autoUseEligible) - Number(a.rights.autoUseEligible));
    const eligible = candidates.filter(candidate =>
      candidate.score >= this.minScore && (candidate.rights.autoUseEligible || (this.allowReviewRequired && candidate.rights.status === 'review_required'))
    );
    const selected = eligible[0];
    if (!selected) {
      this.logger.info(`Visual Router v8 found no rights-safe real asset for ${scene.label || scene.id}; falling back to generated/local visual.`);
      return {
        status: 'no_eligible_match', path: null, query, adapterStatus,
        candidateCount: candidates.length,
        topCandidates: candidates.slice(0, 5).map(item => this.candidateSummary(item))
      };
    }

    const directory = path.join(this.dataRoot, 'assets', 'source-v8', String(productionId));
    await fs.mkdir(directory, { recursive: true });
    const outputPath = path.join(directory, `${String(scene.position ?? 0).padStart(3, '0')}_${scene.id}_${selected.source}.png`);
    await this.downloadAndNormalize(selected, outputPath);

    const record = {
      id: `visual_asset_${hash(`${productionId}\u0000${scene.id}\u0000${selected.source}\u0000${selected.id || selected.mediaUrl}`).slice(0, 24)}`,
      productionId,
      sceneId: scene.id,
      routerVersion: VERSION,
      sourceName: SOURCE_NAMES[selected.source] || selected.source,
      sourceKey: selected.source,
      sourceAssetId: selected.id || null,
      sourcePageUrl: selected.sourcePageUrl || null,
      mediaUrl: selected.mediaUrl,
      localPath: outputPath,
      title: selected.title || scene.label || null,
      creator: selected.creator || null,
      license: selected.rights.label,
      licenseUrl: selected.rights.url,
      attribution: selected.attribution || selected.creator || selected.title || null,
      rightsStatus: selected.rights.status,
      rightsConfirmed: selected.rights.autoUseEligible,
      requiresAttribution: selected.rights.requiresAttribution,
      relevanceScore: selected.score,
      query,
      metadata: {
        adapterStatus,
        visualType: brief.visualType || null,
        rightsReason: selected.rights.reason,
        width: selected.width || null,
        height: selected.height || null,
        mime: selected.mime || null,
        sourceMetadata: selected.metadata || {}
      }
    };
    if (this.db?.saveVisualAssetRecord) await this.db.saveVisualAssetRecord(record);
    this.logger.info(`Visual Router v8 selected ${record.sourceName} for ${scene.label || scene.id} (${record.license}, score=${record.relevanceScore}).`);
    return {
      status: 'selected', path: outputPath, provider: `source:${selected.source}`, model: record.license,
      assetOrigin: 'licensed-source', rightsConfirmed: record.rightsConfirmed,
      containsSyntheticMedia: false, record, query, adapterStatus
    };
  }

  candidateSummary(candidate) {
    return {
      source: candidate.source,
      id: candidate.id || null,
      title: candidate.title || null,
      sourcePageUrl: candidate.sourcePageUrl || null,
      license: candidate.rights?.label || null,
      rightsStatus: candidate.rights?.status || 'unknown',
      score: candidate.score
    };
  }

  async searchSource(source, query, brief) {
    if (source === 'wikimedia') return this.searchWikimedia(query, brief);
    if (source === 'nasa') return this.searchNASA(query, brief);
    if (source === 'loc') return this.searchLOC(query, brief);
    if (source === 'internet_archive') return this.searchInternetArchive(query, brief);
    if (source === 'usgs') return this.searchUSGS(query, brief);
    return [];
  }

  async searchWikimedia(query) {
    const response = await this.http.get('https://commons.wikimedia.org/w/api.php', {
      timeout: this.timeoutMs,
      headers: { 'User-Agent': 'LumenAtlas/1.0 (media provenance; https://github.com/s1213dd12333-cyber/youtube-automation-agent-more-gate-ai)' },
      params: {
        action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: query,
        gsrnamespace: 6, gsrlimit: Math.min(10, this.maxCandidates), prop: 'imageinfo|info', inprop: 'url',
        iiprop: 'url|mime|size|extmetadata', iiurlwidth: 1600
      }
    });
    return Object.values(response.data?.query?.pages || {}).flatMap(page => {
      const info = page.imageinfo?.[0];
      if (!info?.url) return [];
      const ext = info.extmetadata || {};
      return [{
        source: 'wikimedia', id: String(page.pageid || page.title), title: clean(page.title?.replace(/^File:/, ''), 300),
        description: extValue(ext, 'ImageDescription'), creator: extValue(ext, 'Artist') || extValue(ext, 'Credit'),
        license: extValue(ext, 'LicenseShortName'), licenseUrl: extValue(ext, 'LicenseUrl'),
        usageTerms: extValue(ext, 'UsageTerms'), rights: extValue(ext, 'Restrictions'),
        attribution: extValue(ext, 'Credit') || extValue(ext, 'Artist'),
        sourcePageUrl: page.fullurl || `https://commons.wikimedia.org/?curid=${page.pageid}`,
        mediaUrl: info.thumburl || info.url, width: Number(info.thumbwidth || info.width || 0), height: Number(info.thumbheight || info.height || 0),
        mime: info.mime || null, metadata: { originalUrl: info.url }
      }];
    });
  }

  async searchNASA(query, brief = {}) {
    const text = `${query} ${brief.sceneText || ''}`.toLowerCase();
    if (!/space|satellite|orbit|planet|rocket|spacecraft|nasa|telescope|earth|moon|mars|sun/.test(text)) return [];
    const response = await this.http.get('https://images-api.nasa.gov/search', {
      timeout: this.timeoutMs,
      params: { q: query, media_type: 'image', page_size: Math.min(10, this.maxCandidates) }
    });
    return (response.data?.collection?.items || []).flatMap(item => {
      const data = item.data?.[0] || {};
      const link = (item.links || []).find(entry => entry.render === 'image') || item.links?.[0];
      if (!link?.href) return [];
      const id = data.nasa_id || item.href || data.title;
      return [{
        source: 'nasa', id, title: clean(data.title, 300), description: clean(data.description || data.description_508, 1500),
        creator: data.photographer || data.center || 'NASA', license: 'NASA media usage policy',
        licenseUrl: 'https://www.nasa.gov/nasa-brand-center/images-and-media/', usageTerms: 'Agency media policy review required',
        attribution: data.photographer || data.center || 'NASA', sourcePageUrl: id ? `https://images.nasa.gov/details/${encodeURIComponent(id)}` : 'https://images.nasa.gov/',
        mediaUrl: link.href, width: null, height: null, mime: 'image/jpeg', metadata: { center: data.center || null, dateCreated: data.date_created || null }
      }];
    });
  }

  async searchLOC(query, brief = {}) {
    if (!/archival|timeline|history|historical|manuscript|war|century|archive/.test(String(brief.visualType || '') + ' ' + String(brief.sceneText || '').toLowerCase())) return [];
    const response = await this.http.get('https://www.loc.gov/pictures/', {
      timeout: this.timeoutMs,
      headers: { Accept: 'application/json', 'User-Agent': 'LumenAtlas/1.0 media provenance' },
      params: { fo: 'json', q: query, c: Math.min(10, this.maxCandidates) }
    });
    return (response.data?.results || []).flatMap(item => {
      const image = Array.isArray(item.image_url) ? item.image_url[item.image_url.length - 1] : item.image_url;
      if (!image) return [];
      const rights = clean([...(item.rights || []), ...(item.rights_advisory || [])].join(' '), 1200);
      return [{
        source: 'loc', id: item.id || item.control_number || item.url, title: clean(item.title, 300),
        description: clean(item.description?.join?.(' ') || item.notes?.join?.(' '), 1500), creator: clean(item.contributor?.join?.(', ') || item.creator, 300),
        license: rights || 'Library of Congress rights statement', licenseUrl: item.rights_url || null, rights,
        attribution: clean(item.contributor?.join?.(', ') || item.title, 400), sourcePageUrl: item.id || item.url || null,
        mediaUrl: image, width: null, height: null, mime: 'image/jpeg', metadata: { date: item.date || null }
      }];
    });
  }

  async searchInternetArchive(query, brief = {}) {
    if (!/archival|timeline|history|historical|manuscript|archive/.test(String(brief.visualType || '') + ' ' + String(brief.sceneText || '').toLowerCase())) return [];
    const response = await this.http.get('https://archive.org/advancedsearch.php', {
      timeout: this.timeoutMs,
      params: { q: `mediatype:image AND (${query})`, fl: ['identifier','title','description','creator','licenseurl'], rows: Math.min(4, this.maxCandidates), page: 1, output: 'json' }
    });
    const output = [];
    for (const doc of response.data?.response?.docs || []) {
      if (!doc.identifier) continue;
      try {
        const meta = await this.http.get(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`, { timeout: this.timeoutMs });
        const file = (meta.data?.files || []).find(entry => /^(JPEG|PNG|JPEG Thumb|Item Tile)/i.test(entry.format || '') && entry.name && !/thumb|__ia_thumb/i.test(entry.name));
        if (!file) continue;
        output.push({
          source: 'internet_archive', id: doc.identifier, title: clean(doc.title, 300), description: clean(doc.description, 1500), creator: clean(doc.creator, 300),
          license: clean(doc.licenseurl || meta.data?.metadata?.licenseurl, 500), licenseUrl: clean(doc.licenseurl || meta.data?.metadata?.licenseurl, 1000),
          attribution: clean(doc.creator || doc.title, 400), sourcePageUrl: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
          mediaUrl: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${String(file.name).split('/').map(encodeURIComponent).join('/')}`,
          width: Number(file.width || 0), height: Number(file.height || 0), mime: /png/i.test(file.format || '') ? 'image/png' : 'image/jpeg', metadata: { file: file.name }
        });
      } catch (error) {
        this.logger.warn(`Internet Archive metadata unavailable for ${doc.identifier}: ${error.message}`);
      }
    }
    return output;
  }

  async searchUSGS(query, brief = {}) {
    const text = `${brief.visualType || ''} ${brief.sceneText || ''}`.toLowerCase();
    if (!/location_map|geolog|earthquake|volcano|terrain|topograph|river|coast|landscape|mountain/.test(text)) return [];
    const response = await this.http.get('https://www.sciencebase.gov/catalog/items', {
      timeout: this.timeoutMs,
      headers: { Accept: 'application/json', 'User-Agent': 'LumenAtlas/1.0 media provenance' },
      params: { q: query, format: 'json', max: Math.min(5, this.maxCandidates) }
    });
    const output = [];
    for (const item of response.data?.items || []) {
      if (!item.id) continue;
      try {
        const detail = await this.http.get(`https://www.sciencebase.gov/catalog/item/${encodeURIComponent(item.id)}`, {
          timeout: this.timeoutMs, params: { format: 'json' }, headers: { Accept: 'application/json' }
        });
        const file = (detail.data?.files || []).find(entry => /^image\//i.test(entry.contentType || '') && entry.downloadUri);
        if (!file) continue;
        output.push({
          source: 'usgs', id: item.id, title: clean(item.title, 300), description: clean(item.body || item.summary, 1500),
          creator: clean(item.provenance?.createdBy || 'USGS', 300), license: 'USGS/ScienceBase source — rights review required',
          licenseUrl: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
          attribution: clean(item.provenance?.createdBy || 'USGS', 400), sourcePageUrl: item.link?.url || `https://www.sciencebase.gov/catalog/item/${item.id}`,
          mediaUrl: file.downloadUri, width: null, height: null, mime: file.contentType || null, metadata: { file: file.name || null }
        });
      } catch (error) {
        this.logger.warn(`USGS ScienceBase detail unavailable for ${item.id}: ${error.message}`);
      }
    }
    return output;
  }

  async downloadAndNormalize(candidate, outputPath) {
    if (!safeRemoteUrl(candidate.source, candidate.mediaUrl)) throw new Error(`Blocked media host for ${candidate.source}`);
    const response = await this.http.get(candidate.mediaUrl, {
      timeout: Math.max(this.timeoutMs, 12000), responseType: 'arraybuffer', maxContentLength: this.maxDownloadBytes, maxBodyLength: this.maxDownloadBytes,
      headers: { 'User-Agent': 'LumenAtlas/1.0 media provenance' }
    });
    const buffer = Buffer.from(response.data);
    if (!buffer.length || buffer.length > this.maxDownloadBytes) throw new Error('Source image download is empty or exceeds the configured size limit');
    await sharp(buffer, { failOn: 'error' })
      .rotate()
      .resize(1280, 720, { fit: 'contain', background: { r: 9, g: 13, b: 20, alpha: 1 }, withoutEnlargement: false })
      .png({ compressionLevel: 9 })
      .toFile(outputPath);
    return outputPath;
  }
}

module.exports = {
  VISUAL_ROUTER_VERSION: VERSION,
  SOURCE_NAMES,
  classifyLicense,
  safeRemoteUrl,
  preferredSources,
  institutionalHints,
  buildQuery,
  candidateScore,
  VisualAssetRouterV8
};
