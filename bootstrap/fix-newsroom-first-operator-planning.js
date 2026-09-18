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
  if (index === -1) throw new Error('Newsroom-first operator planning anchor not found: ' + label);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error('Newsroom-first operator planning anchor not found: ' + label);
  return text.slice(0, index) + block + text.slice(index);
}

function patchContentStrategy() {
  let source = read('agents/content-strategy-agent.js');

  source = replaceOnce(
    source,
    "    const targetCount = Math.max(1, Math.min(5, Number(channelStrategy.videos_per_run || 1)));",
    "    const targetCount = Math.max(1, Math.min(12, Number(channelStrategy.videos_per_run || 1)));",
    'planner target count'
  );

  const helpers = [
    "  isNewsChannelStrategy(channelStrategy = {}) {",
    "    const strategyText = [channelStrategy.objective, channelStrategy.audience, channelStrategy.value_proposition, channelStrategy.constraints, ...(channelStrategy.contentPillars || [])].filter(Boolean).join(' ').toLowerCase();",
    "    return /\\b(global news|world news|breaking news|current events|world events|global developments|news channel|newsroom)\\b/.test(strategyText);",
    "  }",
    "",
    "  async loadNewsroomAssignments(channelStrategy, targetCount) {",
    "    const pillars = channelStrategy.contentPillars || [];",
    "    const preferredPillar = pillars.find(pillar => /news|world|global|affairs|econom|science|technology|health|environment|diplom|conflict|election|weather|disaster/i.test(String(pillar))) || pillars[0] || '';",
    "    try {",
    "      const sql = \"SELECT a.id, a.idea_id, a.topic, a.angle, a.format, a.source_urls_json, a.source_domains_json, a.created_at, d.action AS newsroom_action, d.rationale AS newsroom_rationale \" +",
    "        \"FROM global_news_assignments a \" +",
    "        \"JOIN content_ideas i ON i.id = a.idea_id \" +",
    "        \"LEFT JOIN global_news_editor_decisions d ON d.id = a.decision_id \" +",
    "        \"WHERE i.status = 'backlog' AND a.created_at >= datetime('now', '-72 hours') \" +",
    "        \"ORDER BY CASE d.action WHEN 'BREAKING' THEN 0 WHEN 'UPDATE' THEN 1 WHEN 'COVER' THEN 2 WHEN 'FOLLOW_UP' THEN 3 ELSE 4 END, a.created_at DESC LIMIT ?\";",
    "      const rows = await this.db.getAllRows(sql, [Math.max(1, Number(targetCount || 1))]);",
    "      return rows.map(row => {",
    "        let sourceUrls = [];",
    "        try { sourceUrls = JSON.parse(row.source_urls_json || '[]'); } catch (_error) { sourceUrls = []; }",
    "        const action = String(row.newsroom_action || 'COVER').toUpperCase();",
    "        return {",
    "          topic: String(row.topic || '').trim(),",
    "          pillar: preferredPillar,",
    "          angle: String(row.angle || '').trim(),",
    "          rationale: String(row.newsroom_rationale || ('Global Newsroom ' + action + ' assignment selected after evidence-aware editorial review.')).trim(),",
    "          format: 'explainer',",
    "          length: action === 'BREAKING' ? 'short' : (channelStrategy.default_length || 'medium'),",
    "          sourceUrls: Array.isArray(sourceUrls) ? sourceUrls : [],",
    "          ideaId: row.idea_id,",
    "          newsroomAssignmentId: row.id,",
    "          newsroomAction: action",
    "        };",
    "      }).filter(item => item.topic);",
    "    } catch (error) {",
    "      this.logger.warn('Global Newsroom assignments unavailable to channel planner: ' + error.message);",
    "      return [];",
    "    }",
    "  }",
    "",
    ""
  ].join('\n');

  source = insertBefore(source, "  async researchAndPlanChannel(channelStrategy) {\n", helpers, 'news helpers');

  const oldTail = [
    "    let plan = await this.generateAutonomousPlanWithAI(channelStrategy, research, targetCount);",
    "    plan = this.normalizeAutonomousPlan(plan, channelStrategy, targetCount, research);",
    "    if (plan.length < targetCount) {",
    "      const fallback = this.buildFallbackAutonomousPlan(channelStrategy, research, targetCount);",
    "      plan = this.normalizeAutonomousPlan([...plan, ...fallback], channelStrategy, targetCount, research);",
    "    }",
    "",
    "    return { research, plan };"
  ].join('\n');

  const newTail = [
    "    const newsStrategy = this.isNewsChannelStrategy(channelStrategy);",
    "    if (newsStrategy) {",
    "      const newsroomPlan = await this.loadNewsroomAssignments(channelStrategy, targetCount);",
    "      const newsroomCatalog = newsroomPlan.flatMap(item => item.sourceUrls || []).map(url => {",
    "        let publisher = '';",
    "        try { publisher = new URL(url).hostname.replace(/^www\\./, ''); } catch (_error) {}",
    "        return { url, title: 'Global Newsroom source', publisher, sourceType: 'article', status: 'verified' };",
    "      });",
    "      research.sourceCatalog = [...new Map([...(research.sourceCatalog || []), ...newsroomCatalog].filter(item => item && item.url).map(item => [item.url, item])).values()];",
    "      research.newsroomAssignments = newsroomPlan.map(item => ({ assignmentId: item.newsroomAssignmentId, ideaId: item.ideaId, action: item.newsroomAction, topic: item.topic, sourceUrls: item.sourceUrls }));",
    "      if (newsroomPlan.length) {",
    "        research.sources = ['Global Newsroom verified assignments', ...research.sources.filter(source => source !== 'No usable live signals returned; evergreen strategy fallback')];",
    "        const plan = this.normalizeAutonomousPlan(newsroomPlan, channelStrategy, targetCount, research);",
    "        return { research, plan };",
    "      }",
    "      research.sources = ['Global Newsroom: no verified actionable assignment available'];",
    "      research.holdReason = 'No verified Global Newsroom story is currently ready for autonomous production. The operator will wait rather than fill a news channel with generic evergreen topics.';",
    "      return { research, plan: [] };",
    "    }",
    "",
    "    let plan = await this.generateAutonomousPlanWithAI(channelStrategy, research, targetCount);",
    "    plan = this.normalizeAutonomousPlan(plan, channelStrategy, targetCount, research);",
    "    if (plan.length < targetCount) {",
    "      const fallback = this.buildFallbackAutonomousPlan(channelStrategy, research, targetCount);",
    "      plan = this.normalizeAutonomousPlan([...plan, ...fallback], channelStrategy, targetCount, research);",
    "    }",
    "",
    "    return { research, plan };"
  ].join('\n');

  source = replaceOnce(source, oldTail, newTail, 'newsroom-first plan');

  const oldMeta = [
    "        sourceUrls: [...new Set((Array.isArray(item.sourceUrls) ? item.sourceUrls : [])",
    "          .map(url => String(url))",
    "          .filter(url => allowedSourceUrls.has(url)))]"
  ].join('\n');
  const newMeta = [
    "        sourceUrls: [...new Set((Array.isArray(item.sourceUrls) ? item.sourceUrls : [])",
    "          .map(url => String(url))",
    "          .filter(url => allowedSourceUrls.has(url)))],",
    "        ideaId: item.ideaId ? String(item.ideaId).slice(0, 200) : null,",
    "        newsroomAssignmentId: item.newsroomAssignmentId ? String(item.newsroomAssignmentId).slice(0, 200) : null,",
    "        newsroomAction: item.newsroomAction ? String(item.newsroomAction).slice(0, 40) : null"
  ].join('\n');
  source = replaceOnce(source, oldMeta, newMeta, 'newsroom metadata');

  write('agents/content-strategy-agent.js', source);
}

