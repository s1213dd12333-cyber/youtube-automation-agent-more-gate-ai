(() => {
  'use strict';

  const api = async (url, options = {}) => {
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload.result ?? payload;
  };

  const escapeHtml = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const formatPlan = plan => {
    const research = plan.research || {};
    const visuals = plan.visuals || {};
    const visualFlags = [visuals.needsMap && 'map', visuals.needsTimeline && 'timeline', visuals.needsDataChart && 'data chart', visuals.needsDocumentEvidence && 'document evidence'].filter(Boolean);
    return `<div class="activity-item">
      <div><strong>${escapeHtml(plan.topic || 'Untitled plan')}</strong></div>
      <div class="muted">${escapeHtml(plan.action)} · ${escapeHtml(plan.format)} · ${escapeHtml(plan.urgency)} · ${escapeHtml(plan.targetLengthMinutes)} min</div>
      <div class="muted">Research: ${escapeHtml(research.minimumIndependentSources || 0)} independent source(s)${research.primarySourceRequired ? ' · primary/official evidence required when available' : ''}</div>
      <div class="muted">Visuals: ${escapeHtml(visualFlags.length ? visualFlags.join(', ') : 'standard evidence-led visuals')}</div>
      <div class="muted">${escapeHtml(plan.rationale || '')}</div>
    </div>`;
  };

  async function refresh() {
    const root = document.getElementById('newsroom-editorial-planning');
    if (!root) return;
    try {
      const status = await api('/api/newsroom/planning/status');
      const plans = status.recentPlans || [];
      const revision = status.policy?.revisionNumber ?? 0;
      root.innerHTML = `<div class="activity-item"><strong>Planner ${escapeHtml(status.version || '12.5')}</strong><div class="muted">${status.enabled ? 'enabled' : 'disabled'} · policy revision ${escapeHtml(revision)}</div></div>${plans.length ? plans.slice(0, 12).map(formatPlan).join('') : '<div class="empty">No editorial plan has been generated yet.</div>'}`;
    } catch (error) {
      root.innerHTML = `<div class="empty">Editorial Planning AI unavailable: ${escapeHtml(error.message)}</div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    refresh();
    window.setInterval(refresh, 30000);
  });
})();
