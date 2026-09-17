'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const runtimePath = path.join(upstream, 'utils', 'global-news-radar-v121.js');
const envPath = path.join(upstream, '.env.example');

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n'); }
function write(file, value) { fs.writeFileSync(file, value.replace(/\r\n/g, '\n'), 'utf8'); }
function replaceOnce(source, from, to, label) {
  if (source.includes(to)) return source;
  const index = source.indexOf(from);
  if (index === -1) throw new Error(`Newsroom default RSS anchor not found: ${label}`);
  return source.slice(0, index) + to + source.slice(index + from.length);
}

let source = read(runtimePath);
source = replaceOnce(
  source,
  "    this.rssSources = options.rssSources || parseJsonEnv('NEWSROOM_RSS_SOURCES_JSON', defaultRssSources);\n",
  "    const configuredRssSources = parseJsonEnv('NEWSROOM_RSS_SOURCES_JSON', []);\n    const builtInRssEnabled = String(process.env.NEWSROOM_DEFAULT_RSS_ENABLED || 'true').toLowerCase() !== 'false';\n    this.rssSources = options.rssSources || [...(builtInRssEnabled ? defaultRssSources : []), ...configuredRssSources];\n",
  'empty custom RSS list must not disable built-in fallbacks'
);
source = replaceOnce(
  source,
  "    const multiplier = shouldOpen ? Math.min(4, Math.pow(2, Math.max(0, consecutiveFailures - this.sourceFailureThreshold))) : 0;\n",
  "    const multiplier = shouldOpen ? 1 : 0;\n",
  'fixed circuit cooldown for shared GDELT backend'
);
write(runtimePath, source);

let env = read(envPath);
if (!env.includes('NEWSROOM_DEFAULT_RSS_ENABLED=')) {
  env += '\n# Built-in direct RSS fallbacks remain active even when NEWSROOM_RSS_SOURCES_JSON=[]\nNEWSROOM_DEFAULT_RSS_ENABLED=true\n';
}
write(envPath, env);

console.log('Newsroom built-in RSS fallback semantics active: NEWSROOM_RSS_SOURCES_JSON adds custom feeds; NEWSROOM_DEFAULT_RSS_ENABLED controls the built-in fallback set.');
