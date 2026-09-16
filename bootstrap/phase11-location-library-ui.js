'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const here = __dirname;
const syntax = rels => { for (const rel of rels) execFileSync(process.execPath, ['--check', path.join(here, rel)], { stdio: 'inherit' }); };
const requireFiles = (rels, phase) => { for (const rel of rels) if (!fs.existsSync(path.join(here, rel))) throw new Error(`${phase} prerequisite missing: ${rel}`); };
const run = rel => execFileSync(process.execPath, [path.join(here, rel)], { stdio: 'inherit' });

// Keep the validated 11.9.7 materializer intact.
require('./phase11-location-library-ui-v1197.js');

// 11.9.4 resolver audit hardening.
syntax(['fix-phase11-location-resolver-audit.js', 'verify-phase11-location-resolver-audit.js']);
require('./fix-phase11-location-resolver-audit.js');
run('verify-phase11-location-resolver-audit.js');

// 11.9.8 closes the reusable-location system first.
syntax(['phase11-reusable-location-e2e.js', 'verify-phase11-reusable-location-e2e.js', 'e2e/location-system-memory-db.js', 'e2e/location-system-fixtures.js']);
require('./phase11-reusable-location-e2e.js');
run('verify-phase11-reusable-location-e2e.js');

// 11.10.1 — Persistent World Object Registry.
syntax(['phase11-persistent-world-objects.js', 'verify-phase11-persistent-world-objects.js', 'templates/persistent-world-object-registry-v11.js']);
requireFiles(['templates/persistent-world-object-db-tables-v11.txt', 'templates/persistent-world-object-db-methods-v11.txt'], 'Phase 11.10.1');
require('./phase11-persistent-world-objects.js');
run('verify-phase11-persistent-world-objects.js');

// 11.10.2 — Object Aliases + Resolver.
syntax(['phase11-persistent-world-object-resolver.js', 'verify-phase11-persistent-world-object-resolver.js', 'templates/persistent-world-object-resolver-v11.js']);
requireFiles(['templates/persistent-world-object-resolver-db-tables-v11.txt', 'templates/persistent-world-object-resolver-db-methods-v11.txt'], 'Phase 11.10.2');
require('./phase11-persistent-world-object-resolver.js');
run('verify-phase11-persistent-world-object-resolver.js');

// 11.10.3 — Canonical Object Assets.
syntax(['phase11-canonical-world-object-assets.js', 'verify-phase11-canonical-world-object-assets.js', 'templates/canonical-world-object-assets-v11.js']);
requireFiles(['templates/persistent-world-object-assets-db-tables-v11.txt', 'templates/persistent-world-object-assets-db-methods-v11.txt'], 'Phase 11.10.3');
require('./phase11-canonical-world-object-assets.js');
run('verify-phase11-canonical-world-object-assets.js');

// 11.10.4 — Object State / Lifecycle.
syntax(['phase11-persistent-world-object-state.js', 'verify-phase11-persistent-world-object-state.js', 'templates/persistent-world-object-state-v11.js']);
requireFiles(['templates/persistent-world-object-state-db-tables-v11.txt', 'templates/persistent-world-object-state-db-methods-v11.txt'], 'Phase 11.10.4');
require('./phase11-persistent-world-object-state.js');
run('verify-phase11-persistent-world-object-state.js');

// 11.10.5 — Scene / Shot Object Binding.
syntax(['phase11-persistent-world-object-binding.js', 'verify-phase11-persistent-world-object-binding.js', 'templates/persistent-world-object-binding-v11.js']);
requireFiles(['templates/persistent-world-object-binding-db-tables-v11.txt', 'templates/persistent-world-object-binding-db-methods-v11.txt'], 'Phase 11.10.5');
require('./phase11-persistent-world-object-binding.js');
run('verify-phase11-persistent-world-object-binding.js');

// 11.10.6 — Cross-Video Object Continuity Gate.
syntax(['phase11-cross-video-object-continuity.js', 'verify-phase11-cross-video-object-continuity.js', 'templates/cross-video-object-continuity-gate-v11.js']);
requireFiles(['templates/cross-video-object-continuity-db-tables-v11.txt', 'templates/cross-video-object-continuity-db-methods-v11.txt'], 'Phase 11.10.6');
require('./phase11-cross-video-object-continuity.js');
run('verify-phase11-cross-video-object-continuity.js');

// 11.10.7 — Object Library UI + audited operator controls.
syntax(['phase11-persistent-world-object-library-ui.js', 'verify-phase11-persistent-world-object-library-ui.js', 'templates/persistent-world-object-library-manager-v11.js', 'templates/persistent-world-object-library-dashboard-v11.js']);
requireFiles(['templates/persistent-world-object-operator-db-tables-v11.txt', 'templates/persistent-world-object-operator-db-methods-v11.txt', 'templates/persistent-world-object-library-dashboard-v11.css'], 'Phase 11.10.7');
require('./phase11-persistent-world-object-library-ui.js');