function patchOperator() {
  let source = read('utils/autonomous-channel-operator.js');

  source = replaceOnce(
    source,
    "      if (!plan.length) throw new Error('Research did not produce any usable content ideas');",
    [
      "      if (!plan.length && research?.holdReason) {",
      "        const summary = { planned: 0, generated: 0, needsReview: 0, failed: 0 };",
      "        await this.update(runId, { status: 'completed_with_issues', stage: 'waiting_for_verified_news', progress: 100, research, plan: [], generatedJobs, summary, error: research.holdReason, completedAt: new Date().toISOString() });",
      "        await this.notify({ type: 'autonomous_run_waiting_news', level: 'info', title: 'Waiting for verified news', message: research.holdReason, data: { runId } });",
      "        return;",
      "      }",
      "      if (!plan.length) throw new Error('Research did not produce any usable content ideas');"
    ].join('\n'),
    'safe news hold'
  );

  const oldIdea = [
    "        let ideaId = record?.ideaId;",
    "        if (!record) {",
    "          const idea = await this.db.createContentIdea({",
    "            topic: item.topic,",
    "            angle: item.angle,",
    "            style: item.format,",
    "            status: 'generating',",
    "            rationale: item.rationale",
    "          });",
    "          ideaId = idea.id;",
    "          record = { jobId: null, ideaId, topic: item.topic, status: 'queued', planIndex: index };",
    "          generatedJobs[index] = record;",
    "        } else if (ideaId) {",
    "          await this.db.updateContentIdea(ideaId, { status: 'generating' });",
    "        }"
  ].join('\n');

  const newIdea = [
    "        let ideaId = record?.ideaId || item.ideaId || null;",
    "        if (!record) {",
    "          if (ideaId) {",
    "            await this.db.updateContentIdea(ideaId, { status: 'generating' });",
    "          } else {",
    "            const idea = await this.db.createContentIdea({",
    "              topic: item.topic,",
    "              angle: item.angle,",
    "              style: item.format,",
    "              status: 'generating',",
    "              rationale: item.rationale",
    "            });",
    "            ideaId = idea.id;",
    "          }",
    "          record = { jobId: null, ideaId, topic: item.topic, status: 'queued', planIndex: index };",
    "          generatedJobs[index] = record;",
    "        } else if (ideaId) {",
    "          await this.db.updateContentIdea(ideaId, { status: 'generating' });",
    "        }"
  ].join('\n');
  source = replaceOnce(source, oldIdea, newIdea, 'reuse newsroom idea');

  source = replaceOnce(
    source,
    "                researchSources: (research.sourceCatalog || []).filter(source => selectedSourceUrls.has(source.url))\n",
    "                researchSources: (research.sourceCatalog || []).filter(source => selectedSourceUrls.has(source.url)),\n                newsroomAssignmentId: item.newsroomAssignmentId || null,\n                newsroomAction: item.newsroomAction || null\n",
    'newsroom generation metadata'
  );

  write('utils/autonomous-channel-operator.js', source);
}

function patchDashboard() {
  let source = read('dashboard/app.js');
  const marker = '$' + '{';
  const oldLine = "      <p>" + marker + "escapeHTML(item.angle || item.rationale)}</p>";
  const newLine = oldLine + "\n      " + marker + "job?.error ? '<p class=\"callout\">' + escapeHTML(job.error) + '</p>' : ''}";
  source = replaceOnce(source, oldLine, newLine, 'per-item generation error');
  write('dashboard/app.js', source);
}

function patchPackage() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:newsroom-first-operator'] = 'node ../bootstrap/verify-newsroom-first-operator-planning.js';
  write('package.json', JSON.stringify(pkg, null, 2) + '\n');
}

patchContentStrategy();
patchOperator();
patchDashboard();
patchPackage();

console.log('Newsroom-first operator planning active.');
