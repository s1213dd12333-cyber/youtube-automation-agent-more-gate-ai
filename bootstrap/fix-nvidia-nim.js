'use strict';

const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '..', 'upstream', 'utils', 'ai-text-service.js');
let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

function replaceOnce(from, to, label) {
  if (source.includes(to)) return;
  const index = source.indexOf(from);
  if (index === -1) throw new Error(`Anchor not found for ${label}`);
  source = source.slice(0, index) + to + source.slice(index + from.length);
}

replaceOnce(
  "    this.providerName = null;\n",
  "    this.providerName = null;\n    this.useLegacyMaxTokens = false;\n",
  'provider token mode state'
);

replaceOnce(
  "    this.providerName = preset.name;\n    this.logger.info(`${preset.name} initialized (model: ${this.model})`);",
  "    this.providerName = preset.name;\n    // NVIDIA NIM's GPT-OSS reference uses the OpenAI-compatible legacy\n    // max_tokens parameter. Sending max_completion_tokens may be accepted\n    // while leaving only reasoning output and an empty final content field.\n    this.useLegacyMaxTokens = preset.name === 'NVIDIA NIM';\n    this.logger.info(`${preset.name} initialized (model: ${this.model})`);",
  'NVIDIA token parameter mode'
);

replaceOnce(
  "      const response = await this.client.chat.completions.create({\n        ...params,\n        max_completion_tokens: maxTokens,\n      });\n      return this._extractContent(response);",
  "      const response = await this.client.chat.completions.create(\n        this.useLegacyMaxTokens\n          ? { ...params, max_tokens: maxTokens }\n          : { ...params, max_completion_tokens: maxTokens }\n      );\n      return this._extractContent(response);",
  'provider-specific token parameter'
);

replaceOnce(
  "        error &&\n        error.status === 400 &&",
  "        !this.useLegacyMaxTokens &&\n        error &&\n        error.status === 400 &&",
  'token compatibility retry guard'
);

fs.writeFileSync(target, source, 'utf8');
console.log('NVIDIA NIM token compatibility fix applied.');
