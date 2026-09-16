(() => {
  'use strict';
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  async function api(path) {
    const response = await fetch(path, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  function render(packet) {
    if (!packet) return '<div class="empty">No Evidence / Truth packet yet.</div>';
    const claims = Array.isArray(packet.claims) ? packet.claims : [];
    const counts = packet.classificationCounts || {};
    const rows = claims.slice(0, 8).map(claim => `<div class="activity-item"><div><strong>${esc(claim.classification)}</strong> · ${esc(claim.claimText)}</div><small>${Number(claim.confidenceScore || 0)}/100 · ${esc(claim.reason || '')} · ${esc((claim.supportDomains || []).join(', '))}</small></div>`).join('');
    return `<div class="activity-item"><div><strong>${esc(packet.status)}</strong> · ${Number(counts.confirmed || 0)}/${Number(packet.claimCount || 0)} confirmed</div><small>confidence ${Number(packet.confidenceScore || 0)}/100 · reported ${Number(counts.reported || 0)} · claimed ${Number(counts.claimed || 0)} · disputed ${Number(counts.disputed || 0)} · unverified ${Number(counts.unverified || 0)} · false ${Number(counts.false || 0)} · unknown ${Number(counts.unknown || 0)}</small></div>${rows}`;
  }
  async function refresh() {
    const target = document.getElementById('newsroom-claim-verification');
    if (!target) return;
    try {
      const payload = await api('/api/newsroom/claims/status');
      const recent = payload?.result?.recentPackets || [];
      target.innerHTML = render(recent[0] || null);
    } catch (error) {
      target.innerHTML = `<div class="empty">Evidence / Truth unavailable: ${esc(error.message)}</div>`;
    }
  }
  window.addEventListener('DOMContentLoaded', refresh);
  window.addEventListener('newsroom:scan-complete', refresh);
})();
