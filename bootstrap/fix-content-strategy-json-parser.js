'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const target = path.join(upstream, 'agents', 'content-strategy-agent.js');

let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const parserStart = source.indexOf('  parseAIJsonResponse(response) {');
const parserEnd = source.indexOf('  normalizeContentType(contentType, topic) {', parserStart);
if (parserStart === -1 || parserEnd === -1) throw new Error('ContentStrategy JSON parser anchors not found');

const parserReplacement = `  parseAIJsonResponse(response) {\n    const raw = String(response || '').trim();\n    const text = raw\n      .replace(/^\\uFEFF/, '')\n      .replace(/^\\`\\`\\`(?:json)?\\s*/i, '')\n      .replace(/\\`\\`\\`\\s*$/i, '')\n      .trim();\n\n    const tryParse = value => {\n      try { return { ok: true, value: JSON.parse(value) }; } catch (error) { return { ok: false, error }; }\n    };\n\n    const direct = tryParse(text);\n    if (direct.ok) return direct.value;\n\n    const extractBalancedJson = input => {\n      let startIndex = -1;\n      let opener = '';\n      let closer = '';\n      let depth = 0;\n      let inString = false;\n      let escaped = false;\n\n      for (let i = 0; i < input.length; i += 1) {\n        const ch = input[i];\n        if (startIndex === -1) {\n          if (ch === '{' || ch === '[') {\n            startIndex = i; opener = ch; closer = ch === '{' ? '}' : ']'; depth = 1;\n          }\n          continue;\n        }\n\n        if (inString) {\n          if (escaped) { escaped = false; continue; }\n          if (ch === '\\\\') { escaped = true; continue; }\n          if (ch === '"') inString = false;\n          continue;\n        }\n\n        if (ch === '"') { inString = true; continue; }\n        if (ch === opener) depth += 1;\n        else if (ch === closer) {\n          depth -= 1;\n          if (depth === 0) return input.slice(startIndex, i + 1);\n        }\n      }\n      return null;\n    };\n\n    const candidate = extractBalancedJson(text);\n    if (candidate) {\n      const parsed = tryParse(candidate);\n      if (parsed.ok) return parsed.value;\n\n      const repairedCandidate = candidate.replace(/,\\s*([}\\]])/g, '$1');\n      const repaired = tryParse(repairedCandidate);\n      if (repaired.ok) return repaired.value;\n    }\n\n    const error = direct.error || new Error('AI response did not contain valid JSON');\n    error.code = 'AI_JSON_PARSE_FAILED';\n    throw error;\n  }\n\n`;

source = source.slice(0, parserStart) + parserReplacement + source.slice(parserEnd);

const methodStart = source.indexOf('  async generateAutonomousPlanWithAI(channelStrategy, research, targetCount) {');
const methodEnd = source.indexOf('  buildFallbackAutonomousPlan(channelStrategy, research, targetCount) {', methodStart);
if (methodStart === -1 || methodEnd === -1) throw new Error('Autonomous plan method anchors not found');
const originalMethod = source.slice(methodStart, methodEnd);

if (!originalMethod.includes('AI channel plan JSON retry')) {
  const responseLine = "      const response = await this.aiTextService.generateText(prompt, { maxTokens: 1800, temperature: 0.65 });\n      const parsed = this.parseAIJsonResponse(response);\n      return Array.isArray(parsed) ? parsed : Array.isArray(parsed.plan) ? parsed.plan : [];";
  const retryBlock = "      const response = await this.aiTextService.generateText(prompt, { maxTokens: 2200, temperature: 0.45 });\n      let parsed;\n      try {\n        parsed = this.parseAIJsonResponse(response);\n      } catch (parseError) {\n        if (parseError?.code !== 'AI_JSON_PARSE_FAILED') throw parseError;\n        this.logger.warn(`AI channel plan JSON retry after malformed response: ${parseError.message}`);\n        const retryPrompt = prompt + '\\n\\nIMPORTANT: Your previous response was malformed or truncated. Return ONLY one complete JSON array. No markdown, no prose before or after the JSON. Keep every string concise so the response fits comfortably within the token limit.';\n        const retryResponse = await this.aiTextService.generateText(retryPrompt, { maxTokens: 2600, temperature: 0.1 });\n        parsed = this.parseAIJsonResponse(retryResponse);\n      }\n      return Array.isArray(parsed) ? parsed : Array.isArray(parsed.plan) ? parsed.plan : [];";
  if (!originalMethod.includes(responseLine)) throw new Error('Autonomous plan response anchor not found');
  const patchedMethod = originalMethod.replace(responseLine, retryBlock);
  source = source.slice(0, methodStart) + patchedMethod + source.slice(methodEnd);
}

fs.writeFileSync(target, source, 'utf8');
console.log('ContentStrategy JSON hardening active: balanced extraction, bounded repair, and one strict retry for malformed/truncated autonomous plans.');
