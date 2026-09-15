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
  function notify(message, tone = 'success') { if (typeof showToast === 'function') showToast(message, tone); }

  async function loadLibrary(silent = false) {
    if (state.loading) return;
    state.loading = true;
    try {
      const response = await request('/api/object-library');
      state.data = response.result || { objects: [], pendingResolutions: [], actions: [], summary: {} };
      render();
      if (!state.selectedId && state.data.objects?.[0]?.id) await openDetail(state.data.objects[0].id, true);
    } catch (error) {
      const list = $('#object-library-list');
      if (list) list.innerHTML = empty(error.message);
      if (!silent) notify(error.message, 'error');
    } finally {
      state.loading = false;
    }
  }

  function filteredObjects() {
    const data = state.data || { objects: [] };
    const search = String($('#object-library-search')?.value || '').toLowerCase().trim();
    const type = $('#object-library-type')?.value || 'all';
    const status = $('#object-library-status')?.value || 'all';
    return (data.objects || []).filter(item => {
      if (type !== 'all' && item.objectType !== type) return false;
      if (status === 'canonical_ready' && !item.canonicalReady) return false;
      if (status === 'cross_video' && !item.crossVideo) return false;
      if (status === 'blocked' && item.latestContinuity?.accepted !== false) return false;
      if (!search) return true;
      const haystack = [item.id, item.objectKey, item.displayName, item.objectType,
        ...(item.aliases || []).flatMap(alias => [alias.aliasText, alias.aliasKey])
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(search);
    });
  }

  function render() {
    const data = state.data || { objects: [], pendingResolutions: [], actions: [], summary: {} };
    const summary = data.summary || {};
    setText('object-stat-total', summary.objectCount || 0);
    setText('object-stat-ready', summary.canonicalReady || 0);
    setText('object-stat-cross-video', summary.crossVideoObjects || 0);
    setText('object-stat-blocked', summary.blockedContinuity || 0);

    const typeSelect = $('#object-library-type');
    if (typeSelect) {
      const current = typeSelect.value || 'all';
      const types = [...new Set((data.objects || []).map(item => item.objectType).filter(Boolean))].sort();
      typeSelect.innerHTML = '<option value="all">All types</option>' + types.map(type => `<option value="${esc(type)}">${esc(label(type))}</option>`).join('');
      typeSelect.value = types.includes(current) ? current : 'all';
    }

    const list = $('#object-library-list');
    const objects = filteredObjects();
    if (list) list.innerHTML = objects.length ? objects.map(item => {
      const asset = (item.assets || []).find(row => row.canonical && row.status === 'ready');
      const active = state.selectedId === item.id ? ' active' : '';
      const gate = item.latestContinuity ? (item.latestContinuity.accepted ? 'continuity ok' : 'continuity blocked') : 'no gate yet';
      return `<button class="object-card${active}" data-object-open="${esc(item.id)}"><span class="object-thumb">${asset?.assetUrl ? `<img src="${esc(asset.assetUrl)}" alt="">` : '<span>OBJ</span>'}</span><span class="object-card-copy"><strong>${esc(item.displayName || item.objectKey || item.id)}</strong><small>${esc(label(item.objectType))} · ${item.canonicalReady ? 'canonical ready' : esc(label(item.status))}</small><small>${(item.aliases || []).length} alias(es) · ${item.productionCount || 0} production(s) · ${esc(gate)}</small></span><span class="object-card-id">${esc(String(item.id || '').slice(-8))}</span></button>`;
    }).join('') : empty('No persistent objects match these filters.');

    const pending = $('#object-resolution-list');
    const rows = data.pendingResolutions || [];
    if (pending) pending.innerHTML = rows.length ? rows.slice(0, 30).map(row => `<div class="quality-check warn"><strong>${esc(row.referenceText || row.referenceKey || 'reference')}</strong><br><small>${esc(row.status)} · ${esc(row.productionId || '')}<br>${esc(row.reason || '')}</small></div>`).join('') : empty('No unresolved or ambiguous object references.');

    const actions = $('#object-operator-action-list');
    const actionRows = data.actions || [];
    if (actions) actions.innerHTML = actionRows.length ? actionRows.slice(0, 30).map(row => `<div class="quality-check ${row.status === 'applied' ? 'pass' : row.status === 'rejected' ? 'fail' : ''}"><strong>${esc(label(row.actionType))}</strong><br><small>${esc(row.status)} · ${esc(row.objectId || row.targetId || '')}<br>${esc(row.reason || row.note || '')}</small></div>`).join('') : empty('No operator actions recorded yet.');
  }

  function resolutionRows(item) {
    const pending = item.pendingResolutions || [];
    if (!pending.length) return '<p class="meta-line">No unresolved/ambiguous references to link.</p>';
    return pending.slice(0, 20).map(row => `<div class="object-resolution-row"><div><strong>${esc(row.referenceText || row.referenceKey || 'reference')}</strong><small>${esc(row.status)} · ${esc(row.productionId || '')} · ${esc(row.reason || '')}</small></div><label class="object-link-alias"><input type="checkbox" data-object-persist-alias="${esc(row.id)}"> save alias</label><button class="button secondary" data-object-link-resolution="${esc(row.id)}">Link to this object</button></div>`).join('');
  }

  async function openDetail(objectId, silent = false) {
    try {
      const response = await request(`/api/object-library/${encodeURIComponent(objectId)}`);
      const item = response.result;
      state.selectedId = objectId;
      render();
      const object = item.object || item;
      const assets = item.assets || [], aliases = item.aliases || [], states = item.states || [], usages = item.usages || [], bindings = item.bindings || [], checks = item.continuityChecks || [], actions = item.operatorActions || [];
      const asset = assets.find(row => row.canonical && row.status === 'ready');
      const latestState = [...states].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
      const latestCheck = [...checks].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
      const detail = $('#object-library-detail');
      if (detail) detail.innerHTML = `<div class="object-detail-head">${asset?.assetUrl ? `<img src="${esc(asset.assetUrl)}" alt="">` : ''}<div><p class="eyebrow">${esc(label(object.objectType))}</p><h2>${esc(object.displayName || object.objectKey)}</h2><code>${esc(object.id)}</code><p>${item.productionCount || 0} production(s) · ${bindings.length} shot binding(s) · ${latestCheck ? (latestCheck.accepted ? 'latest continuity accepted' : 'latest continuity blocked') : 'no continuity check yet'}</p></div></div>
      <div class="object-detail-block"><strong>Canonical identity (read-only)</strong><pre>${esc(JSON.stringify(object.canonicalIdentity || {}, null, 2))}</pre><small>fingerprint ${esc(object.identityFingerprint || '')}</small></div>
      <div class="object-detail-block"><strong>Aliases</strong><div class="object-tags">${aliases.length ? aliases.map(alias => `<span>${esc(alias.aliasText || alias.aliasKey)}</span>`).join('') : '<span>none</span>'}</div><div class="object-operator-form"><input id="object-alias-input" maxlength="240" placeholder="Add safe alias"><button class="button secondary" data-object-add-alias>Add alias</button></div><small>Alias creation is rejected if that alias already points to another object.</small></div>
      <div class="object-detail-block"><strong>Canonical asset</strong>${asset ? `<div class="object-asset-row"><img src="${esc(asset.assetUrl)}" alt=""><div><b>${esc(asset.assetRole || 'object_reference')}</b><small>${esc(asset.provider || 'unknown provider')} · ${esc(asset.model || '')}</small><small>sha256 ${esc((asset.assetSha256 || '').slice(0, 24))}</small><small>origin ${esc(asset.sourceProductionId || '')}</small></div></div>` : '<p class="meta-line">No ready canonical asset.</p>'}</div>
      <div class="object-detail-block"><strong>Latest lifecycle state</strong>${latestState ? `<div class="object-detail-row"><span>${esc(latestState.status)} · ${esc(latestState.persistence)}</span><code>${esc((latestState.stateFingerprint || '').slice(0, 16))}</code></div>` : '<p class="meta-line">No state rows.</p>'}</div>
      <div class="object-detail-block"><strong>Usage history</strong>${usages.length ? usages.slice().reverse().slice(0, 20).map(row => `<div class="object-detail-row"><span>${esc(row.productionId)} · ${esc(row.matchMode || '')}</span><small>${esc(row.locationId || '')}${row.zoneId ? ` / ${esc(row.zoneId)}` : ''}</small></div>`).join('') : '<p class="meta-line">No usage rows.</p>'}</div>
      <div class="object-detail-block"><strong>Cross-video continuity</strong>${checks.length ? checks.slice(0, 20).map(row => `<div class="object-detail-row"><span>${row.accepted ? 'accepted' : 'blocked'} · ${esc(row.visibility || '')}</span><small>${esc((row.reasons || []).join(', ') || row.status || '')} · ${Math.round(Number(row.visionConfidence || 0) * 100)}%</small></div>`).join('') : '<p class="meta-line">No checks for this object.</p>'}</div>
      <div class="object-detail-block"><strong>Explicitly link pending resolver decisions</strong><p class="meta-line">This action links an existing unresolved/ambiguous resolver audit to this object. It never rewrites canonical identity.</p>${resolutionRows(item)}</div>
      <div class="object-detail-block"><strong>Operator audit</strong>${actions.length ? actions.slice(0, 20).map(row => `<div class="object-detail-row"><span>${esc(label(row.actionType))} · ${esc(row.status)}</span><small>${esc(row.reason || row.note || '')}</small></div>`).join('') : '<p class="meta-line">No operator actions for this object.</p>'}</div>`;
    } catch (error) {
      if (!silent) notify(error.message, 'error');
    }
  }

  async function addAlias() {
    if (!state.selectedId) return;
    const input = $('#object-alias-input');
    const aliasText = String(input?.value || '').trim();
    if (!aliasText) return notify('Enter an alias first.', 'error');
    try {
      const response = await request(`/api/object-library/${encodeURIComponent(state.selectedId)}/aliases`, { method: 'POST', body: JSON.stringify({ aliasText, actor: 'dashboard_operator' }) });
      if (response.result?.status === 'conflict') return notify(response.result.reason || 'Alias conflict.', 'error');
      if (input) input.value = '';
      await loadLibrary(true);
      await openDetail(state.selectedId, true);
      notify(response.result?.status === 'no_change' ? 'Alias already linked.' : 'Alias linked and audited.');
    } catch (error) { notify(error.message, 'error'); }
  }

  async function linkResolution(resolutionId) {
    if (!state.selectedId || !resolutionId) return;
    const persistAlias = Boolean(document.querySelector(`[data-object-persist-alias="${CSS.escape(resolutionId)}"]`)?.checked);
    try {
      const response = await request(`/api/object-library/resolutions/${encodeURIComponent(resolutionId)}/link`, { method: 'POST', body: JSON.stringify({ objectId: state.selectedId, persistAlias, actor: 'dashboard_operator' }) });
      if (response.result?.status === 'conflict') return notify(response.result.reason || 'Link conflict.', 'error');
      await loadLibrary(true);
      await openDetail(state.selectedId, true);
      notify(response.result?.status === 'no_change' ? 'Resolution was already linked.' : 'Resolution linked and audited.');
    } catch (error) { notify(error.message, 'error'); }
  }

  document.addEventListener('input', event => { if (event.target.matches('#object-library-search')) render(); });
  document.addEventListener('change', event => { if (event.target.matches('#object-library-status, #object-library-type')) render(); });
  document.addEventListener('click', event => {
    const open = event.target.closest('[data-object-open]');
    if (open) void openDetail(open.dataset.objectOpen);
    if (event.target.closest('#object-library-refresh')) void loadLibrary();
    if (event.target.closest('[data-object-add-alias]')) void addAlias();
    const link = event.target.closest('[data-object-link-resolution]');
    if (link) void linkResolution(link.dataset.objectLinkResolution);
    if (event.target.closest('[data-view="objects"]')) setTimeout(() => void loadLibrary(true), 0);
  });
  window.addEventListener('hashchange', () => { if (location.hash === '#objects') void loadLibrary(true); });
  if (location.hash === '#objects') void loadLibrary(true);
})();
