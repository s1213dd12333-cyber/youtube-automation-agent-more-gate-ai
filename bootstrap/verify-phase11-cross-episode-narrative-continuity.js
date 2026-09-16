'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const read = rel => fs.readFileSync(path.join(upstream, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

class MemoryDb {
  constructor() {
    this.bibles = new Map(); this.timeline = []; this.memories = []; this.arcs = []; this.arcCommits = new Map();
    this.relationships = []; this.relationshipCommits = new Map(); this.threads = []; this.threadCommits = new Map();
    this.reports = []; this.finalizeCalls = 0;
  }
  clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  seedBible(v) { this.bibles.set(v.id, this.clone(v)); }
  seedTimeline(v) { this.timeline.push(this.clone(v)); }
  seedMemory(v) { this.memories.push(this.clone(v)); }
  seedArc(v, commits = []) { this.arcs.push(this.clone(v)); this.arcCommits.set(v.id, this.clone(commits)); }
  seedRelationship(v, commits = []) { this.relationships.push(this.clone(v)); this.relationshipCommits.set(v.id, this.clone(commits)); }
  seedThread(v, commits = []) { this.threads.push(this.clone(v)); this.threadCommits.set(v.id, this.clone(commits)); }
  async getSerializedSeriesBible(id) { return this.clone(this.bibles.get(id) || null); }
  async listSerializedTimelineEvents(seriesId) { return this.timeline.filter(v => v.seriesId === seriesId).map(v => this.clone(v)); }
  async getSerializedTimelineState(seriesId) { return { seriesId, revisionNumber: 9, lastChronologyIndex: 5000 }; }
  async listSerializedEpisodeMemories(seriesId) { return this.memories.filter(v => v.seriesId === seriesId).map(v => this.clone(v)); }
  async getSerializedEpisodeMemory(seriesId, episodeNumber) { return this.clone(this.memories.find(v => v.seriesId === seriesId && Number(v.episodeNumber) === Number(episodeNumber)) || null); }
  async listSerializedCharacterArcs(seriesId, _limit, includeRetired = false) { return this.arcs.filter(v => v.seriesId === seriesId && (includeRetired || v.status === 'active')).map(v => this.clone(v)); }
  async listSerializedCharacterArcCommits(id) { return this.clone(this.arcCommits.get(id) || []); }
  async listSerializedRelationshipStates(seriesId, _limit, includeArchived = false) { return this.relationships.filter(v => v.seriesId === seriesId && (includeArchived || v.status === 'active')).map(v => this.clone(v)); }
  async listSerializedRelationshipCommits(id) { return this.clone(this.relationshipCommits.get(id) || []); }
  async listSerializedPlotThreads(seriesId, _limit, includeTerminal = false) { return this.threads.filter(v => v.seriesId === seriesId && (includeTerminal || ['open', 'dormant'].includes(v.status))).map(v => this.clone(v)); }
  async listSerializedPlotThreadCommits(id) { return this.clone(this.threadCommits.get(id) || []); }
  async saveSerializedNarrativeContinuityReport(report) { const existing = this.reports.find(v => v.id === report.id); if (existing) return this.clone(existing); this.reports.push(this.clone(report)); return this.clone(report); }
  async getSerializedNarrativeContinuityReport(id) { return this.clone(this.reports.find(v => v.id === id) || null); }
  async listSerializedNarrativeContinuityReports(seriesId, episodeNumber) { return this.reports.filter(v => v.seriesId === seriesId && Number(v.episodeNumber) === Number(episodeNumber)).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(v => this.clone(v)); }
  async getLatestPassingNarrativeContinuityReport(seriesId, episodeNumber, candidateFingerprint) { return this.clone(this.reports.filter(v => v.seriesId === seriesId && Number(v.episodeNumber) === Number(episodeNumber) && v.candidateFingerprint === candidateFingerprint && v.verdict === 'pass').sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null); }
  async getSerializedSeriesStrategyBinding() { return null; }
  async finalizeSerializedEpisodeMemoryAtomic(input = {}) {
    this.finalizeCalls += 1;
    const saved = { ...this.clone(input.memory), id: input.memory.id || 'mem3', seriesId: input.seriesId, revisionNumber: 1, status: 'finalized' };
    this.memories.push(saved);
    const bible = this.bibles.get(input.seriesId); bible.currentEpisode = saved.episodeNumber; bible.revisionNumber += 1;
    return { memory: this.clone(saved), bible: this.clone(bible), commit: { id: 'commit3', episodeNumber: saved.episodeNumber } };
  }
}

