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
  if (index === -1) throw new Error('News candidate anchor not found: ' + label);
  return text.slice(0, index) + to + text.slice(index + from.length);
}
function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error('News candidate anchor not found: ' + label);
  return text.slice(0, index) + block + text.slice(index);
}

let source = read('agents/content-strategy-agent.js');
const helper = [
  "  async loadNewsroomResearchCandidates(channelStrategy, targetCount) {",
  "    const pillars = channelStrategy.contentPillars || [];",
  "    const preferredPillar = pillars.find(pillar => /news|world|global|affairs|econom|science|technology|health|environment|diplom|conflict|election|weather|disaster/i.test(String(pillar))) || pillars[0] || '';",
  "    try {",
  "      const clusters = await this.db.getAllRows(\"SELECT id, canonical_title, source_count, independent_evidence_units, confidence_score, global_score, freshness_score, article_ids_json, last_seen_at FROM global_news_clusters WHERE status = 'active' AND last_seen_at >= datetime('now', '-24 hours') AND source_count >= 2 AND independent_evidence_units >= 2 ORDER BY confidence_score DESC, global_score DESC, freshness_score DESC, last_seen_at DESC LIMIT 12\");",
  "      const output = [];",
  "      for (const cluster of clusters) {",
  "        let articleIds = [];",
  "        try { articleIds = JSON.parse(cluster.article_ids_json || '[]'); } catch (_error) { articleIds = []; }",
  "        const articles = [];",
  "        for (const articleId of articleIds.slice(0, 12)) {",
  "          const article = await this.db.getRow('SELECT * FROM global_news_articles WHERE id = ?', [articleId]);",
  "          if (article?.url && article?.source_domain) articles.push(article);",
  "        }",
  "        const byDomain = new Map();",
  "        for (const article of articles) if (!byDomain.has(article.source_domain)) byDomain.set(article.source_domain, article);",
  "        const independent = [...byDomain.values()];",
  "        if (independent.length < 2) continue;",
  "        const selected = independent.slice(0, 6);",
  "        output.push({",
  "          topic: String(cluster.canonical_title || '').trim(),",
  "          pillar: preferredPillar,",
  "          angle: 'Investigate this developing global story, corroborate key facts across independent sources, explain what is confirmed and uncertain, and why it matters.',",
  "          rationale: 'Global Newsroom research candidate with ' + independent.length + ' independent source domains. Downstream Research and Evidence remain mandatory before scripting.',",
  "          format: 'explainer',",
  "          length: channelStrategy.default_length || 'medium',",
  "          sourceUrls: selected.map(article => article.url),",
  "          newsroomClusterId: cluster.id,",
  "          newsroomAction: 'RESEARCH_CANDIDATE',",
  "          requiresNewsCorroboration: true,",
  "          newsroomCandidateDomains: selected.map(article => article.source_domain),",
  "          newsroomSources: selected.map(article => ({ url: article.url, title: article.title, publisher: article.source_name || article.source_domain, publishedAt: article.published_at || null, sourceType: 'article', sourceClass: 'web', status: 'verified', evidenceText: String(article.summary || article.title || '').slice(0, 3000), notes: 'Global Newsroom multi-source candidate; deep verification is mandatory before scripting.' }))",
  "        });",
  "        if (output.length >= Math.max(1, Math.min(Number(targetCount || 1), 3))) break;",
  "      }",
  "      return output;",
  "    } catch (error) {",
  "      this.logger.warn('Global Newsroom research candidates unavailable to channel planner: ' + error.message);",
  "      return [];",
  "    }",
  "  }",
  "",
  ""
].join('\n');
source = insertBefore(source, "  async researchAndPlanChannel(channelStrategy) {\n", helper, 'candidate loader');

const oldHold = [
  "      research.sources = ['Global Newsroom: no verified actionable assignment available'];",
  "      research.holdReason = 'No verified Global Newsroom story is currently ready for autonomous production. The operator will wait rather than fill a news channel with generic evergreen topics.';",
  "      return { research, plan: [] };"
].join('\n');
const newHold = [
  "      const candidatePlan = await this.loadNewsroomResearchCandidates(channelStrategy, targetCount);",
  "      if (candidatePlan.length) {",
  "        const candidateCatalog = candidatePlan.flatMap(item => item.newsroomSources || []);",
  "        research.sourceCatalog = [...new Map([...(research.sourceCatalog || []), ...candidateCatalog].filter(item => item?.url).map(item => [item.url, item])).values()];",
  "        research.sources = ['Global Newsroom multi-source candidate', 'Deep Research + Evidence verification required'];",
  "        research.newsroomCandidates = candidatePlan.map(item => ({ clusterId: item.newsroomClusterId, topic: item.topic, sourceUrls: item.sourceUrls, sourceDomains: item.newsroomCandidateDomains }));",
  "        const plan = this.normalizeAutonomousPlan(candidatePlan, channelStrategy, Math.min(targetCount, 1), research);",
  "        return { research, plan };",
  "      }",
  "      research.sources = ['Global Newsroom: no verified assignment or multi-source research candidate available'];",
  "      research.holdReason = 'No verified Global Newsroom assignment or sufficiently corroborated multi-source research candidate is currently available. The operator will wait rather than manufacture a news story.';",
  "      return { research, plan: [] };"
].join('\n');
source = replaceOnce(source, oldHold, newHold, 'candidate fallback');

const oldMeta = [
  "        newsroomAssignmentId: item.newsroomAssignmentId ? String(item.newsroomAssignmentId).slice(0, 200) : null,",
  "        newsroomAction: item.newsroomAction ? String(item.newsroomAction).slice(0, 40) : null"
].join('\n');
const newMeta = [
  "        newsroomAssignmentId: item.newsroomAssignmentId ? String(item.newsroomAssignmentId).slice(0, 200) : null,",
  "        newsroomAction: item.newsroomAction ? String(item.newsroomAction).slice(0, 40) : null,",
  "        newsroomClusterId: item.newsroomClusterId ? String(item.newsroomClusterId).slice(0, 200) : null,",
  "        requiresNewsCorroboration: Boolean(item.requiresNewsCorroboration),",
  "        newsroomCandidateDomains: Array.isArray(item.newsroomCandidateDomains) ? [...new Set(item.newsroomCandidateDomains.map(value => String(value).toLowerCase()).filter(Boolean))].slice(0, 12) : []"
].join('\n');
source = replaceOnce(source, oldMeta, newMeta, 'candidate plan metadata');
write('agents/content-strategy-agent.js', source);

let operator = read('utils/autonomous-channel-operator.js');
const oldContext = [
  "                newsroomAssignmentId: item.newsroomAssignmentId || null,",
  "                newsroomAction: item.newsroomAction || null"
].join('\n');
const newContext = [
  "                newsroomAssignmentId: item.newsroomAssignmentId || null,",
  "                newsroomAction: item.newsroomAction || null,",
  "                newsroomClusterId: item.newsroomClusterId || null,",
  "                requiresNewsCorroboration: Boolean(item.requiresNewsCorroboration),",
  "                newsroomCandidateDomains: Array.isArray(item.newsroomCandidateDomains) ? item.newsroomCandidateDomains : []"
].join('\n');
operator = replaceOnce(operator, oldContext, newContext, 'operator candidate context');
write('utils/autonomous-channel-operator.js', operator);

console.log('Global-news multi-source research-candidate fallback active.');
