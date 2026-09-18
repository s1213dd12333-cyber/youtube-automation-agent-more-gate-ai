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
  if (index === -1) throw new Error('Quality blocker observability anchor not found: ' + label);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

// Expand the terse Phase 9 log into an actionable blocker trace.
let source = read('utils/quality-agents-v9.js');
source = replaceOnce(
  source,
  "    this.logger.info(`Quality Agents v9: ${status}, score=${overallScore}, blockers=${blockingFindings.length}.`);",
  [
    "    if (blockingFindings.length) {",
    "      const blockerSummary = blockingFindings.slice(0, 5).map(item => {",
    "        const id = item.findingId || item.id || 'unknown';",
    "        const agent = item.agentId || item.agentName || 'quality';",
    "        const next = item.remediation ? ` Next: ${item.remediation}` : '';",
    "        return `${agent}/${id}: ${item.message || 'blocking finding'}.${next}`;",
    "      }).join(' | ');",
    "      this.logger.warn(`Quality Agents v9 blocked: score=${overallScore}, blockers=${blockingFindings.length}. ${blockerSummary}`);",
    "    } else {",
    "      this.logger.info(`Quality Agents v9: ${status}, score=${overallScore}, blockers=0.`);",
    "    }"
  ].join('\n'),
  'Phase 9 blocker detail log'
);
write('utils/quality-agents-v9.js', source);

// Keep the blocker details on the autonomous job and log the safe-repair decision.
source = read('utils/autonomous-channel-operator.js');
const oldRepair = [
  "            const repair = await this.observability.planAutomaticRepair(record.productionId, attempts);",
  "            record.repairPlan = { automatic: repair.automatic, stage: repair.stage, reason: repair.reason };",
  "            if (repair.automatic && repair.stage) {"
].join('\n');
const newRepair = [
  "            const repair = await this.observability.planAutomaticRepair(record.productionId, attempts);",
  "            const qualityBlockers = Array.isArray(repair.report?.blockingFindings) ? repair.report.blockingFindings.map(item => ({",
  "              agentId: item.agentId || null, findingId: item.findingId || item.id || null, severity: item.severity || null,",
  "              message: item.message || null, remediation: item.remediation || null",
  "            })) : [];",
  "            record.qualityBlockers = qualityBlockers;",
  "            record.repairPlan = { automatic: repair.automatic, stage: repair.stage, reason: repair.reason };",
  "            const blockerText = qualityBlockers.length ? qualityBlockers.map(item => `${item.agentId || 'quality'}/${item.findingId || 'unknown'}: ${item.message || 'blocking finding'}`).join(' | ') : 'no blocker details';",
  "            if (repair.automatic && repair.stage) this.logger.info(`Quality auto-repair approved for ${record.productionId}: stage=${repair.stage}, reason=${repair.reason}. ${blockerText}`);",
  "            else this.logger.warn(`Quality auto-repair not applied for ${record.productionId}: reason=${repair.reason}, suggestedStage=${repair.stage || 'none'}. ${blockerText}`);",
  "            if (repair.automatic && repair.stage) {"
].join('\n');
source = replaceOnce(source, oldRepair, newRepair, 'operator repair decision detail');
write('utils/autonomous-channel-operator.js', source);

// Classify both Quality Agents and quality-repair messages as the Quality stage in Live Processes.
source = read('utils/process-monitor-service.js');
source = replaceOnce(
  source,
  "  if (/quality council|quality review|quality gate|quality agents/.test(value)) return 'quality';",
  "  if (/quality council|quality review|quality gate|quality agents|quality repair|quality auto-repair/.test(value)) return 'quality';",
  'process monitor quality repair classification'
);
write('utils/process-monitor-service.js', source);

const pkg = JSON.parse(read('package.json'));
pkg.scripts = pkg.scripts || {};
pkg.scripts['test:quality-blocker-observability'] = 'node ../bootstrap/verify-quality-blocker-observability.js';
write('package.json', JSON.stringify(pkg, null, 2) + '\n');

console.log('Quality blocker observability active: blocker IDs/messages/remediation and safe-repair decisions are visible in Live Processes and retained on autonomous job records.');
