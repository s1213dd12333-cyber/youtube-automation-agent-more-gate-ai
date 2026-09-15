'use strict';
(() => {
  const state = { data: null, selectedId: null, loading: false };
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const label = value => String(value || 'unknown').replace(/_/g, ' ');
  const empty = text => `<div class="empty">${esc(text)}</div>`;
  async function request(url, options = {}) {
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }
  function setText(id, value) { const node = document.getElementById(id); if (node) node.textContent = String(value ?? '—'); }

  async function loadLibrary(silent = false) {
    if (state.loading) return;
    state.loading = true;
    try {
      const response = await request('/api/location-library');
      state.data = response.result || { locations: [], selections: [], summary: {} };
      render();
      if (!state.selectedId && state.data.locations?.[0]?.id) await openDetail(state.data.locations[0].id, true);
    } catch (error) {
      const list = $('#location-library-list');
      if (list) list.innerHTML = empty(error.message);
      if (!silent && typeof showToast === 'function') showToast(error.message, 'error');
    } finally {
      state.loading = false;
    }
  }

  function filteredLocations() {
    const data = state.data || { locations: [] };
    const search = String($('#location-library-search')?.value || '').toLowerCase().trim();
    const status = $('#location-library-status')?.value || 'all';
    const type = $('#location-library-type')?.value || 'all';
    return (data.locations || []).filter(item => {
      if (status !== 'all' && item.status !== status) return false;
      if (type !== 'all' && item.locationType !== type) return false;
      if (!search) return true;
      const haystack = [item.id, item.locationKey, item.displayName, item.locationType,
        ...(item.aliases || []).flatMap(alias => [alias.aliasText, alias.aliasKey]),
        ...(item.zones || []).flatMap(zone => [zone.id, zone.zoneKey, zone.displayName])
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(search);
    });
  }

  function render() {
    const data = state.data || { locations: [], selections: [], summary: {} };
    const summary = data.summary || {};
    setText('location-stat-total', summary.locationCount || 0);
    setText('location-stat-ready', summary.canonicalReady || 0);
    setText('location-stat-zones', summary.zoneCount || 0);
    setText('location-stat-cross-video', summary.crossVideoLocations || 0);

    const typeSelect = $('#location-library-type');
    if (typeSelect) {
      const current = typeSelect.value || 'all';
      const types = [...new Set((data.locations || []).map(item => item.locationType).filter(Boolean))].sort();
      typeSelect.innerHTML = '<option value="all">All types</option>' + types.map(type => `<option value="${esc(type)}">${esc(label(type))}</option>`).join('');
      typeSelect.value = types.includes(current) ? current : 'all';
    }

    const list = $('#location-library-list');
    const locations = filteredLocations();
    if (list) list.innerHTML = locations.length ? locations.map(item => {
      const master = (item.assets || []).find(asset => asset.scope === 'location' && asset.canonical && asset.status === 'ready') || (item.assets || []).find(asset => asset.canonical && asset.status === 'ready');
      const active = state.selectedId === item.id ? ' active' : '';
      return `<button class="location-card${active}" data-location-open="${esc(item.id)}"><span class="location-thumb">${master?.assetUrl ? `<img src="${esc(master.assetUrl)}" alt="">` : '<span>LOC</span>'}</span><span class="location-card-copy"><strong>${esc(item.displayName || item.locationKey || item.id)}</strong><small>${esc(label(item.locationType))} · ${esc(label(item.status))}</small><small>${(item.zones || []).length} zone(s) · ${(item.aliases || []).length} alias(es) · ${item.usageCount || 0} use(s)</small></span><span class="location-card-id">${esc(String(item.id || '').slice(-8))}</span></button>`;
    }).join('') : empty('No reusable locations match these filters.');

    const decisions = $('#location-selection-list');
    const selections = data.selections || [];
    if (decisions) decisions.innerHTML = selections.length ? selections.slice(0, 24).map(item => {
      const pct = Math.round(Number(item.score || 0) * 100);
      const margin = Math.round(Number(item.margin || 0) * 100);
      return `<div class="quality-check ${item.status === 'resolved' ? 'pass' : item.status === 'ambiguous' ? 'warn' : ''}"><strong>${esc(item.referenceText || item.environmentId || 'environment')}</strong><br><small>${esc(item.status)}${item.selectedLocationId ? ` → ${esc(item.selectedLocationId)}` : ''}<br>score ${pct}% · margin ${margin}% · ${esc(item.reason || '')}</small></div>`;
    }).join('') : empty('No auto-selection decisions have been recorded yet.');
  }

  async function openDetail(locationId, silent = false) {
    try {
      const response = await request(`/api/location-library/${encodeURIComponent(locationId)}`);
      const item = response.result;
      state.selectedId = locationId;
      render();
      const assets = item.assets || [], aliases = item.aliases || [], zones = item.zones || [], usages = item.usages || [];
      const master = assets.find(asset => asset.scope === 'location' && asset.canonical && asset.status === 'ready') || assets.find(asset => asset.canonical && asset.status === 'ready');
      const detail = $('#location-library-detail');
      if (detail) detail.innerHTML = `<div class="location-detail-head">${master?.assetUrl ? `<img src="${esc(master.assetUrl)}" alt="">` : ''}<div><p class="eyebrow">${esc(label(item.locationType))}</p><h2>${esc(item.displayName || item.locationKey)}</h2><code>${esc(item.id)}</code><p>${esc(label(item.status))} · ${usages.length} use(s) across ${item.crossVideoUsageCount || 0} production(s)</p></div></div><div class="location-detail-block"><strong>Aliases</strong><div class="location-tags">${aliases.length ? aliases.map(alias => `<span>${esc(alias.aliasText || alias.aliasKey)}</span>`).join('') : '<span>none</span>'}</div></div><div class="location-detail-block"><strong>Persistent zones</strong>${zones.length ? zones.map(zone => `<div class="location-detail-row"><span>${esc(zone.displayName || zone.zoneKey)}</span><code>${esc(zone.id)}</code></div>`).join('') : '<p class="meta-line">No persistent zones yet.</p>'}</div><div class="location-detail-block"><strong>Canonical assets</strong>${assets.length ? assets.map(asset => `<div class="location-asset-row">${asset.assetUrl ? `<img src="${esc(asset.assetUrl)}" alt="">` : '<span class="location-asset-placeholder">—</span>'}<div><b>${esc(asset.assetRole || 'asset')}</b><small>${esc(asset.scope)}${asset.zoneId ? ` · ${esc(asset.zoneId)}` : ''} · ${esc(asset.status || '')}</small><small>sha256 ${(asset.assetSha256 || '').slice(0, 16) || 'n/a'}</small></div></div>`).join('') : '<p class="meta-line">No canonical assets yet.</p>'}</div><div class="location-detail-block"><strong>Usage history</strong>${usages.length ? usages.slice().reverse().slice(0, 20).map(usage => `<div class="location-detail-row"><span>${esc(usage.productionId)} · ${esc(usage.matchMode || '')}</span><small>${esc(usage.environmentId || '')}</small></div>`).join('') : '<p class="meta-line">No recorded usage.</p>'}</div>`;
    } catch (error) {
      if (!silent && typeof showToast === 'function') showToast(error.message, 'error');
    }
  }

  document.addEventListener('input', event => { if (event.target.matches('#location-library-search')) render(); });
  document.addEventListener('change', event => { if (event.target.matches('#location-library-status, #location-library-type')) render(); });
  document.addEventListener('click', event => {
    const open = event.target.closest('[data-location-open]');
    if (open) void openDetail(open.dataset.locationOpen);
    if (event.target.closest('#location-library-refresh')) void loadLibrary();
    if (event.target.closest('[data-view="locations"]')) setTimeout(() => void loadLibrary(true), 0);
  });
  window.addEventListener('hashchange', () => { if (location.hash === '#locations') void loadLibrary(true); });
  if (location.hash === '#locations') void loadLibrary(true);
})();
