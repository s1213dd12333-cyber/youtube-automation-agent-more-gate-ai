'use strict';
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');

function file(rel) { return path.join(upstream, rel); }
function read(rel) {
  // Git on Windows may checkout text files using CRLF. The materializer uses
  // deterministic LF anchors, so normalize line endings before matching.
  return fs.readFileSync(file(rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
function write(rel, text) { fs.writeFileSync(file(rel), text.replace(/\r\n/g, '\n'), 'utf8'); }
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

{
  const rel = 'package.json';
  const pkg = JSON.parse(read(rel));
  pkg.dependencies.sqlite3 = '^6.0.1';
  write(rel, JSON.stringify(pkg, null, 2) + '\n');
}

{
  const rel = '.env.example';
  let s = read(rel);
  s = replaceOnce(s,
    '# OPENROUTER_API_KEY=your-openrouter-api-key-here\n# GEMINI_API_KEY=your-gemini-api-key-here',
    '# OPENROUTER_API_KEY=your-openrouter-api-key-here\n# NVIDIA_API_KEY=your-nvidia-api-key-here\n# GROQ_API_KEY=your-groq-api-key-here\n# CEREBRAS_API_KEY=your-cerebras-api-key-here\n# GEMINI_API_KEY=your-gemini-api-key-here',
    '.env provider keys');
  write(rel, s);
}

{
  const rel = 'utils/ai-text-service.js';
  let s = read(rel);
  const block = `  nvidia: {\n    name: 'NVIDIA NIM',\n    baseURL: 'https://integrate.api.nvidia.com/v1',\n    defaultModel: 'openai/gpt-oss-20b',\n    models: [\n      'openai/gpt-oss-20b',\n      'nvidia/llama-3.3-nemotron-super-49b-v1',\n      'z-ai/glm-5.1',\n      'minimaxai/minimax-m3',\n    ],\n    envKey: 'NVIDIA_API_KEY',\n  },\n  groq: {\n    name: 'GroqCloud',\n    baseURL: 'https://api.groq.com/openai/v1',\n    defaultModel: 'openai/gpt-oss-20b',\n    models: [\n      'openai/gpt-oss-20b',\n      'openai/gpt-oss-120b',\n      'qwen/qwen3.6-27b',\n      'qwen/qwen3.8-27b',\n    ],\n    envKey: 'GROQ_API_KEY',\n  },\n  cerebras: {\n    name: 'Cerebras Inference',\n    baseURL: 'https://api.cerebras.ai/v1',\n    defaultModel: 'gpt-oss-120b',\n    models: [\n      'gpt-oss-120b',\n      'zai-glm-4.7',\n    ],\n    envKey: 'CEREBRAS_API_KEY',\n  },\n`;
  s = insertBefore(s, '  kimi: {', block, 'AI provider catalog');

  s = replaceOnce(s,
    `      const response = await this.client.chat.completions.create({\n        ...params,\n        max_completion_tokens: maxTokens,\n      });`,
    `      const response = await this.client.chat.completions.create({\n        ...params,\n        ...(this.providerName === 'NVIDIA NIM'\n          ? { max_tokens: maxTokens }\n          : { max_completion_tokens: maxTokens }),\n      });`,
    'NVIDIA max_tokens compatibility');

  s = replaceOnce(s,
    `    if (typeof content !== 'string' || !content.trim()) {\n      // A null/empty body used to surface as cryptic "Unexpected end of JSON input"\n      // in the agents' JSON parsers. Report the real cause instead.\n      throw new Error(\n        \`${'${this.providerName}'} returned an empty response. Check the API key and model quota.\`\n      );\n    }`,
    `    if (typeof content !== 'string' || !content.trim()) {\n      // Reasoning models can consume the full completion budget before emitting\n      // visible content. Expose safe metadata only; never log reasoning text/keys.\n      const choice = response?.choices?.[0];\n      const reasoning = choice?.message?.reasoning_content;\n      const finishReason = choice?.finish_reason || 'unknown';\n      const reasoningChars = typeof reasoning === 'string' ? reasoning.length : 0;\n      throw new Error(\n        \`${'${this.providerName}'} returned an empty response (finish_reason=${'${finishReason}'}, reasoning_chars=${'${reasoningChars}'}). Increase the completion budget if finish_reason=length.\`\n      );\n    }`,
    'reasoning-aware empty response diagnostics');
  write(rel, s);
}

{
  const rel = 'utils/credential-manager.js';
  let s = read(rel);
  const helper = `  async setupCompatibleProviderCredentials(providerId, keyUrl) {\n    const preset = PROVIDERS[providerId];\n    if (!preset) throw new Error(\`Unknown AI provider: \${providerId}\`);\n\n    console.log(chalk.cyan(\`\\n\${preset.name} Setup\`));\n    console.log(chalk.gray(\`Get your API key from: \${keyUrl}\`));\n\n    const answers = await inquirer.prompt([\n      {\n        type: 'password',\n        name: 'apiKey',\n        message: \`Enter your \${preset.name} API Key:\`,\n        validate: input => input.length > 0 || 'API key is required'\n      },\n      {\n        type: 'list',\n        name: 'model',\n        message: 'Select model:',\n        choices: [...preset.models],\n        default: preset.defaultModel\n      }\n    ]);\n\n    this.credentials.aiProvider = {\n      provider: providerId,\n      apiKey: answers.apiKey,\n      model: answers.model\n    };\n\n    await this.saveCredentials();\n    console.log(chalk.green(\`\${preset.name} configured successfully!\`));\n  }\n\n  async setupNvidiaCredentials() {\n    return this.setupCompatibleProviderCredentials('nvidia', 'https://build.nvidia.com/');\n  }\n\n  async setupGroqCredentials() {\n    return this.setupCompatibleProviderCredentials('groq', 'https://console.groq.com/keys');\n  }\n\n  async setupCerebrasCredentials() {\n    return this.setupCompatibleProviderCredentials('cerebras', 'https://cloud.cerebras.ai/');\n  }\n\n`;
  s = insertBefore(s, '  // Kimi (Moonshot AI) Setup', helper, 'compatible provider setup helpers');
  s = replaceOnce(s,
    "missing.push('an AI provider (OpenAI, Gemini, OpenRouter, Kimi, MiMo, or GLM)');",
    "missing.push('an AI provider (OpenAI, Gemini, NVIDIA NIM, Groq, Cerebras, OpenRouter, Kimi, MiMo, or GLM)');",
    'missing AI provider message');
  s = replaceOnce(s,
    "{ name: '🤖 AI Service (OpenAI/Gemini)', action: () => this.setupAIService() },",
    "{ name: '🤖 AI Service (OpenAI/Gemini/NVIDIA/Groq/Cerebras)', action: () => this.setupAIService() },",
    'setup wizard label');
  s = replaceOnce(s,
    "          { name: 'OpenRouter (400+ models, one API key)', value: 'openrouter' },",
    "          { name: 'OpenRouter (400+ models, one API key)', value: 'openrouter' },\n          { name: 'NVIDIA NIM (hosted OpenAI-compatible models)', value: 'nvidia' },\n          { name: 'GroqCloud (fast inference; free tier available)', value: 'groq' },\n          { name: 'Cerebras Inference (fast GPT-OSS; free key available)', value: 'cerebras' },",
    'setup provider choices');
  s = replaceOnce(s,
    "      case 'openrouter': return await this.setupOpenRouterCredentials();",
    "      case 'openrouter': return await this.setupOpenRouterCredentials();\n      case 'nvidia': return await this.setupNvidiaCredentials();\n      case 'groq': return await this.setupGroqCredentials();\n      case 'cerebras': return await this.setupCerebrasCredentials();",
    'setup provider switch');
  write(rel, s);
}

{
  const rel = 'walkthrough.js';
  let s = read(rel);
  const block = `  nvidia: {\n    label: 'NVIDIA NIM — hosted developer inference, OpenAI-compatible',\n    keyUrl: 'https://build.nvidia.com/',\n    keyHint: 'generated from NVIDIA Build / API catalog',\n    instructions: [\n      'Sign in with an NVIDIA Developer account',\n      'Open a supported model in NVIDIA Build',\n      'Generate an API key and copy it'\n    ],\n    models: [...PROVIDERS.nvidia.models],\n    defaultModel: PROVIDERS.nvidia.defaultModel,\n    covers: 'scripts/text generation; quotas and model availability depend on NVIDIA developer access',\n    save(credentials, apiKey, model) {\n      credentials.aiProvider = { provider: 'nvidia', apiKey, model };\n    },\n    validationCreds: (apiKey, model) => ({ aiProvider: { provider: 'nvidia', apiKey, model } })\n  },\n  groq: {\n    label: 'GroqCloud — very fast hosted inference; free tier available',\n    keyUrl: 'https://console.groq.com/keys',\n    keyHint: 'created in the GroqCloud console',\n    instructions: [\n      'Create or sign in to a GroqCloud account',\n      'Open API Keys',\n      'Create a key and copy it'\n    ],\n    models: [...PROVIDERS.groq.models],\n    defaultModel: PROVIDERS.groq.defaultModel,\n    covers: 'scripts/text generation; free-tier calls are subject to Groq rate limits',\n    save(credentials, apiKey, model) {\n      credentials.aiProvider = { provider: 'groq', apiKey, model };\n    },\n    validationCreds: (apiKey, model) => ({ aiProvider: { provider: 'groq', apiKey, model } })\n  },\n  cerebras: {\n    label: 'Cerebras Inference — high-speed GPT-OSS/GLM inference',\n    keyUrl: 'https://cloud.cerebras.ai/',\n    keyHint: 'created in Cerebras Cloud',\n    instructions: [\n      'Create or sign in to Cerebras Cloud',\n      'Open API Keys',\n      'Create a key and copy it'\n    ],\n    models: [...PROVIDERS.cerebras.models],\n    defaultModel: PROVIDERS.cerebras.defaultModel,\n    covers: 'scripts/text generation; free-tier availability and limits depend on the account/model',\n    save(credentials, apiKey, model) {\n      credentials.aiProvider = { provider: 'cerebras', apiKey, model };\n    },\n    validationCreds: (apiKey, model) => ({ aiProvider: { provider: 'cerebras', apiKey, model } })\n  },\n`;
  s = insertBefore(s, '  kimi: {', block, 'walkthrough provider guide');
  s = replaceOnce(s,
    "console.log(chalk.white('Google Gemini offers free tiers for supported text and TTS usage.'));",
    "console.log(chalk.white('Google Gemini, Groq, NVIDIA NIM, and Cerebras may offer free/developer usage subject to provider limits.'));",
    'walkthrough free provider guidance');
  s = replaceOnce(s,
    "      const reply = await service.generateText('Reply with the single word OK.', { maxTokens: 20, temperature: 0 });",
    "      const validationMaxTokens = guide === AI_PROVIDER_GUIDE.nvidia ? 1024 : 20;\n      const reply = await service.generateText('Reply with the single word OK.', { maxTokens: validationMaxTokens, temperature: 0 });",
    'reasoning model validation token budget');
  write(rel, s);
}

{
  const rel = 'config/credentials.example.json';
  let s = read(rel);
  const marker = '  "replicate": {';
  const block = '  "aiProvider": {\n    "provider": "nvidia",\n    "apiKey": "YOUR_PROVIDER_API_KEY",\n    "model": "openai/gpt-oss-20b"\n  },\n';
  s = insertBefore(s, marker, block, 'credentials example');
  write(rel, s);
}

{
  const rel = 'README.md';
  let s = read(rel);
  s = replaceOnce(s,
    'use Gemini, OpenAI, OpenRouter, Kimi, MiMo, GLM, or another OpenAI-compatible text endpoint',
    'use Gemini, OpenAI, NVIDIA NIM, GroqCloud, Cerebras, OpenRouter, Kimi, MiMo, GLM, or another OpenAI-compatible text endpoint',
    'README provider overview');
  const anchor = '#### Kimi / MiMo / GLM';
  const block = `#### NVIDIA NIM / GroqCloud / Cerebras\n\n| Provider | Get key at | Env var |\n|----------|-----------|---------|\n| NVIDIA NIM | [NVIDIA Build](https://build.nvidia.com/) | \`NVIDIA_API_KEY\` |\n| GroqCloud | [GroqCloud Console](https://console.groq.com/keys) | \`GROQ_API_KEY\` |\n| Cerebras Inference | [Cerebras Cloud](https://cloud.cerebras.ai/) | \`CEREBRAS_API_KEY\` |\n\n`;
  s = insertBefore(s, anchor, block, 'README provider key table');
  write(rel, s);
}

console.log('Gateway materialization completed successfully.');
