(() => {
  'use strict';

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const api = async (url, options = {}) => {
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload.result ?? payload;
  };
  const when = value => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleString();
  };
  const actionClass = action => ['BREAKING','UPDATE','COVER','FOLLOW_UP'].includes(action) ? 'success' : action === 'DEFER' || action === 'WAIT' ? 'warning' : 'muted';

  async function loadEditorialBrain() {
    const root = document.getElementById('newsroom-editorial-brain');
    if (!root) return;
    try {
      const [status, decisions] = await Promise.all([
        api('/api/newsroom/editor/status'),
        api('/api/newsroom/editor/decisions?limit=20')
      ]);
      const policy = status?.policy?.policy || {};
      const lastRun = status?.lastRun || null;
      const recent = Array.isArray(decisions) ? decisions : status?.recentDecisions || [];
      root.innerHTML = `
        <div class="stat-row"><span>Mission</span><strong>${esc(policy.mission || 'Autonomous international newsroom')}</strong></div>
        <div class="stat-row"><span>Publishing target</span><strong>1 editorial selection / ${esc(policy.targetCadenceMinutes || 120)} min</strong></div>
        <div class="stat-row"><span>Last assignment</span><strong>${when(status?.lastAssignmentAt)}</strong></div>
        <div class="stat-row"><span>Current cooldown</span><strong>${lastRun?.cooldownActive ? `active until ${when(lastRun.nextEligibleAt)}` : 'ready'}</strong></div>
        <div class="stat-row"><span>Policy revision</span><strong>${esc(status?.policy?.revisionNumber ?? 0)}</strong></div>
        <div class="editorial-brain-list">
          ${recent.slice(0, 8).map(item => `
            <article class="idea-card">
              <div class="idea-card__top"><span class="badge ${actionClass(item.action)}">${esc(item.action)}</span><strong>${esc(item.priorityScore)}/100</strong></div>
              <p>${esc(item.rationale)}</p>
              <small>${item.selected ? 'SELECTED · ' : ''}${esc(item.urgency || '')} · ${esc(item.format || '')}${item.nextEligibleAt ? ` · next ${when(item.nextEligibleAt)}` : ''}</small>
            </article>`).join('') || '<div class="empty">No editorial-brain decisions yet. Run a world scan.</div>'}
        </div>`;
    } catch (error) {
      root.innerHTML = `<div class="empty">Editorial brain unavailable: ${esc(error.message)}</div>`;
    }
  }

  const previous = window.loadNewsroom;
  window.loadNewsroom = async function loadNewsroomWithEditorialBrain(force) {
    if (typeof previous === 'function') await previous(force);
    await loadEditorialBrain();
  };
  window.loadEditorialBrain = loadEditorialBrain;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => loadEditorialBrain().catch(() => {}), { once: true });
  } else {
    loadEditorialBrain().catch(() => {});
  }
})();
