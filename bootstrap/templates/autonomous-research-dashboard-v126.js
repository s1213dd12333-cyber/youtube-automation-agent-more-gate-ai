'use strict';

(() => {
  const root = document.getElementById('newsroom-autonomous-research');
  if (!root) return;

  async function api(path) {
    const response = await fetch(path, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const payload = await response.json();
    return payload.result;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  }

  function renderRun(run) {
    const status = escapeHtml(run.status || 'unknown');
    const domains = Number(run.independentSourceCount || 0);
    const primary = Number(run.primarySourceCount || 0);
    const score = Number(run.evidenceScore || 0);
    const coverage = Math.round(Number(run.coverageRatio || 0) * 100);
    const gaps = (run.gaps || []).slice(0, 4).map(gap => `<span class="tag">${escapeHtml(gap)}</span>`).join(' ');
    return `<div class="activity-item"><div><strong>${status}</strong><div class="muted">Evidence ${score}/100 · coverage ${coverage}% · ${domains} independent domain(s) · ${primary} primary/official</div>${gaps ? `<div class="tag-row">${gaps}</div>` : ''}</div><div class="muted">${escapeHtml(run.planId || '')}</div></div>`;
  }

  async function refresh() {
    try {
      const status = await api('/api/newsroom/research/status');
      const runs = status?.recentRuns || [];
      root.innerHTML = runs.length ? runs.slice(0, 12).map(renderRun).join('') : '<div class="empty">No autonomous research runs yet. A selected newsroom story will trigger evidence acquisition automatically.</div>';
    } catch (error) {
      root.innerHTML = `<div class="empty">Autonomous Research unavailable: ${escapeHtml(error.message)}</div>`;
    }
  }

  refresh();
  window.addEventListener('newsroom:scan-complete', refresh);
  setInterval(refresh, 60000);
})();
