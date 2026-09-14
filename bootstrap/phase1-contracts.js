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
  if (index === -1) throw new Error(`Anchor not found for ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function copyContracts() {
  const template = path.join(root, 'bootstrap', 'templates', 'content-contracts.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/content-contracts.js');
  write('utils/content-contracts.js', fs.readFileSync(template, 'utf8'));
}

function patchContentStrategy() {
  const rel = 'agents/content-strategy-agent.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { AITextService } = require('../utils/ai-text-service');\n",
    "const { AITextService } = require('../utils/ai-text-service');\nconst { normalizeStrategy, assertValidStrategy } = require('../utils/content-contracts');\n",
    'content strategy contract import'
  );

  s = replaceOnce(
    s,
    `      const aiStrategy = await this.generateContentStrategyWithAI(requestedTopic);\n      if (aiStrategy) {\n        await this.db.saveContentStrategy(aiStrategy);\n        this.logger.info(\`Generated AI strategy for: \${aiStrategy.topic}\`);\n        return aiStrategy;\n      }`,
    `      const aiStrategy = await this.generateContentStrategyWithAI(requestedTopic);\n      if (aiStrategy) {\n        const normalizedStrategy = normalizeStrategy(aiStrategy);\n        assertValidStrategy(normalizedStrategy);\n        await this.db.saveContentStrategy(normalizedStrategy);\n        this.logger.info(\`Generated AI strategy for: \${normalizedStrategy.topic}\`);\n        return normalizedStrategy;\n      }`,
    'normalize AI strategy before persistence'
  );

  s = replaceOnce(
    s,
    `      // Save to database\n      await this.db.saveContentStrategy(strategy);\n\n      this.logger.info(\`Generated strategy for: \${topic}\`);\n      return strategy;`,
    `      // Normalize and validate before persistence so downstream stages never receive raw shapes.\n      const normalizedStrategy = normalizeStrategy(strategy);\n      assertValidStrategy(normalizedStrategy);\n      await this.db.saveContentStrategy(normalizedStrategy);\n\n      this.logger.info(\`Generated strategy for: \${normalizedStrategy.topic}\`);\n      return normalizedStrategy;`,
    'normalize template strategy before persistence'
  );
  write(rel, s);
}

function patchScriptWriter() {
  const rel = 'agents/script-writer-agent.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { AITextService } = require('../utils/ai-text-service');\n",
    "const { AITextService } = require('../utils/ai-text-service');\nconst { normalizeScript, assertValidScript } = require('../utils/content-contracts');\n",
    'script writer contract import'
  );

  s = replaceOnce(
    s,
    `      const aiScript = await this.generateScriptWithAI(strategy, template);\n      if (aiScript) {\n        aiScript.fullScript = this.formatFullScript(aiScript);\n        await this.db.saveScript(aiScript);\n        this.logger.info(\`Script generated with AI provider: \${aiScript.title}\`);\n        return aiScript;\n      }`,
    `      const aiScript = await this.generateScriptWithAI(strategy, template);\n      if (aiScript) {\n        const normalizedScript = normalizeScript(aiScript, strategy);\n        assertValidScript(normalizedScript);\n        normalizedScript.fullScript = this.formatFullScript(normalizedScript);\n        assertValidScript(normalizedScript);\n        await this.db.saveScript(normalizedScript);\n        this.logger.info(\`Script generated with AI provider: \${normalizedScript.title}\`);\n        return normalizedScript;\n      }`,
    'normalize AI script before formatting and persistence'
  );

  s = replaceOnce(
    s,
    `      // Format for readability\n      script.fullScript = this.formatFullScript(script);\n      \n      // Save to database\n      await this.db.saveScript(script);\n      \n      this.logger.info(\`Script generated: \${script.title}\`);\n      return script;`,
    `      // Normalize before formatting so formatFullScript never consumes an untrusted model shape.\n      const normalizedScript = normalizeScript(script, strategy);\n      assertValidScript(normalizedScript);\n      normalizedScript.fullScript = this.formatFullScript(normalizedScript);\n      assertValidScript(normalizedScript);\n      \n      // Save only the canonical script contract.\n      await this.db.saveScript(normalizedScript);\n      \n      this.logger.info(\`Script generated: \${normalizedScript.title}\`);\n      return normalizedScript;`,
    'normalize template script before formatting and persistence'
  );
  write(rel, s);
}

