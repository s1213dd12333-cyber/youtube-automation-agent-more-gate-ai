(() => {
  'use strict';
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  async function api(path) { const response = await fetch(path, { credentials: 'same-origin' }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }
  function money(value) { return `$${Number(value || 0).toFixed(2)}`; }
  function render(result) {
    const node = document.getElementById('newsroom-production-director'); if (!node) return;
    const rows = result?.result || [];
    if (!rows.length) { node.innerHTML = '<div class="empty">No autonomous production directives yet.</div>'; return; }
    node.innerHTML = rows.slice(0, 12).map(item => `
      <div class="activity-item">
        <div><strong>${esc(item.mode)}</strong> · ${esc(item.format)} · ${esc(item.providerTier)}</div>
        <div class="muted">${esc(item.visualStrategy)} · ${Number(item.sceneCount || 0)} scenes · ${money(item.maxBudgetUsd)} max · ${Number(item.factLocks?.length || 0)} fact locks</div>
      </div>`).join('');
  }
  async function refresh() { try { render(await api('/api/newsroom/production-director/directives?limit=20')); } catch (_error) {} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh); else refresh();
  document.addEventListener('newsroom:updated', refresh);
})();
