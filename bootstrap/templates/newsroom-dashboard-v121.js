'use strict';

(() => {
  let loading = false;
  let timer = null;

  const node = selector => document.querySelector(selector);
  const esc = value => typeof escapeHTML === 'function' ? escapeHTML(value) : String(value ?? '');
  const chip = value => typeof statusChip === 'function' ? statusChip(String(value || '').toLowerCase()) : `<span class="status">${esc(value)}</span>`;
  const ago = value => typeof timeAgo === 'function' ? timeAgo(value) : String(value || '');

  function scoreBar(score) {
    const safe = Math.max(0, Math.min(100, Number(score || 0)));
    return `<div class="progress"><i style="width:${safe}%"></i></div>`;
  }

  function render(state = {}) {
    const latest = state.latestScan || {};
    const clusters = Array.isArray(state.clusters) ? state.clusters : [];
    const decisions = Array.isArray(state.decisions) ? state.decisions : [];
    const config = state.config || {};

    if (node('#newsroom-last-scan')) node('#newsroom-last-scan').textContent = latest.completed_at ? ago(latest.completed_at) : 'Never';
    if (node('#newsroom-article-count')) node('#newsroom-article-count').textContent = latest.article_count ?? 0;
    if (node('#newsroom-cluster-count')) node('#newsroom-cluster-count').textContent = latest.cluster_count ?? clusters.length;
    if (node('#newsroom-actionable-count')) node('#newsroom-actionable-count').textContent = latest.actionable_count ?? decisions.filter(item => ['COVER','BREAKING','UPDATE','FOLLOW_UP'].includes(item.action)).length;
    if (node('#newsroom-config-summary')) node('#newsroom-config-summary').textContent = `Scans every ${config.scanIntervalMinutes || 10} min · ${config.minIndependentSources || 3}+ independent evidence units · auto-promote ${config.autoPromote ? 'on' : 'off'}`;

    const clusterHost = node('#newsroom-clusters');
    if (clusterHost) {
      clusterHost.innerHTML = clusters.length ? clusters.slice(0, 20).map((item, index) => {
        const s = item.scores || {};
        return `<article class="job-card">
          <div class="job-meta">
            <div class="meta-line">#${index + 1} · Global ${esc(s.globalScore || 0)}/100 · Confidence ${esc(s.confidenceScore || 0)}/100 · ${esc(s.sourceCount || 0)} sources · ${esc(s.regionCount || 0)} regions</div>
            <strong>${esc(item.canonicalTitle || 'Untitled event')}</strong>
            <div class="meta-line">${esc((item.sourceRegions || []).join(', ') || 'Region unknown')} · ${esc(s.velocityScore || 0)}/100 velocity</div>
            ${scoreBar(s.globalScore)}
          </div>
        </article>`;
      }).join('') : '<div class="empty">Run the radar to discover current global stories.</div>';
    }

    const decisionHost = node('#newsroom-decisions');
    if (decisionHost) {
      decisionHost.innerHTML = decisions.length ? decisions.slice(0, 30).map(item => {
        const actionable = ['COVER','BREAKING','UPDATE','FOLLOW_UP'].includes(item.action);
        return `<article class="idea-card">
          <div class="idea-meta">
            <strong>${esc(item.action)}</strong>
            <div class="meta-line">${chip(item.action)} · ${esc(item.scores?.globalScore || 0)}/100 · ${ago(item.createdAt)}</div>
            <p>${esc(item.rationale || '')}</p>
          </div>
          ${actionable && !item.promotedIdeaId ? `<button class="button secondary small" data-newsroom-promote="${esc(item.id)}">Send to backlog</button>` : item.promotedIdeaId ? '<span class="status success">in backlog</span>' : ''}
        </article>`;
      }).join('') : '<div class="empty">No editorial decisions yet.</div>';
    }
  }

  async function loadNewsroom(silent = false) {
    if (loading) return;
    loading = true;
    try {
      const response = await api('/api/newsroom/status');
      render(response.result || {});
    } catch (error) {
      if (!silent && typeof showToast === 'function') showToast(error.message, 'error');
    } finally {
      loading = false;
    }
  }

  async function runScan() {
    const button = node('#newsroom-scan-button');
    if (button) { button.disabled = true; button.textContent = 'Scanning…'; }
    try {
      const response = await api('/api/newsroom/scan', { method: 'POST', body: JSON.stringify({ autoPromote: true }) });
      const result = response.result || {};
      if (typeof showToast === 'function') showToast(result.skipped ? `Radar skipped: ${result.reason}` : `Radar complete: ${result.articleCount || 0} articles, ${result.actionableCount || 0} actionable`);
      await loadNewsroom(true);
      if (typeof refreshDashboard === 'function') refreshDashboard(true);
    } catch (error) {
      if (typeof showToast === 'function') showToast(error.message, 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Scan world now'; }
    }
  }

  async function promote(decisionId, button) {
    if (button) button.disabled = true;
    try {
      await api(`/api/newsroom/decisions/${encodeURIComponent(decisionId)}/promote`, { method: 'POST', body: '{}' });
      if (typeof showToast === 'function') showToast('Story sent to the editorial backlog.');
      await loadNewsroom(true);
      if (typeof refreshDashboard === 'function') refreshDashboard(true);
    } catch (error) {
      if (typeof showToast === 'function') showToast(error.message, 'error');
      if (button) button.disabled = false;
    }
  }

  document.addEventListener('click', event => {
    const scan = event.target.closest?.('#newsroom-scan-button');
    if (scan) return runScan();
    const promoteButton = event.target.closest?.('[data-newsroom-promote]');
    if (promoteButton) return promote(promoteButton.dataset.newsroomPromote, promoteButton);
  });

  window.loadNewsroom = loadNewsroom;
  document.addEventListener('DOMContentLoaded', () => {
    if (location.hash === '#newsroom') loadNewsroom(true);
    timer = setInterval(() => {
      if (window.ui?.currentView === 'newsroom' || location.hash === '#newsroom') loadNewsroom(true);
    }, 30000);
  });
  window.addEventListener('beforeunload', () => { if (timer) clearInterval(timer); });
})();