// 11.10.7 concurrency hardening must be active before the integrated E2E gate.
syntax(['fix-phase11-persistent-world-object-operator-atomicity.js', 'verify-phase11-persistent-world-object-operator-atomicity.js']);
require('./fix-phase11-persistent-world-object-operator-atomicity.js');
run('verify-phase11-persistent-world-object-operator-atomicity.js');
run('verify-phase11-persistent-world-object-library-ui.js');

// 11.10.8 — deterministic integrated multi-video closeout for 11.10.1–11.10.7.
syntax(['phase11-persistent-world-object-e2e.js', 'verify-phase11-persistent-world-object-e2e.js', 'e2e/object-system-memory-db.js', 'e2e/object-system-fixtures.js']);
require('./phase11-persistent-world-object-e2e.js');
run('verify-phase11-persistent-world-object-e2e.js');

// 11.11.1 — Persistent Character Registry starts only after the fully validated 11.10 closeout.
syntax(['phase11-persistent-characters.js', 'verify-phase11-persistent-characters.js', 'templates/persistent-character-registry-v11.js']);
requireFiles(['templates/persistent-character-db-tables-v11.txt', 'templates/persistent-character-db-methods-v11.txt'], 'Phase 11.11.1');
require('./phase11-persistent-characters.js');
run('verify-phase11-persistent-characters.js');

// 11.11.2 — Character Aliases + Resolver.
syntax(['phase11-persistent-character-resolver.js', 'verify-phase11-persistent-character-resolver.js', 'templates/persistent-character-resolver-v11.js']);
requireFiles(['templates/persistent-character-resolver-db-tables-v11.txt', 'templates/persistent-character-resolver-db-methods-v11.txt'], 'Phase 11.11.2');
require('./phase11-persistent-character-resolver.js');
run('verify-phase11-persistent-character-resolver.js');

// 11.11.3 — Canonical Character Assets.
syntax(['phase11-canonical-character-assets.js', 'verify-phase11-canonical-character-assets.js', 'templates/canonical-character-assets-v11.js']);
requireFiles(['templates/persistent-character-assets-db-tables-v11.txt', 'templates/persistent-character-assets-db-methods-v11.txt'], 'Phase 11.11.3');
require('./phase11-canonical-character-assets.js');
run('verify-phase11-canonical-character-assets.js');

// 11.11.4 — Wardrobe / Appearance State Layers.
syntax(['phase11-persistent-character-appearance-state.js', 'verify-phase11-persistent-character-appearance-state.js', 'templates/persistent-character-appearance-state-v11.js']);
requireFiles(['templates/persistent-character-appearance-state-db-tables-v11.txt', 'templates/persistent-character-appearance-state-db-methods-v11.txt'], 'Phase 11.11.4');
require('./phase11-persistent-character-appearance-state.js');
run('verify-phase11-persistent-character-appearance-state.js');

// 11.11.5 — Scene / Shot Character Binding.
syntax(['phase11-persistent-character-binding.js', 'verify-phase11-persistent-character-binding.js', 'templates/persistent-character-binding-v11.js']);
requireFiles(['templates/persistent-character-binding-db-tables-v11.txt', 'templates/persistent-character-binding-db-methods-v11.txt'], 'Phase 11.11.5');
require('./phase11-persistent-character-binding.js');
run('verify-phase11-persistent-character-binding.js');

// 11.11.5 hardening — merge complementary explicit declarations and prune stale production bindings.
syntax(['fix-phase11-persistent-character-binding-hardening.js', 'verify-phase11-persistent-character-binding-hardening.js']);
require('./fix-phase11-persistent-character-binding-hardening.js');
run('verify-phase11-persistent-character-binding-hardening.js');

// 11.11.6 — Cross-Video Character Continuity Gate consumes only the hardened current binding set.
syntax(['phase11-cross-video-character-continuity.js', 'verify-phase11-cross-video-character-continuity.js', 'templates/cross-video-character-continuity-gate-v11.js']);
requireFiles(['templates/cross-video-character-continuity-db-tables-v11.txt', 'templates/cross-video-character-continuity-db-methods-v11.txt'], 'Phase 11.11.6');
require('./phase11-cross-video-character-continuity.js');
run('verify-phase11-cross-video-character-continuity.js');

