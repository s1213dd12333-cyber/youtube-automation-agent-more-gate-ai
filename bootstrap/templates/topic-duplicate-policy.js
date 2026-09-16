'use strict';

const AUTOMATED_TOPIC_SOURCES = new Set(['scheduler', 'autonomous_operator']);

function normalizeGenerationSource(value) {
  const source = String(value || 'manual').trim().toLowerCase();
  return source || 'manual';
}

function shouldEnforceExactTopicNovelty(input = {}) {
  const source = normalizeGenerationSource(input.source);

  // An explicit override is reserved for intentional reruns/recovery flows.
  if (input.allowDuplicate === true || source === 'retry') return false;

  // Manual creation is operator-directed. Do not prevent a human from rerunning
  // the same topic for testing, repairs, a different angle, or a deliberate remake.
  // Callers that explicitly want the guard can opt back in with enforceNovelty.
  if (input.enforceNovelty === true) return true;

  // Autonomous sources retain the duplicate safety gate so automation does not
  // repeatedly spend provider credits on the same recently completed topic.
  return AUTOMATED_TOPIC_SOURCES.has(source);
}

module.exports = {
  AUTOMATED_TOPIC_SOURCES,
  normalizeGenerationSource,
  shouldEnforceExactTopicNovelty
};