function patchRecovery() {
  const rel = 'utils/generation-recovery-service.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const fs = require('fs').promises;\n",
    "const fs = require('fs').promises;\nconst { normalizeGenerationArtifact, validateGenerationArtifact } = require('./content-contracts');\n",
    'generation recovery contract import'
  );

  s = replaceOnce(
    s,
    `    if (checkpoint?.status === 'completed') {\n      if (await this.validateArtifact(stage, checkpoint.artifact)) {\n        await this.markReused(jobId, stage, progress);\n        this.logger.info(\`Reusing verified \${stage} checkpoint for \${jobId}\`);\n        return checkpoint.artifact;\n      }`,
    `    if (checkpoint?.status === 'completed') {\n      let checkpointArtifact = checkpoint.artifact;\n      try {\n        checkpointArtifact = normalizeGenerationArtifact(stage, checkpointArtifact);\n      } catch (error) {\n        this.logger.warn(\`Saved \${stage} checkpoint failed the content contract and will be regenerated: \${error.message}\`);\n        checkpointArtifact = null;\n      }\n      if (checkpointArtifact && await this.validateArtifact(stage, checkpointArtifact)) {\n        if (stage === 'strategy' || stage === 'script') {\n          await this.db.saveGenerationCheckpoint(jobId, stage, {\n            status: 'completed',\n            artifact: checkpointArtifact,\n            error: null,\n            completedAt: checkpoint.completedAt || new Date().toISOString()\n          });\n        }\n        await this.markReused(jobId, stage, progress);\n        this.logger.info(\`Reusing verified \${stage} checkpoint for \${jobId}\`);\n        return checkpointArtifact;\n      }`,
    'normalize reused checkpoints'
  );

  s = replaceOnce(
    s,
    '        const artifact = await producer();\n',
    '        const artifact = normalizeGenerationArtifact(stage, await producer());\n',
    'normalize artifacts before checkpoint persistence'
  );

  s = replaceOnce(
    s,
    `    if (!artifact || typeof artifact !== 'object') return false;\n    if (stage === 'strategy') return Boolean(artifact.topic);\n    if (stage === 'script') return Boolean(artifact.title && (artifact.fullScript || artifact.mainContent));`,
    `    if (!artifact || typeof artifact !== 'object') return false;\n    if (stage === 'strategy' || stage === 'script') {\n      return validateGenerationArtifact(stage, artifact).valid;\n    }`,
    'use canonical validation for strategy and script checkpoints'
  );
  write(rel, s);
}

function patchIndex() {
  const rel = 'index.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { GenerationRecoveryService, GENERATION_STAGES } = require('./utils/generation-recovery-service');\n",
    "const { GenerationRecoveryService, GENERATION_STAGES } = require('./utils/generation-recovery-service');\nconst { normalizeGenerationArtifact } = require('./utils/content-contracts');\n",
    'main agent contract import'
  );

  s = replaceOnce(
    s,
    `      generated.researchSources = Array.isArray(strategyContext.researchSources)\n        ? strategyContext.researchSources\n        : [];\n      return generated;`,
    `      generated.researchSources = Array.isArray(strategyContext.researchSources)\n        ? strategyContext.researchSources\n        : [];\n      if (generated.researchSources.length === 0 && typeof this.agents.strategy.researchTopicSources === 'function') {\n        generated.researchSources = await this.agents.strategy.researchTopicSources(generated.topic);\n      }\n      return generated;`,
    'persist research sources inside normalized strategy checkpoint'
  );

  s = replaceOnce(
    s,
    `  async runGenerationStage(jobId, stage, progress, producer) {\n    if (!jobId) {\n      await this.updateJobStage(jobId, stage, progress);\n      return producer();\n    }`,
    `  async runGenerationStage(jobId, stage, progress, producer) {\n    if (!jobId) {\n      await this.updateJobStage(jobId, stage, progress);\n      return normalizeGenerationArtifact(stage, await producer());\n    }`,
    'normalize non-job generation stages'
  );
  write(rel, s);
}

function patchPackage() {
  const rel = 'package.json';
  const pkg = JSON.parse(read(rel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:contracts'] = 'node ../bootstrap/verify-phase1-contracts.js';
  write(rel, `${JSON.stringify(pkg, null, 2)}\n`);
}

copyContracts();
patchContentStrategy();
patchScriptWriter();
patchRecovery();
patchIndex();
patchPackage();

console.log('Phase 1 contracts installed: strategy/script normalization, validation, checkpoint migration, and contract test command.');