// 11.11.7 — Character Library UI + audited, atomic operator controls.
syntax(['phase11-persistent-character-library-ui.js', 'verify-phase11-persistent-character-library-ui.js', 'templates/persistent-character-library-manager-v11.js', 'templates/persistent-character-library-dashboard-v11.js']);
requireFiles(['templates/persistent-character-operator-db-tables-v11.txt', 'templates/persistent-character-operator-db-methods-v11.txt', 'templates/persistent-character-library-dashboard-v11.css'], 'Phase 11.11.7');
require('./phase11-persistent-character-library-ui.js');
run('verify-phase11-persistent-character-library-ui.js');

// 11.11.8 — deterministic integrated multi-episode closeout for 11.11.1–11.11.7.
syntax(['phase11-persistent-character-e2e.js', 'verify-phase11-persistent-character-e2e.js', 'e2e/character-system-memory-db.js', 'e2e/character-system-fixtures.js']);
require('./phase11-persistent-character-e2e.js');
run('verify-phase11-persistent-character-e2e.js');

// Phase 5 hardening — Story/explicit fiction must not treat plot events as factual claims.
// Documentary/true-story intent remains on the normal strict Evidence Desk path.
syntax(['fix-phase5-fiction-evidence.js', 'verify-phase5-fiction-evidence.js', 'templates/fiction-evidence-policy-v5.js']);
requireFiles(['templates/fiction-evidence-policy-v5.js'], 'Phase 5 fiction evidence hardening');
require('./fix-phase5-fiction-evidence.js');
run('verify-phase5-fiction-evidence.js');

// 11.12.1 — persistent, revisioned Series Bible for serialized narrative memory.
// It runs after fiction evidence hardening so the Script Writer receives both policies in a deterministic order.
syntax(['phase11-serialized-series-bible.js', 'verify-phase11-serialized-series-bible.js', 'templates/serialized-series-bible-v12.js']);
requireFiles(['templates/serialized-series-bible-db-tables-v12.txt', 'templates/serialized-series-bible-db-methods-v12.txt'], 'Phase 11.12.1');
require('./phase11-serialized-series-bible.js');
run('verify-phase11-serialized-series-bible.js');

// 11.12.2 — atomic, append-only Canonical Timeline layered on the validated Series Bible.
syntax(['phase11-canonical-timeline.js', 'verify-phase11-canonical-timeline.js', 'templates/canonical-timeline-v12.js']);
requireFiles(['templates/canonical-timeline-db-tables-v12.txt', 'templates/canonical-timeline-db-methods-v12.txt'], 'Phase 11.12.2');
require('./phase11-canonical-timeline.js');
run('verify-phase11-canonical-timeline.js');

// 11.12.3 — post-approval Episode Memory / Ledger with atomic Series Bible advancement.
syntax(['phase11-episode-memory.js', 'verify-phase11-episode-memory.js', 'templates/episode-memory-v12.js']);
requireFiles(['templates/episode-memory-db-tables-v12.txt', 'templates/episode-memory-db-methods-v12.txt'], 'Phase 11.12.3');
require('./phase11-episode-memory.js');
run('verify-phase11-episode-memory.js');

// 11.12.4 — per-character narrative arc state committed only after finalized Episode Memory.
syntax(['phase11-character-arc-memory.js', 'verify-phase11-character-arc-memory.js', 'templates/character-arc-memory-v12.js']);
requireFiles(['templates/character-arc-memory-db-tables-v12.txt', 'templates/character-arc-memory-db-methods-v12.txt'], 'Phase 11.12.4');
require('./phase11-character-arc-memory.js');
run('verify-phase11-character-arc-memory.js');

// 11.12.5 — directed inter-character Relationship State Graph layered on Character Arc Memory.
syntax(['phase11-relationship-state-graph.js', 'verify-phase11-relationship-state-graph.js', 'templates/relationship-state-graph-v12.js']);
requireFiles(['templates/relationship-state-graph-db-tables-v12.txt', 'templates/relationship-state-graph-db-methods-v12.txt'], 'Phase 11.12.5');
require('./phase11-relationship-state-graph.js');
run('verify-phase11-relationship-state-graph.js');

// 11.12.6 — explicit lifecycle registry for serialized plot threads and narrative obligations.
syntax(['phase11-plot-thread-registry.js', 'verify-phase11-plot-thread-registry.js', 'templates/plot-thread-registry-v12.js']);
requireFiles(['templates/plot-thread-registry-db-tables-v12.txt', 'templates/plot-thread-registry-db-methods-v12.txt'], 'Phase 11.12.6');
require('./phase11-plot-thread-registry.js');
run('verify-phase11-plot-thread-registry.js');

// 11.12.7 — deterministic, read-only Narrative Context Resolver across all serialized memory layers.
syntax(['phase11-narrative-context-resolver.js', 'verify-phase11-narrative-context-resolver.js']);
requireFiles(['templates/narrative-context-resolver-v12.js'], 'Phase 11.12.7');
require('./phase11-narrative-context-resolver.js');
run('verify-phase11-narrative-context-resolver.js');
