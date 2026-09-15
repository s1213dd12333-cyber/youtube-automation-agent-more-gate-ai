'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'upstream', 'agents', 'script-writer-agent.js');
let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

function replaceOnce(from, to, label) {
  if (source.includes(to)) return;
  const index = source.indexOf(from);
  if (index === -1) throw new Error(`Anchor not found for ${label}`);
  source = source.slice(0, index) + to + source.slice(index + from.length);
}

replaceOnce(
`    // Conclusion
    fullScript += \`[\${script.conclusion.duration}] CONCLUSION\\n\`;
    script.conclusion.recap.forEach(line => {
      fullScript += \`\${line}\\n\`;
    });
    fullScript += \`\\n\${script.conclusion.finalThought}\\n\\n\`;
`,
`    // Conclusion — tolerate provider/model shape variation.
    const conclusion = script.conclusion || {};
    const conclusionLines = Array.isArray(conclusion.recap)
      ? conclusion.recap
      : Array.isArray(conclusion.keyPoints)
        ? conclusion.keyPoints
        : conclusion.summary ? [conclusion.summary] : [];
    fullScript += \`[\${conclusion.duration || '30 seconds'}] CONCLUSION\\n\`;
    for (const line of conclusionLines) {
      if (line) fullScript += \`\${line}\\n\`;
    }
    if (conclusion.finalThought) fullScript += \`\\n\${conclusion.finalThought}\\n\\n\`;
`,
'conclusion shape normalization'
);

replaceOnce(
"    fullScript += `KEYWORDS: ${script.keywords.join(', ')}\\n`;\n",
"    fullScript += `KEYWORDS: ${(Array.isArray(script.keywords) ? script.keywords : []).join(', ')}\\n`;\n",
'keywords array guard'
);

replaceOnce(
"    for (const section of script.mainContent.sections) {\n",
"    const sections = Array.isArray(script.mainContent?.sections) ? script.mainContent.sections : [];\n    for (const section of sections) {\n",
'main content sections guard'
);

// Reasoning-capable OpenAI-compatible models can spend most of a small completion
// budget on hidden reasoning and return no visible JSON with finish_reason=length.
// Give script generation realistic headroom and retry exactly once, only for that
// specific budget-exhaustion signal. Other failures keep their existing behavior.
replaceOnce(
`      const response = await this.aiTextService.generateText(prompt, {
        maxTokens: 1800,
        temperature: 0.7
      });
`,
`      const configuredBaseBudget = Number(process.env.SCRIPT_AI_MAX_TOKENS || 6144);
      const configuredRetryBudget = Number(process.env.SCRIPT_AI_RETRY_MAX_TOKENS || 12288);
      const baseBudget = Number.isFinite(configuredBaseBudget)
        ? Math.max(2400, Math.min(16384, Math.round(configuredBaseBudget)))
        : 6144;
      const retryBudget = Number.isFinite(configuredRetryBudget)
        ? Math.max(baseBudget, Math.min(32768, Math.round(configuredRetryBudget)))
        : Math.max(baseBudget, 12288);
      let response;
      try {
        response = await this.aiTextService.generateText(prompt, {
          maxTokens: baseBudget,
          temperature: 0.6,
          operation: 'script'
        });
      } catch (error) {
        const lengthExhausted = error?.code === 'AI_EMPTY_RESPONSE' &&
          /finish_reason=length/i.test(String(error?.message || ''));
        if (!lengthExhausted) throw error;
        this.logger.warn(\`AI script output budget exhausted at \${baseBudget} tokens; retrying once with \${retryBudget} tokens.\`);
        response = await this.aiTextService.generateText(prompt, {
          maxTokens: retryBudget,
          temperature: 0.5,
          operation: 'script_retry_length'
        });
      }
`,
'script reasoning/output budget retry'
);

fs.writeFileSync(target, source, 'utf8');

const envPath = path.join(root, 'upstream', '.env.example');
if (fs.existsSync(envPath)) {
  let env = fs.readFileSync(envPath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!env.includes('SCRIPT_AI_MAX_TOKENS=')) {
    env += `\n# Script generation — reasoning-capable models may need headroom before visible JSON.\nSCRIPT_AI_MAX_TOKENS=6144\nSCRIPT_AI_RETRY_MAX_TOKENS=12288\n`;
    fs.writeFileSync(envPath, env, 'utf8');
  }
}

console.log('ScriptWriter output-shape hardening and length-aware script retry applied.');
