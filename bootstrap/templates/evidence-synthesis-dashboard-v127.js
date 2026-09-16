(() => {
  'use strict';

  async function api(path) {
    const response = await fetch(path, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function render(status) {
    const root = document.getElementById('newsroom-evidence-synthesis');
    if (!root) return;
    const latest = status?.latest;
    if (!latest) {
      root.innerHTML = '<div class="empty">No evidence synthesis brief has been created yet.</div>';
      return;
    }
    const state = latest.status === 'SYNTHESIS_READY' ? 'ready' : 'blocked';
    root.innerHTML = `
      <div class="activity-item">
        <div><strong>${esc(latest.status)}</strong> · confidence ${esc(latest.confidenceScore)}/100</div>
        <div class="muted">${esc(latest.summary)}</div>
        <div class="muted">${esc(latest.claimCount)} claims · ${esc(latest.corroboratedClaimCount)} corroborated · ${esc((latest.citations || []).length)} citations</div>
        <div class="muted">State: ${esc(state)} · brief ${esc(latest.id)}</div>
      </div>`;
  }

  async function refresh() {
    try {
      const payload = await api('/api/newsroom/synthesis/status');
      render(payload?.result || {});
    } catch (error) {
      const root = document.getElementById('newsroom-evidence-synthesis');
      if (root) root.innerHTML = `<div class="empty">Evidence synthesis unavailable: ${esc(error.message)}</div>`;
    }
  }

  window.addEventListener('DOMContentLoaded', refresh);
  window.addEventListener('newsroom:scan-complete', refresh);
})();
