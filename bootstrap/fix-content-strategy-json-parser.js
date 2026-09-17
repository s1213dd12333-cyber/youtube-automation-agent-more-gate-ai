'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const target = path.join(upstream, 'agents', 'content-strategy-agent.js');

let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const start = source.indexOf('  parseAIJsonResponse(response) {');
const end = source.indexOf('  normalizeContentType(contentType, topic) {', start);
if (start === -1 || end === -1) throw new Error('ContentStrategy JSON parser anchors not found');

const replacement = `  parseAIJsonResponse(response) {\n    const raw = String(response || '').trim();\n    const text = raw\n      .replace(/^\\uFEFF/, '')\n      .replace(/^\\`\\`\\`(?:json)?\\s*/i, '')\n      .replace(/\\`\\`\\`\\s*$/i, '')\n      .trim();\n\n    const tryParse = value => {\n      try { return { ok: true, value: JSON.parse(value) }; } catch (error) { return { ok: false, error }; }\n    };\n\n    const direct = tryParse(text);\n    if (direct.ok) return direct.value;\n\n    const extractBalancedJson = input => {\n      let startIndex = -1;\n      let opener = '';\n      let closer = '';\n      let depth = 0;\n      let inString = false;\n      let escaped = false;\n\n      for (let i = 0; i < input.length; i += 1) {\n        const ch = input[i];\n        if (startIndex === -1) {\n          if (ch === '{' || ch === '[') {\n            startIndex = i; opener = ch; closer = ch === '{' ? '}' : ']'; depth = 1;\n          }\n          continue;\n        }\n\n        if (inString) {\n          if (escaped) { escaped = false; continue; }\n          if (ch === '\\\\') { escaped = true; continue; }\n          if (ch === '"') inString = false;\n          continue;\n        }\n\n        if (ch === '"') { inString = true; continue; }\n        if (ch === opener) depth += 1;\n        else if (ch === closer) {\n          depth -= 1;\n          if (depth === 0) return input.slice(startIndex, i + 1);\n        }\n      }\n      return null;\n    };\n\n    const candidate = extractBalancedJson(text);\n    if (candidate) {\n      const parsed = tryParse(candidate);\n      if (parsed.ok) return parsed.value;\n\n      const repairedCandidate = candidate.replace(/,\\s*([}\\]])/g, '$1');\n      const repaired = tryParse(repairedCandidate);\n      if (repaired.ok) return repaired.value;\n    }\n\n    const error = direct.error || new Error('AI response did not contain valid JSON');\n    error.code = 'AI_JSON_PARSE_FAILED';\n    throw error;\n  }\n\n`;

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(target, source, 'utf8');
console.log('ContentStrategy JSON parser hardened: balanced object/array extraction + bounded trailing-comma repair active.');
