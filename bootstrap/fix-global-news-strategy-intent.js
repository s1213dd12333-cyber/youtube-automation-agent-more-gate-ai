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
  if (index === -1) throw new Error('News strategy anchor not found: ' + label);
  return text.slice(0, index) + to + text.slice(index + from.length);
}
function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error('News strategy anchor not found: ' + label);
  return text.slice(0, index) + block + text.slice(index);
}

let source = read('index.js');
const helper = [
  "  normalizeNewsStrategyIntent(strategy = {}) {",
  "    const text = [strategy.objective, strategy.audience, strategy.valueProposition, strategy.constraints, ...(strategy.contentPillars || [])].filter(Boolean).join(' ').toLowerCase();",
  "    const isNews = /\\b(global news|world news|breaking news|current events|world events|global developments|major world events|news channel|newsroom)\\b/.test(text);",
  "    if (!isNews) return strategy;",
  "    const canonicalPillars = ['World News','Global Affairs','Science and Technology','Economy and Business','Natural Disasters and Extreme Weather','Public Health and Environment','International Conflicts and Diplomacy','Major Elections and Government Developments'];",
  "    const legacy = new Set(['science mysteries','future technology','hidden history','space and universe','unexplained phenomena','human psychology','extraordinary places','surprising facts']);",
  "    const currentPillars = Array.isArray(strategy.contentPillars) ? strategy.contentPillars : [];",
  "    const hasNewsPillar = currentPillars.some(pillar => /news|global affairs|econom|business|technology|health|environment|diplom|conflict|election|government|weather|disaster/i.test(String(pillar)));",
  "    const onlyLegacy = currentPillars.length > 0 && currentPillars.every(pillar => legacy.has(String(pillar).trim().toLowerCase()));",
  "    if (!hasNewsPillar || onlyLegacy) strategy.contentPillars = canonicalPillars;",
  "    const cadenceIntent = [strategy.objective, strategy.constraints].filter(Boolean).join(' ').toLowerCase();",
  "    const everyTwoHours = /\\b(?:every|cada)\\s+(?:2|two|duas)\\s*(?:hours|horas)\\b|\\b2[- ]hour\\b/.test(cadenceIntent);",
  "    if (everyTwoHours) { strategy.cadencePerWeek = 84; strategy.videosPerRun = 1; }",
  "    else if (Number(strategy.cadencePerWeek || 0) > 7 && Number(strategy.videosPerRun || 1) > 1) strategy.videosPerRun = 1;",
  "    return strategy;",
  "  }",
  "",
  ""
].join('\n');
source = insertBefore(source, "  validateChannelStrategy(body = {}, current = {}) {\n", helper, 'normalizer');
source = replaceOnce(source,
  "        const strategy = this.validateChannelStrategy(req.body || {}, current);",
  "        const strategy = this.normalizeNewsStrategyIntent(this.validateChannelStrategy(req.body || {}, current));",
  'save normalization');
source = replaceOnce(source,
  "        const strategy = this.validateChannelStrategy({ ...(req.body || {}), status: 'active' }, current);",
  "        const strategy = this.normalizeNewsStrategyIntent(this.validateChannelStrategy({ ...(req.body || {}), status: 'active' }, current));",
  'start normalization');
write('index.js', source);

let html = read('dashboard/index.html');
const oldCallout = '<p class="callout">The operator uses YouTube trend signals, configured competitors, and channel history. Publishing still obeys your quality, factual-review, rights, and approval gates.</p>';
const newCallout = '<p class="callout">The operator uses YouTube trend signals, configured competitors, channel history, and Global Newsroom. Global-news intent is normalized to fresh news pillars and cadence. Verified assignments are preferred; research candidates still must pass deep Research + Evidence verification before scripting.</p>';
html = replaceOnce(html, oldCallout, newCallout, 'dashboard explanation');
write('dashboard/index.html', html);

console.log('Global-news strategy intent normalization active.');
