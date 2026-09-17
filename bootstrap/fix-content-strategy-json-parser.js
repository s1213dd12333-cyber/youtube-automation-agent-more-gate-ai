'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const target = path.join(upstream, 'agents', 'content-strategy-agent.js');

let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const start = source.indexOf('  parseAIJsonResponse(response) {');
const end = source.indexOf('  normalizeContentType(', start);
if (start === -1 || end === -1) throw new Error('Content strategy JSON parser anchors not found');

const replacement = `  parseAIJsonResponse(response) {
    const text = String(response || '').trim();
    const cleaned = text
      .replace(/^\\s*\\`\\`\\`(?:json)?\\s*/i, '')
      .replace(/\\`\\`\\`\\s*$/i, '')
      .trim();

    const parse = value => JSON.parse(String(value || '').trim());
    try { return parse(cleaned); } catch (_directError) {}

    const extractBalanced = input => {
      let startIndex = -1;
      let opening = null;
      let closing = null;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = 0; i < input.length; i += 1) {
        const ch = input[i];
        if (startIndex === -1) {
          if (ch === '[' || ch === '{') {
            startIndex = i;
            opening = ch;
            closing = ch === '[' ? ']' : '}';
            depth = 1;
          }
          continue;
        }
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === '\\\\') escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === opening) depth += 1;
        else if (ch === closing) {
          depth -= 1;
          if (depth === 0) return input.slice(startIndex, i + 1);
        }
      }
      return null;
    };

    const balanced = extractBalanced(cleaned);
    if (balanced) return parse(balanced);

    // If the provider truncates an array, salvage only fully complete object
    // items. Existing researchAndPlanChannel logic fills missing items using the
    // evidence-aware fallback; this parser never invents missing JSON content.
    const arrayStart = cleaned.indexOf('[');
    if (arrayStart !== -1) {
      const items = [];
      let objectStart = -1;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = arrayStart + 1; i < cleaned.length; i += 1) {
        const ch = cleaned[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === '\\\\') escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === '{') {
          if (depth === 0) objectStart = i;
          depth += 1;
        } else if (ch === '}' && depth > 0) {
          depth -= 1;
          if (depth === 0 && objectStart !== -1) {
            const candidate = cleaned.slice(objectStart, i + 1);
            try { items.push(parse(candidate)); } catch (_itemError) {}
            objectStart = -1;
          }
        }
      }
      if (items.length) return items;
    }

    throw new Error('AI response did not contain a complete valid JSON object or array');
  }

`;

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(target, source, 'utf8');
console.log('Content strategy JSON parser hardened: balanced object/array extraction and safe truncated-array salvage enabled.');
