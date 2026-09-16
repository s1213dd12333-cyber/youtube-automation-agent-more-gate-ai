(() => {
  'use strict';
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  async function api(path) {
    const response = await fetch(path, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  function render(packet) {
    if (!packet) return '<div class="empty">No claim verification packet yet.</div>';
    const claims = Array.isArray(packet.claims) ? packet.claims : [];
    const rows = claims.slice(0, 8).map(claim => `<div class="activity-item"><div><strong>${esc(claim.status)}</strong> · ${esc(claim.claimText)}</div><small>${Number(claim.confidenceScore || 0)}/100 · ${esc((claim.supportDomains || []).join(', '))}</small></div>`).join('');
    return `<div class="activity-item"><div><strong>${esc(packet.status)}</strong> · ${Number(packet.supportedCount || 0)}/${Number(packet.claimCount || 0)} claims supported</div><small>confidence ${Number(packet.confidenceScore || 0)}/100 · contested ${Number(packet.contestedCount || 0)} · insufficient ${Number(packet.insufficientCount || 0)}</small></div>${rows}`;
  }
  async function refresh() {
    const target = document.getElementById('newsroom-claim-verification');
    if (!target) return;
    try {
      const payload = await api('/api/newsroom/claims/status');
      const recent = payload?.result?.recentPackets || [];
      target.innerHTML = render(recent[0] || null);
    } catch (error) {
      target.innerHTML = `<div class="empty">Claim verification unavailable: ${esc(error.message)}</div>`;
    }
  }
  window.addEventListener('DOMContentLoaded', refresh);
  window.addEventListener('newsroom:scan-complete', refresh);
})();