class FakeResolver {
  constructor() { this.fingerprint = 'ctx_v1'; }
  async resolveContext(serializedSeriesContext, input = {}) { return { active: true, seriesId: serializedSeriesContext.bible.id, targetEpisode: input.episodeNumber, fingerprint: this.fingerprint, focus: input.focus || {}, promptContext: 'resolved' }; }
  async stateBeforeTarget(item, targetEpisode, listCommits, revisionField, episodeField) {
    if (Number(item[episodeField] || 0) < Number(targetEpisode)) return { state: JSON.parse(JSON.stringify(item)), commit: null };
    const commits = await listCommits(item.id, 5000);
    const prior = (commits || []).filter(c => Number(c.episodeNumber || 0) < Number(targetEpisode)).sort((a,b) => Number(b[revisionField] || 0) - Number(a[revisionField] || 0))[0];
    return prior?.afterSnapshot ? { state: JSON.parse(JSON.stringify(prior.afterSnapshot)), commit: prior } : null;
  }
}

function seedBase(db) {
  db.seedBible({ id: 'series_star', status: 'active', currentEpisode: 2, revisionNumber: 7, canonVersion: 2, title: 'Star Harbor', immutableCanon: ['The old station burned before Mara was born.'], worldRules: ['Signals cannot cross the storm wall without a relay.'], narrativeRules: ['Never grant a character knowledge they did not learn.'] });
  db.seedTimeline({ id: 'evt_signal', seriesId: 'series_star', chronologyIndex: 1000, episodeNumber: 1, summary: 'Mara confirms the repeating signal is artificial.', participants: ['mara'], locationRefs: ['station'], causeEventIds: [], consequences: [], mustFollowEventIds: [], mustPrecedeEventIds: [], truthStatus: 'confirmed', eventType: 'discovery', revisionNumber: 1, status: 'active' });
  db.seedTimeline({ id: 'evt_rumor', seriesId: 'series_star', chronologyIndex: 2000, episodeNumber: 2, summary: 'The council built a secret relay under the harbor.', participants: ['dockworker'], locationRefs: ['harbor'], causeEventIds: [], consequences: [], mustFollowEventIds: [], mustPrecedeEventIds: [], truthStatus: 'rumor', eventType: 'rumor', revisionNumber: 1, status: 'active' });
  db.seedTimeline({ id: 'evt_relay', seriesId: 'series_star', chronologyIndex: 3000, episodeNumber: 3, summary: 'Mara reads the relay code in the council record and confronts the archivist.', participants: ['mara', 'ivo'], locationRefs: ['archive'], causeEventIds: ['evt_signal'], consequences: ['Mara learns the relay code', 'The council record is confronted'], mustFollowEventIds: [], mustPrecedeEventIds: [], truthStatus: 'confirmed', eventType: 'discovery', revisionNumber: 1, status: 'active' });
  db.seedMemory({ id: 'mem1', seriesId: 'series_star', episodeNumber: 1, status: 'finalized', summary: 'Mara finds the signal.', unresolvedQuestions: ['Who sent the signal?'], timelineEventIds: ['evt_signal'] });
  db.seedMemory({ id: 'mem2', seriesId: 'series_star', episodeNumber: 2, status: 'finalized', summary: 'A rumor implicates the council.', unresolvedQuestions: ['What did the council erase?'], timelineEventIds: ['evt_rumor'] });
  db.seedArc({ id: 'arc_mara', seriesId: 'series_star', characterKey: 'mara', displayName: 'Mara', knowledge: ['The signal is artificial'], secrets: [], firstEpisodeNumber: 1, lastEpisodeNumber: 2, revisionNumber: 2, status: 'active', arcPhase: 'investigation', storyStatus: 'active' });
  db.seedRelationship({ id: 'rel_mara_ivo', seriesId: 'series_star', sourceCharacterKey: 'mara', targetCharacterKey: 'ivo', firstEpisodeNumber: 1, lastEpisodeNumber: 2, revisionNumber: 2, status: 'active', relationshipState: 'Cautious allies.' });
  db.seedThread({ id: 'thread_coverup', seriesId: 'series_star', threadKey: 'council_coverup', title: 'Council Cover-up', status: 'open', priority: 95, currentState: 'Mara needs to confront the council record.', centralQuestion: 'What did the council erase?', openQuestions: ['What did the council erase?'], narrativePromises: ['Return to the council record'], requiredPayoffs: ['Confront the council record'], involvedCharacterKeys: ['mara', 'ivo'], relationshipEdgeKeys: ['mara->ivo'], introducedEpisodeNumber: 1, lastAdvancedEpisodeNumber: 2, revisionNumber: 3 });
  db.seedThread({ id: 'thread_done', seriesId: 'series_star', threadKey: 'lost_signal', title: 'Lost Signal', status: 'resolved', priority: 80, currentState: 'Resolved.', centralQuestion: 'Who sent it?', openQuestions: [], narrativePromises: [], requiredPayoffs: [], involvedCharacterKeys: ['mara'], relationshipEdgeKeys: [], introducedEpisodeNumber: 1, lastAdvancedEpisodeNumber: 2, resolvedEpisodeNumber: 2, revisionNumber: 4 });
}

