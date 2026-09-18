'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const read = rel => fs.readFileSync(path.join(upstream, rel), 'utf8').replace(/\r\n/g, '\n');

(async () => {
  const qualitySource = read('utils/quality-agents-v9.js');
  const operatorSource = read('utils/autonomous-channel-operator.js');
  const monitorSource = read('utils/process-monitor-service.js');

  assert(qualitySource.includes('Quality Agents v9 blocked: score='), 'Phase 9 must log blocker details');
  assert(qualitySource.includes('item.remediation'), 'Phase 9 blocker log must include remediation');
  assert(operatorSource.includes('record.qualityBlockers = qualityBlockers'), 'operator job must retain blocker details');
  assert(operatorSource.includes('Quality auto-repair not applied'), 'operator must log why auto-repair was refused');
  assert(operatorSource.includes('Quality auto-repair approved'), 'operator must log safe automatic repair decisions');
  assert(monitorSource.includes('quality auto-repair'), 'Live Process Monitor must classify repair decisions as quality-stage activity');

  const { QualityAgentsV9 } = require(path.join(upstream, 'utils', 'quality-agents-v9.js'));
  const warnings = [];
  const service = new QualityAgentsV9(null, {
    logger: { info() {}, warn(message) { warnings.push(String(message)); }, error() {} }
  });
  const production = {
    id: 'prod_quality_observability_test',
    strategy: { topic: 'Evidence-backed test topic', evidencePack: { sources: [] } },
    script: {
      title: 'Evidence-backed test title',
      hook: { text: 'Why does this matter and what does the evidence show?' },
      introduction: { topicIntro: 'A concrete evidence-first introduction.' },
      mainContent: { sections: [
        { title: 'One', duration: 40, content: ['First concrete section with enough detail to avoid a missing script.'] },
        { title: 'Two', duration: 40, content: ['Second concrete section with a distinct explanatory purpose.'] },
        { title: 'Three', duration: 40, content: ['Third concrete section that advances the explanation.'] }
      ] },
      conclusion: { recap: ['This conclusion resolves the question using the same topic.'] },
      callToAction: { text: 'See another evidence-first report.' },
      fullScript: 'Why does this matter and what does the evidence show? '.repeat(20),
      claims: []
    },
    seo: { title: 'Evidence-backed test title', description: 'A useful and sufficiently detailed description that clearly explains the subject and what viewers will learn from the report.', tags: ['evidence','report','analysis','news','explainer'] },
    thumbnail: { concept: { subject: 'document and magnifying glass', composition: 'clear evidence comparison' } },
    assets: { thumbnail: {}, finalVideo: { path: 'video.mp4', simulated: false }, sceneManifest: { visualBriefs: {} } },
    scenes: [{ id:'s1', status:'ready', narrationStatus:'current', assetPath:'scene.png', assetOrigin:'generated', rightsConfirmed:true, provider:'local-renderer' }],
    provenance: { status:'not_required', summary:{ unresolvedClaims:0, resolvedClaims:0, verifiedSources:0 } }
  };
  const report = await service.review(production);
  assert.strictEqual(report.status, 'blocked', 'fixture must produce at least one blocker');
  assert(report.blockingFindings.some(item => item.findingId === 'thumbnail_missing_asset'), 'fixture should block on missing thumbnail');
  assert(warnings.length === 1, 'blocked report must emit one warning');
  assert(warnings[0].includes('thumbnail/thumbnail_missing_asset'), 'warning must identify agent and finding');
  assert(warnings[0].includes('Next:'), 'warning must include remediation');

  const { componentStage } = require(path.join(upstream, 'utils', 'process-monitor-service.js'));
  assert.strictEqual(componentStage('AutonomousOperator', 'Quality auto-repair not applied for prod: reason=media_cost_confirmation_required'), 'quality');

  console.log('Quality blocker observability verification passed: blocker identity, remediation, repair decision and Live Process classification are preserved.');
})().catch(error => { console.error(error.stack || error.message || String(error)); process.exit(1); });
