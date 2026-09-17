(() => {
  'use strict';

  const root = document.getElementById('newsroom-quality-council');
  if (!root) return;

  const esc = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  async function api(path) {
    const response = await fetch(path, { headers: { Accept: 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.error || `HTTP ${response.status}`);
    return data.result;
  }

  function badge(status) {
    const value = esc(status || 'unknown');
    return `<span class="status-pill ${value.toLowerCase()}">${value}</span>`;
  }

  function render(status) {
    const latest = status?.latest;
    root.innerHTML = `
      <div class="metric-row">
        <div><strong>${Number(status?.pass || 0)}</strong><span>PASS</span></div>
        <div><strong>${Number(status?.repair || 0)}</strong><span>REPAIR</span></div>
        <div><strong>${Number(status?.block || 0)}</strong><span>BLOCK</span></div>
      </div>
      ${latest ? `
        <div class="activity-item">
          <div><strong>Latest ${esc(latest.phase)}</strong> ${badge(latest.status)}</div>
          <div>Score ${Number(latest.score || 0)}/100 · ${Number(latest.blockingCount || 0)} blocking · ${Number(latest.repairCount || 0)} repair</div>
          <small>${esc(latest.productionId || latest.directiveId || latest.subjectId || latest.id)}</small>
        </div>` : '<div class="empty">No council reviews yet.</div>'}
    `;
  }

  async function refresh() {
    try { render(await api('/api/newsroom/quality-council/status')); }
    catch (error) { root.innerHTML = `<div class="empty">Quality Council unavailable: ${esc(error.message)}</div>`; }
  }

  refresh();
  setInterval(refresh, 30000);
})();
