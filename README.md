# youtube-automation-agent-more-gate-ai

Extended AI-gateway edition of AgentTube / YouTube Automation Agent.

This repository tracks the upstream project at the exact commit used for the gateway work and keeps the NVIDIA NIM, GroqCloud and Cerebras changes as versioned patches.

## Included gateways

- NVIDIA NIM — `https://integrate.api.nvidia.com/v1`
- GroqCloud — `https://api.groq.com/openai/v1`
- Cerebras Inference — `https://api.cerebras.ai/v1`
- Existing OpenAI, Gemini, OpenRouter, Kimi, MiMo and GLM support remains upstream.

## Clone and materialize the extended source

```bash
git clone --recurse-submodules https://github.com/s1213dd12333-cyber/youtube-automation-agent-more-gate-ai.git
cd youtube-automation-agent-more-gate-ai/upstream
patch -p2 < ../bootstrap/01-env-readme.patch
patch -p2 < ../bootstrap/02-providers.patch
patch -p2 < ../bootstrap/03-setup.patch
npm install
npm run walkthrough
npm start
```

The `upstream/` submodule is pinned to `darkzOGx/youtube-automation-agent` commit `260d7a94ab2d5bb2a98ce6620bfda7efd56ebd6b`, matching the source snapshot used for this implementation.

## Additional environment variables

```env
NVIDIA_API_KEY=
GROQ_API_KEY=
CEREBRAS_API_KEY=
```

The next planned step is an automatic AI Gateway Router with provider fallback and free-first routing.
