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
  if (index === -1) throw new Error('News corroboration anchor not found: ' + label);
  return text.slice(0, index) + to + text.slice(index + from.length);
}
function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error('News corroboration anchor not found: ' + label);
  return text.slice(0, index) + block + text.slice(index);
}

let source = read('index.js');
const helper = [
  "  assertNewsResearchCorroboration(evidencePack, strategy = {}) {",
  "    if (!strategy?.requiresNewsCorroboration) return true;",
  "    const requiredDomains = new Set((strategy.newsroomCandidateDomains || []).map(value => String(value).toLowerCase()).filter(Boolean));",
  "    const verified = new Set();",
  "    for (const item of Array.isArray(evidencePack?.sources) ? evidencePack.sources : []) {",
  "      if (item?.status !== 'verified' || !String(item?.evidenceText || '').trim()) continue;",
  "      let domain = '';",
  "      try { domain = new URL(item.url).hostname.toLowerCase().replace(/^www\\./, ''); } catch (_error) {}",
  "      if (domain && (!requiredDomains.size || requiredDomains.has(domain))) verified.add(domain);",
  "    }",
  "    if (verified.size < 2) {",
  "      const error = new Error('News research candidate requires corroboration from at least 2 independent candidate domains; found ' + verified.size + '.');",
  "      error.code = 'NEWS_RESEARCH_INSUFFICIENT_CORROBORATION';",
  "      error.status = 422;",
  "      throw error;",
  "    }",
  "    return true;",
  "  }",
  "",
  ""
].join('\n');
source = insertBefore(source, "  async generateContent(topic = null, style = null, length = 'medium', options = {}) {\n", helper, 'corroboration method');
source = replaceOnce(source,
  "      generated.contentPillar = strategyContext.pillar || null;\n",
  "      generated.contentPillar = strategyContext.pillar || null;\n      generated.newsroomAction = strategyContext.newsroomAction || null;\n      generated.newsroomClusterId = strategyContext.newsroomClusterId || null;\n      generated.requiresNewsCorroboration = Boolean(strategyContext.requiresNewsCorroboration);\n      generated.newsroomCandidateDomains = Array.isArray(strategyContext.newsroomCandidateDomains) ? strategyContext.newsroomCandidateDomains : [];\n",
  'strategy metadata');
source = replaceOnce(source,
  "        generated.evidencePack = evidencePack;\n",
  "        generated.evidencePack = evidencePack;\n        this.assertNewsResearchCorroboration(evidencePack, generated);\n",
  'initial evidence gate');
source = replaceOnce(source,
  "      strategy.evidencePack = evidencePack;\n",
  "      strategy.evidencePack = evidencePack;\n      this.assertNewsResearchCorroboration(evidencePack, strategy);\n",
  'migrated evidence gate');
const logLine = "    this.logger.info(`Strategy generated: ${strategy.topic} (${strategy.researchSources.length} research source(s), evidence=${strategy.evidencePack?.status || 'legacy'})`);";
source = replaceOnce(source, logLine,
  "    this.assertNewsResearchCorroboration(strategy.evidencePack || { sources: strategy.researchSources || [] }, strategy);\n" + logLine,
  'reused checkpoint evidence gate');
write('index.js', source);

console.log('Global-news research candidates are fail-closed until two independent candidate domains are corroborated.');
