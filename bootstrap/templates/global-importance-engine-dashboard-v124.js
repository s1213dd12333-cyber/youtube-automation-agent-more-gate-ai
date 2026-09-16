(() => {
  'use strict';

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const api = async url => {
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload.result ?? payload;
  };
  const tierClass = tier => ['systemic','global'].includes(tier) ? 'success' : ['international','regional'].includes(tier) ? 'warning' : 'muted';

  async function loadGlobalImportance() {
    const root = document.getElementById('newsroom-global-importance');
    if (!root) return;
    try {
      const status = await api('/api/newsroom/importance/status');
      const assessments = Array.isArray(status?.recentAssessments) ? status.recentAssessments : [];
      root.innerHTML = `
        <div class="stat-row"><span>Engine</span><strong>12.4 · ${status?.enabled === false ? 'disabled' : 'active'}</strong></div>
        <div class="stat-row"><span>Policy revision</span><strong>${esc(status?.policy?.revisionNumber ?? 0)}</strong></div>
        <div class="stat-row"><span>Purpose</span><strong>Structural global impact, separate from popularity</strong></div>
        <div class="editorial-brain-list">
          ${assessments.slice(0, 8).map(item => `
            <article class="idea-card">
              <div class="idea-card__top"><span class="badge ${tierClass(item.impactTier)}">${esc(item.impactTier)}</span><strong>${esc(item.importanceScore)}/100</strong></div>
              <p>${esc(item.rationale)}</p>
              <small>evidence confidence ${esc(item.confidenceScore)}/100 · event ${esc(item.eventId || 'unresolved')}</small>
            </article>`).join('') || '<div class="empty">No structural-importance assessments yet. Run a world scan.</div>'}
        </div>`;
    } catch (error) {
      root.innerHTML = `<div class="empty">Global Importance Engine unavailable: ${esc(error.message)}</div>`;
    }
  }

  const previous = window.loadNewsroom;
  window.loadNewsroom = async function loadNewsroomWithGlobalImportance(force) {
    if (typeof previous === 'function') await previous(force);
    await loadGlobalImportance();
  };
  window.loadGlobalImportance = loadGlobalImportance;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => loadGlobalImportance().catch(() => {}), { once: true });
  } else {
    loadGlobalImportance().catch(() => {});
  }
})();
