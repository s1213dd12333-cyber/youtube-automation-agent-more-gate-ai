'use strict';

const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const file = rel => path.join(upstream, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (rel, text) => fs.writeFileSync(file(rel), text.replace(/\r\n/g, '\n'), 'utf8');

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  const index = text.indexOf(from);
  if (index === -1) throw new Error(`Anchor not found for ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function replaceRegex(text, regex, replacement, label) {
  if (typeof replacement === 'string' && text.includes(replacement)) return text;
  if (!regex.test(text)) throw new Error(`Regex anchor not found for ${label}`);
  return text.replace(regex, replacement);
}

// 1) Research before scripting: add a keyless baseline researcher using public
// Wikipedia + Crossref APIs. Sources are availability-verified but claims still
// require provenance review before approval.
{
  const rel = 'agents/content-strategy-agent.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { AITextService } = require('../utils/ai-text-service');\n",
    "const { AITextService } = require('../utils/ai-text-service');\nconst axios = require('axios');\n",
    'content strategy axios import'
  );

  const marker = '  async generateContentStrategy(requestedTopic = null) {';
  const method = `  async researchTopicSources(topic) {\n    const query = String(topic || '').trim();\n    if (!query) return [];\n    const sources = [];\n    const seen = new Set();\n    const add = source => {\n      if (!source?.url || seen.has(source.url)) return;\n      seen.add(source.url);\n      sources.push({ ...source, status: 'verified', accessedAt: new Date().toISOString() });\n    };\n\n    try {\n      const wiki = await axios.get('https://en.wikipedia.org/w/api.php', {\n        timeout: 8000,\n        params: { action: 'query', list: 'search', srsearch: query, format: 'json', origin: '*', srlimit: 3 }\n      });\n      for (const item of wiki.data?.query?.search || []) {\n        add({\n          url: \`https://en.wikipedia.org/wiki/\${encodeURIComponent(String(item.title).replace(/ /g, '_'))}\`,\n          title: item.title,\n          publisher: 'Wikipedia',\n          sourceType: 'article',\n          notes: 'Automatically discovered baseline source; factual claims still require evidence review.'\n        });\n      }\n    } catch (error) {\n      this.logger.warn(\`Wikipedia research unavailable for "\${query}": \${error.message}\`);\n    }\n\n    try {\n      const crossref = await axios.get('https://api.crossref.org/works', {\n        timeout: 8000,\n        headers: { 'User-Agent': 'LumenAtlas/1.0 (research provenance)' },\n        params: { query, rows: 3, select: 'DOI,title,publisher,published,URL' }\n      });\n      for (const item of crossref.data?.message?.items || []) {\n        const url = item.URL || (item.DOI ? \`https://doi.org/\${item.DOI}\` : null);\n        if (!url) continue;\n        const dateParts = item.published?.['date-parts']?.[0];\n        const publishedAt = Array.isArray(dateParts) && dateParts[0]\n          ? new Date(Date.UTC(dateParts[0], Math.max(0, (dateParts[1] || 1) - 1), dateParts[2] || 1)).toISOString()\n          : null;\n        add({\n          url,\n          title: Array.isArray(item.title) ? item.title[0] : (item.title || url),\n          publisher: item.publisher || 'Crossref',\n          publishedAt,\n          sourceType: 'article',\n          notes: 'Crossref-indexed research source; claim support must match the cited work.'\n        });\n      }\n    } catch (error) {\n      this.logger.warn(\`Crossref research unavailable for "\${query}": \${error.message}\`);\n    }\n\n    this.logger.info(\`Research baseline found \${sources.length} source(s) for: \${query}\`);\n    return sources.slice(0, 6);\n  }\n\n`;
  if (!s.includes('async researchTopicSources(topic)')) {
    s = replaceOnce(s, marker, method + marker, 'topic research method');
  }
  write(rel, s);
}

// Insert the research pass between strategy and script generation for manual jobs
// and as a fallback when the autonomous planner supplied no usable sources.
{
  const rel = 'index.js';
  let s = read(rel);
  const from = `    this.logger.info(\`Strategy generated: \${strategy.topic}\`);\n\n    // Step 2: Script Writing`;
  const to = `    if (!Array.isArray(strategy.researchSources) || strategy.researchSources.length === 0) {\n      strategy.researchSources = await this.agents.strategy.researchTopicSources(strategy.topic);\n    }\n    this.logger.info(\`Strategy generated: \${strategy.topic} (\${strategy.researchSources.length} research source(s))\`);\n\n    // Step 2: Script Writing`;
  s = replaceOnce(s, from, to, 'research before script stage');

  // 8) Prevent re-queuing a topic that already completed in the last 90 days.
  const dupFrom = `    const job = await this.db.createGenerationJob({\n      ...validation.value,\n      source: input.source || 'manual'\n    });`;
  const dupTo = `    const normalizedSource = input.source || 'manual';\n    if (validation.value.topic && !['retry'].includes(normalizedSource)) {\n      const previous = await this.db.getRow(\n        \`SELECT id, completed_at FROM generation_jobs\n         WHERE lower(trim(topic)) = lower(trim(?))\n         AND status = 'completed'\n         AND created_at >= datetime('now', '-90 days')\n         ORDER BY completed_at DESC LIMIT 1\`,\n        [validation.value.topic]\n      );\n      if (previous) {\n        const error = new Error('This exact topic already completed in the last 90 days. Choose a distinct angle or topic.');\n        error.status = 409;\n        throw error;\n      }\n    }\n\n    const job = await this.db.createGenerationJob({\n      ...validation.value,\n      source: normalizedSource\n    });`;
  s = replaceOnce(s, dupFrom, dupTo, 'completed topic generation guard');
  write(rel, s);
}

// 2,3,4) Ground claims, remove false-authority language, and make conclusions
// topic-specific instead of tutorial boilerplate.
{
  const rel = 'agents/script-writer-agent.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    'Avoid fabricated statistics, unsupported claims, and fake urgency. List every externally verifiable factual claim in claims. Use only exact URLs from Research sources; use an empty sourceUrls array when the supplied sources do not support a claim.`;',
    'Avoid fabricated statistics, unsupported claims, fake urgency, invented personal experience, invented research effort, or claims such as "I spent months researching". Never imply first-hand work, interviews, experiments, or expertise that did not occur. List every externally verifiable factual claim in claims. Every factual claim should cite one or more exact URLs from Research sources when supported; otherwise keep sourceUrls empty so provenance blocks approval. The conclusion must summarize this specific topic and its remaining uncertainty; never use generic tutorial phrases such as "practical steps", "long-term success", or "journey, not a destination" unless they genuinely fit the topic.`;',
    'script factual safety prompt'
  );

  s = replaceRegex(
    s,
    /  getCredibilityStatement\(_strategy\) \{[\s\S]*?\n  \}\n\n  async generateMainContent/,
    `  getCredibilityStatement(strategy) {\n    const sourceCount = Array.isArray(strategy.researchSources) ? strategy.researchSources.length : 0;\n    return sourceCount\n      ? \`This explanation is built from \${sourceCount} research source\${sourceCount === 1 ? '' : 's'} that are tracked for review.\`\n      : 'We will separate established facts, open questions, and hypotheses as clearly as possible.';\n  }\n\n  async generateMainContent`,
    'non-fabricated credibility statement'
  );

  s = replaceRegex(
    s,
    /  async generateConclusion\(strategy\) \{[\s\S]*?\n  \}\n\n  async generateCTA/,
    `  async generateConclusion(strategy) {\n    const type = String(strategy.contentType || 'Explainer').toLowerCase();\n    const uncertainty = type === 'explainer' || type === 'story'\n      ? 'Separate what is established from what remains uncertain, and leave the viewer with the most important unresolved question.'\n      : 'Recap only the conclusions actually supported by the script.';\n    return {\n      type: 'conclusion',\n      title: 'What We Know — and What Remains Open',\n      summary: \`To close, return specifically to \${strategy.topic} and summarize the evidence presented in this video.\`,\n      keyPoints: [\n        \`Restate the strongest supported takeaway about \${strategy.topic}.\`,\n        uncertainty,\n        'Do not introduce new facts, statistics, steps, applications, or claims in the conclusion.'\n      ],\n      finalThought: \`The value of this story is understanding both the evidence around \${strategy.topic} and the limits of what can currently be claimed.\`,\n      duration: '30 seconds'\n    };\n  }\n\n  async generateCTA`,
    'topic-specific conclusion'
  );
  write(rel, s);
}

// 5,6) Replace placeholder .info visuals with a real local renderer and add a
// Gemini image quota circuit breaker. Gemini TTS remains independent.
{
  const rel = 'utils/ai-video-generator.js';
  let s = read(rel);

  s = replaceOnce(
    s,
    "    this.lastNarrationResult = null;\n",
    "    this.lastNarrationResult = null;\n    this.geminiImageDisabledReason = null;\n",
    'image circuit breaker state'
  );

  s = replaceRegex(
    s,
    /  async generateImage\(prompt, imagePath\) \{[\s\S]*?\n  \}\n\n  async generateOpenAIImage/,
    `  async generateImage(prompt, imagePath) {\n    await fs.mkdir(path.dirname(imagePath), { recursive: true });\n\n    if (this.openai) {\n      return await this.generateOpenAIImage(prompt, imagePath);\n    }\n\n    if (this.gemini && !this.geminiImageDisabledReason) {\n      try {\n        return await this.generateGeminiImage(prompt, imagePath);\n      } catch (error) {\n        if (!this.isGeminiImageQuotaZeroError(error)) throw error;\n        this.geminiImageDisabledReason = 'Gemini image free-tier quota is zero for this run';\n        this.logger.warn(\`Gemini Images disabled for this run after quota=0 response; switching to local renderer.\`);\n      }\n    }\n\n    return this.generateLocalImage(prompt, imagePath);\n  }\n\n  isGeminiImageQuotaZeroError(error) {\n    const message = String(error?.message || error || '');\n    return message.includes('RESOURCE_EXHAUSTED') &&\n      message.includes('gemini-3.1-flash-image') &&\n      /limit:\\s*0/i.test(message);\n  }\n\n  async generateLocalImage(prompt, imagePath) {\n    const width = 1280;\n    const height = 720;\n    const safe = String(prompt || '').replace(/[<&>]/g, ' ').slice(0, 180);\n    const svg = \`<svg width="\${width}" height="\${height}" xmlns="http://www.w3.org/2000/svg">\n      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#07111f"/><stop offset="1" stop-color="#243b64"/></linearGradient></defs>\n      <rect width="100%" height="100%" fill="url(#g)"/>\n      <circle cx="1040" cy="140" r="180" fill="#ffffff" opacity="0.08"/>\n      <circle cx="180" cy="610" r="260" fill="#ffffff" opacity="0.05"/>\n      <text x="70" y="600" width="1140" fill="#ffffff" opacity="0.9" font-family="Arial, sans-serif" font-size="28">\${safe}</text>\n    </svg>\`;\n    await sharp(Buffer.from(svg)).png().toFile(imagePath);\n    return imagePath;\n  }\n\n  async generateOpenAIImage`,
    'visual provider router and circuit breaker'
  );

  s = replaceRegex(
    s,
    /  async simulateVisualAssets\(prompt, style, count\) \{[\s\S]*?\n  \}\n\n  async simulateVideoGeneration/,
    `  async simulateVisualAssets(prompt, style, count) {\n    this.logger.info(\`Rendering \${count} local visual asset(s) without provider cost...\`);\n    const paths = [];\n    for (let i = 0; i < count; i++) {\n      const assetPath = path.join(__dirname, '..', 'data', 'assets', \`visual_local_\${Date.now()}_\${i}.png\`);\n      await fs.mkdir(path.dirname(assetPath), { recursive: true });\n      await this.generateLocalImage(\`\${prompt}. Style: \${style}\`, assetPath);\n      paths.push(assetPath);\n    }\n    return paths;\n  }\n\n  async simulateVideoGeneration`,
    'real local visual fallback'
  );

  s = replaceRegex(
    s,
    /  async simulateThumbnailGeneration\(script, style\) \{[\s\S]*?\n  \}\n/,
    `  async simulateThumbnailGeneration(script, style) {\n    this.logger.info('Rendering local fallback thumbnail...');\n    const thumbnailPath = path.join(__dirname, '..', 'uploads', 'thumbnails', \`thumbnail_local_\${Date.now()}.png\`);\n    await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });\n    await this.generateLocalImage(\`YouTube thumbnail: \${script.title}. Style: \${style}\`, thumbnailPath);\n    const metadata = await sharp(thumbnailPath).metadata();\n    return {\n      path: thumbnailPath,\n      dimensions: { width: metadata.width, height: metadata.height },\n      fileSize: await this.getFileSize(thumbnailPath),\n      provider: 'local-renderer',\n      simulated: false\n    };\n  }\n`,
    'real local thumbnail fallback'
  );
  write(rel, s);
}

// 2,8) Make missing claim citations explicit and base duplicate review on
// completed generation jobs rather than repeated strategy rows from retries.
{
  const rel = 'utils/operator-service.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "    const topic = String(production.strategy?.topic || '').trim();\n",
    "    const declaredClaims = Array.isArray(production.script?.claims) ? production.script.claims : [];\n    const uncitedClaims = declaredClaims.filter(claim => !Array.isArray(claim.sourceUrls) || claim.sourceUrls.length === 0);\n    checks.push(this.check('claim_sources', uncitedClaims.length === 0,\n      uncitedClaims.length === 0\n        ? `${declaredClaims.length} declared factual claim${declaredClaims.length === 1 ? '' : 's'} include source links`\n        : `${uncitedClaims.length} factual claim${uncitedClaims.length === 1 ? '' : 's'} lack a research source and must be reviewed`));\n\n    const topic = String(production.strategy?.topic || '').trim();\n",
    'claim source quality gate'
  );

  s = replaceRegex(
    s,
    /      const duplicates = await this\.db\.getRow\([\s\S]*?const unique = Number\(duplicates\?\.count \|\| 0\) <= 1;/,
    `      const duplicates = await this.db.getRow(\n        \`SELECT COUNT(*) AS count FROM generation_jobs\n         WHERE lower(trim(topic)) = lower(trim(?))\n         AND status = 'completed'\n         AND created_at >= datetime('now', '-90 days')\`,\n        [topic]\n      );\n      const unique = Number(duplicates?.count || 0) === 0;`,
    'duplicate quality review query'
  );
  write(rel, s);
}

console.log('Production hardening applied: research, grounding, anti-hallucination, conclusions, visual fallback, quota breaker, provenance, duplicate guard.');