function goodCandidate() {
  return {
    episodeNumber: 3, title: 'Council Record', summary: 'Mara confronts the council record and reads the relay code with Ivo.',
    discoveries: ['The archive contains a relay code.'], establishedFacts: ['The council record contains the relay code.'], resolvedQuestions: ['What did the council erase?'], unresolvedQuestions: ['Who authorized the erased record?'], narrativePromises: ['Trace who authorized the erasure.'], cliffhangers: ['The code points beyond the harbor.'], timelineEventIds: ['evt_relay'],
    continuityManifest: {
      knowledgeUses: [{ characterKey: 'mara', fact: 'Mara learns the relay code', learnedInEpisode: true, supportingEventIds: ['evt_relay'] }],
      characterTransitions: [{ characterKey: 'mara', expectedRevision: 2, arcPhase: 'confrontation', supportingEventIds: ['evt_relay'] }],
      relationshipTransitions: [{ edgeKey: 'mara->ivo', expectedRevision: 2, relationshipState: 'They cooperate on the record.', supportingEventIds: ['evt_relay'] }],
      plotThreadActions: [{ threadKey: 'council_coverup', action: 'advance', expectedRevision: 3, supportingEventIds: ['evt_relay'] }]
    }
  };
}

async function main() {
  for (const rel of ['utils/serialized-series-bible-v12.js', 'utils/canonical-timeline-v12.js', 'utils/episode-memory-v12.js', 'utils/character-arc-memory-v12.js', 'utils/relationship-state-graph-v12.js', 'utils/plot-thread-registry-v12.js', 'utils/narrative-context-resolver-v12.js', 'utils/cross-episode-narrative-continuity-gate-v12.js', 'agents/script-writer-agent.js', 'database/db.js', 'index.js']) execFileSync(process.execPath, ['--check', path.join(upstream, rel)], { stdio: 'inherit' });
  checks += 11;

  const serviceSource = read('utils/cross-episode-narrative-continuity-gate-v12.js'); const episodeSource = read('utils/episode-memory-v12.js'); const dbSource = read('database/db.js'); const indexSource = read('index.js'); const envSource = read('.env.example'); const pkg = JSON.parse(read('package.json'));
  check(serviceSource.includes("const VERSION = '11.12.8'"), 'continuity gate version missing');
  check(serviceSource.includes('narrative_continuity_context_stale'), 'context freshness guard missing');
  check(serviceSource.includes('continuity_immutable_canon_contradiction'), 'immutable canon contradiction check missing');
  check(serviceSource.includes('continuity_uncertain_truth_promoted'), 'truth promotion check missing');
  check(serviceSource.includes('continuity_impossible_character_knowledge'), 'character knowledge check missing');
  check(serviceSource.includes('continuity_high_priority_thread_unaddressed'), 'open-thread obligation check missing');
  check(serviceSource.includes('continuity_stale_character_arc_revision'), 'Character Arc revision guard missing');
  check(serviceSource.includes('continuity_stale_relationship_revision'), 'relationship revision guard missing');
  check(serviceSource.includes('continuity_stale_plot_thread_revision'), 'plot-thread revision guard missing');
  check(serviceSource.includes('continuity_required_payoff_missing'), 'required payoff guard missing');
  check(!serviceSource.includes('commitSerializedTimeline') && !serviceSource.includes('commitSerializedPlotThreads') && !serviceSource.includes('finalizeSerializedEpisodeMemoryAtomic'), 'continuity gate must not mutate canon');
  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_narrative_continuity_reports'), 'continuity report table missing');
  check(dbSource.includes("CHECK(verdict IN ('pass', 'block'))"), 'continuity report verdict constraint missing');
  check(dbSource.includes('getLatestPassingNarrativeContinuityReport') && dbSource.includes('saveSerializedNarrativeContinuityReport'), 'continuity report DB methods missing');
  check(episodeSource.includes("require('./cross-episode-narrative-continuity-gate-v12')"), 'Episode Memory continuity gate integration missing');
  check(episodeSource.includes('await continuityGate.verifyPassingReport(seriesId, memory.episodeNumber, memory)'), 'Episode Memory PASS verification missing');
  check(episodeSource.includes("reason: continuity.reason || 'narrative_continuity_pass_required'"), 'Episode Memory fail-closed reason missing');
  check(indexSource.includes("this.app.post('/api/series-bibles/:seriesId/episodes/:episodeNumber/continuity/check', protect"), 'protected continuity check route missing');
  check(indexSource.includes("this.app.get('/api/series-bibles/:seriesId/episodes/:episodeNumber/continuity/reports', protect"), 'protected continuity reports route missing');
  check(indexSource.includes("this.app.post('/api/series-bibles/:seriesId/episodes/:episodeNumber/continuity/verify-pass', protect"), 'protected continuity verify route missing');
  check(envSource.includes('SERIALIZED_NARRATIVE_CONTINUITY_GATE_ENABLED=true'), 'continuity gate env toggle missing');
  check(envSource.includes('SERIALIZED_NARRATIVE_CONTINUITY_REQUIRE_PASS=true'), 'continuity required-pass env missing');
  check(envSource.includes('SERIALIZED_NARRATIVE_CONTINUITY_BLOCK_THREAD_PRIORITY=90'), 'continuity thread blocker threshold missing');
  check(pkg.scripts?.['test:narrative-continuity-gate'] === 'node ../bootstrap/verify-phase11-cross-episode-narrative-continuity.js', 'continuity npm test command missing');

  const { CrossEpisodeNarrativeContinuityGateV12, normalizeManifest, candidateFingerprint, statementsContradict, similarity } = require(path.join(upstream, 'utils', 'cross-episode-narrative-continuity-gate-v12.js'));
  check(statementsContradict('The station burned before Mara was born.', 'The station did not burn before Mara was born.'), 'deterministic negation contradiction failed');
  check(!statementsContradict('The station burned before Mara was born.', 'Mara visits the burned station.'), 'non-contradictory statement falsely rejected');
  check(similarity('Council record relay code', 'The relay code appears in the council record') >= 0.5, 'continuity text similarity unexpectedly weak');
  const nm = normalizeManifest({ continuityManifest: { relationshipTransitions: [{ edgeKey: ' Mara -> Ivo ' }], plotThreadActions: [{ threadKey: 'Council_Coverup', action: 'resolve' }] } });
  check(nm.relationshipTransitions[0].edgeKey === 'mara->ivo' && nm.plotThreadActions[0].threadKey === 'council_coverup', 'manifest canonical key normalization failed');

  const db = new MemoryDb(); seedBase(db); const resolver = new FakeResolver(); const gate = new CrossEpisodeNarrativeContinuityGateV12(db, { resolver, blockThreadPriority: 90, warnThreadPriority: 70 });
  const mismatch = await gate.evaluateEpisode('series_star', 3, { ...goodCandidate(), timelineEventIds: [] }, { actor: 'showrunner' });
  check(mismatch.verdict === 'block' && mismatch.blockers.some(v => v.code === 'continuity_timeline_set_mismatch'), 'Timeline mismatch must block');
  const canonConflict = await gate.evaluateEpisode('series_star', 3, { ...goodCandidate(), summary: 'The old station did not burn before Mara was born, and Mara checks the council record.' }, { actor: 'showrunner' });
  check(canonConflict.blockers.some(v => v.code === 'continuity_immutable_canon_contradiction'), 'immutable canon contradiction was not blocked');
  const rumorPromotion = await gate.evaluateEpisode('series_star', 3, { ...goodCandidate(), establishedFacts: ['The council built a secret relay under the harbor.'] }, { actor: 'showrunner' });
  check(rumorPromotion.blockers.some(v => v.code === 'continuity_uncertain_truth_promoted'), 'uncertain Timeline truth promotion was not blocked');

  const impossibleKnowledge = goodCandidate(); impossibleKnowledge.continuityManifest.knowledgeUses = [{ characterKey: 'mara', fact: 'The mayor is secretly the sender.', learnedInEpisode: false, supportingEventIds: [] }];
  const knowledgeResult = await gate.evaluateEpisode('series_star', 3, impossibleKnowledge, { actor: 'showrunner' });
  check(knowledgeResult.blockers.some(v => v.code === 'continuity_impossible_character_knowledge'), 'impossible character knowledge was not blocked');
  const staleArc = goodCandidate(); staleArc.continuityManifest.characterTransitions[0].expectedRevision = 1;
  const staleArcResult = await gate.evaluateEpisode('series_star', 3, staleArc, { actor: 'showrunner' });
  check(staleArcResult.blockers.some(v => v.code === 'continuity_stale_character_arc_revision'), 'stale Character Arc revision was not blocked');
  const staleRelationship = goodCandidate(); staleRelationship.continuityManifest.relationshipTransitions[0].expectedRevision = 1;
  const staleRelationshipResult = await gate.evaluateEpisode('series_star', 3, staleRelationship, { actor: 'showrunner' });
  check(staleRelationshipResult.blockers.some(v => v.code === 'continuity_stale_relationship_revision'), 'stale relationship revision was not blocked');
  const staleThread = goodCandidate(); staleThread.continuityManifest.plotThreadActions[0].expectedRevision = 1;
  const staleThreadResult = await gate.evaluateEpisode('series_star', 3, staleThread, { actor: 'showrunner' });
  check(staleThreadResult.blockers.some(v => v.code === 'continuity_stale_plot_thread_revision'), 'stale plot-thread revision was not blocked');
  const terminal = goodCandidate(); terminal.continuityManifest.plotThreadActions.push({ threadKey: 'lost_signal', action: 'advance', expectedRevision: 4, supportingEventIds: ['evt_relay'] });
  const terminalResult = await gate.evaluateEpisode('series_star', 3, terminal, { actor: 'showrunner' });
  check(terminalResult.blockers.some(v => v.code === 'continuity_terminal_plot_thread_mutation'), 'terminal plot thread mutation was not blocked');

  db.seedThread({ id: 'thread_diver', seriesId: 'series_star', threadKey: 'missing_diver', title: 'Missing Diver', status: 'open', priority: 96, currentState: 'A rescue diver vanished beneath the south pier.', centralQuestion: 'Where is the missing diver?', openQuestions: ['Where is the missing diver?'], narrativePromises: ['Find the missing diver'], requiredPayoffs: ['Reveal the diver fate'], involvedCharacterKeys: ['ivo'], relationshipEdgeKeys: [], introducedEpisodeNumber: 2, lastAdvancedEpisodeNumber: 2, revisionNumber: 1 });
  const ignored = { episodeNumber: 3, title: 'Side Trip', summary: 'Mara watches the rain far from the archive.', discoveries: [], establishedFacts: [], resolvedQuestions: [], unresolvedQuestions: [], narrativePromises: [], cliffhangers: [], timelineEventIds: ['evt_relay'], continuityManifest: { knowledgeUses: [], characterTransitions: [], relationshipTransitions: [], plotThreadActions: [] } };
  const ignoredResult = await gate.evaluateEpisode('series_star', 3, ignored, { actor: 'showrunner' });
  check(ignoredResult.blockers.some(v => v.code === 'continuity_high_priority_thread_unaddressed' && v.details?.threadKey === 'missing_diver'), 'genuinely ignored high-priority thread did not block');
  const deferred = JSON.parse(JSON.stringify(ignored)); deferred.continuityManifest.plotThreadActions = [
    { threadKey: 'missing_diver', action: 'defer', expectedRevision: 1, reason: 'Episode three deliberately postpones the missing-diver search.' },
    { threadKey: 'council_coverup', action: 'defer', expectedRevision: 3, reason: 'Episode three deliberately postpones further council-coverup work.' }
  ];
  const deferredResult = await gate.evaluateEpisode('series_star', 3, deferred, { actor: 'showrunner' });
  check(!deferredResult.blockers.some(v => v.code === 'continuity_high_priority_thread_unaddressed'), 'explicit thread deferral did not suppress obligation blocker');
  db.threads = db.threads.filter(v => v.threadKey !== 'missing_diver');

  const payoffMissing = goodCandidate(); payoffMissing.summary = 'Mara discovers a code but never confronts the council record.'; payoffMissing.continuityManifest.plotThreadActions[0] = { threadKey: 'council_coverup', action: 'resolve', expectedRevision: 3, supportingEventIds: ['evt_relay'] };
  const payoffResult = await gate.evaluateEpisode('series_star', 3, payoffMissing, { actor: 'showrunner' });
  check(payoffResult.blockers.some(v => v.code === 'continuity_required_payoff_missing') === false, 'fixture should contain payoff text via target Timeline event');
  const coverup = db.threads.find(v => v.threadKey === 'council_coverup'); coverup.requiredPayoffs = ['Publicly expose the mayor on live television'];
  const missingPayoffResult = await gate.evaluateEpisode('series_star', 3, payoffMissing, { actor: 'showrunner' });
  check(missingPayoffResult.blockers.some(v => v.code === 'continuity_required_payoff_missing'), 'missing required payoff was not blocked'); coverup.requiredPayoffs = ['Confront the council record'];

  const passResult = await gate.evaluateEpisode('series_star', 3, goodCandidate(), { actor: 'showrunner' });
  check(passResult.verdict === 'pass', `valid continuity candidate blocked: ${JSON.stringify(passResult.blockers)}`);
  check(passResult.report && passResult.report.id && passResult.contextFingerprint === 'ctx_v1', 'PASS report was not persisted with context fingerprint');
  check((await db.listSerializedNarrativeContinuityReports('series_star', 3)).length >= 1, 'continuity report audit list missing');
  const expectedFingerprint = candidateFingerprint('series_star', 3, goodCandidate(), await gate.targetEvents('series_star', 3));
  check(passResult.candidateFingerprint === expectedFingerprint, 'candidate fingerprint is not deterministic');
  const verified = await gate.verifyPassingReport('series_star', 3, goodCandidate());
  check(verified.valid && verified.report.verdict === 'pass', 'fresh exact PASS report was not accepted');
  const changedCandidate = { ...goodCandidate(), summary: 'Mara changes the approved episode summary materially.' };
  const changedVerify = await gate.verifyPassingReport('series_star', 3, changedCandidate);
  check(!changedVerify.valid && changedVerify.reason === 'narrative_continuity_pass_required', 'changed candidate reused an unrelated PASS report');
  resolver.fingerprint = 'ctx_v2';
  const staleContext = await gate.verifyPassingReport('series_star', 3, goodCandidate());
  check(!staleContext.valid && staleContext.reason === 'narrative_continuity_context_stale', 'stale narrative context did not invalidate PASS report'); resolver.fingerprint = 'ctx_v1';

  const strictManifestGate = new CrossEpisodeNarrativeContinuityGateV12(db, { resolver, requireManifest: true });
  const noManifest = await strictManifestGate.evaluateEpisode('series_star', 3, { ...goodCandidate(), continuityManifest: undefined }, { actor: 'showrunner' });
  check(noManifest.blockers.some(v => v.code === 'continuity_manifest_required'), 'required manifest policy did not block absent manifest');

  const { EpisodeMemoryServiceV12 } = require(path.join(upstream, 'utils', 'episode-memory-v12.js'));
  const dbBlocked = new MemoryDb(); seedBase(dbBlocked);
  const blockedService = new EpisodeMemoryServiceV12(dbBlocked, { continuityGate: { verifyPassingReport: async () => ({ valid: false, reason: 'narrative_continuity_pass_required' }) }, requireContinuityGate: true });
  const approvalPayload = { ...goodCandidate(), approvalId: 'approval_3', approvedBy: 'showrunner', approvalReason: 'Episode three is approved after continuity review.', approvedAt: new Date().toISOString(), approved: true };
  const blockedFinalize = await blockedService.finalizeEpisode('series_star', approvalPayload, { approved: true, actor: 'showrunner', reason: 'Finalize approved episode.' });
  check(blockedFinalize.status === 'conflict' && blockedFinalize.reason === 'narrative_continuity_pass_required', 'Episode Memory finalized without a PASS report');
  check(dbBlocked.finalizeCalls === 0 && (await dbBlocked.getSerializedSeriesBible('series_star')).currentEpisode === 2, 'failed continuity gate mutated Episode Memory/Series Bible');

  const dbPass = new MemoryDb(); seedBase(dbPass);
  const passService = new EpisodeMemoryServiceV12(dbPass, { continuityGate: { verifyPassingReport: async () => ({ valid: true, candidateFingerprint: 'candidate_fp_3', report: { id: 'report_3', verdict: 'pass' } }) }, requireContinuityGate: true });
  const passFinalize = await passService.finalizeEpisode('series_star', approvalPayload, { approved: true, actor: 'showrunner', reason: 'Finalize approved episode.' });
  check(passFinalize.status === 'finalized' && dbPass.finalizeCalls === 1, 'Episode Memory did not finalize after a valid PASS report');
  check(passFinalize.memory.sourceFingerprint === 'candidate_fp_3', 'Episode Memory did not retain continuity candidate fingerprint when source fingerprint was absent');
  check(passFinalize.bible.currentEpisode === 3, 'Series Bible did not advance only after continuity PASS');

  console.log(`Phase 11.12.8 Cross-Episode Narrative Continuity Gate verification passed (${checks} checks).`);
}

main().catch(error => { console.error(error); process.exit(1); });
