'use strict';
(() => {
  const state = { data:null, selectedId:null, loading:false };
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const label = value => String(value || 'unknown').replace(/_/g, ' ');
  const empty = text => `<div class="empty">${esc(text)}</div>`;
  async function request(url, options={}) { const response = await fetch(url, { headers:{'Content-Type':'application/json', ...(options.headers||{})}, ...options }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`); return body; }
  function setText(id, value) { const node=document.getElementById(id); if (node) node.textContent=String(value ?? '—'); }
  function notify(message, tone='success') { if (typeof showToast === 'function') showToast(message, tone); }

  async function loadLibrary(silent=false) {
    if (state.loading) return; state.loading=true;
    try { const response=await request('/api/character-library'); state.data=response.result || {characters:[],pendingResolutions:[],actions:[],summary:{}}; render(); if (!state.selectedId && state.data.characters?.[0]?.id) await openDetail(state.data.characters[0].id, true); }
    catch (error) { const list=$('#character-library-list'); if (list) list.innerHTML=empty(error.message); if (!silent) notify(error.message,'error'); }
    finally { state.loading=false; }
  }

  function filteredCharacters() {
    const data=state.data || {characters:[]}; const search=String($('#character-library-search')?.value || '').toLowerCase().trim();
    const species=$('#character-library-species')?.value || 'all'; const status=$('#character-library-status')?.value || 'all';
    return (data.characters || []).filter(item => {
      if (species !== 'all' && item.speciesType !== species) return false;
      if (status === 'canonical_ready' && !item.canonicalReady) return false;
      if (status === 'cross_video' && !item.crossVideo) return false;
      if (status === 'blocked' && item.latestContinuity?.accepted !== false) return false;
      if (!search) return true;
      return [item.id,item.characterKey,item.displayName,item.speciesType,...(item.aliases||[]).flatMap(a=>[a.aliasText,a.aliasKey])].filter(Boolean).join(' ').toLowerCase().includes(search);
    });
  }

  function render() {
    const data=state.data || {characters:[],pendingResolutions:[],actions:[],summary:{}}; const summary=data.summary || {};
    setText('character-stat-total',summary.characterCount||0); setText('character-stat-ready',summary.canonicalReady||0); setText('character-stat-cross-video',summary.crossVideoCharacters||0); setText('character-stat-blocked',summary.blockedContinuity||0);
    const speciesSelect=$('#character-library-species'); if (speciesSelect) { const current=speciesSelect.value||'all'; const values=[...new Set((data.characters||[]).map(x=>x.speciesType).filter(Boolean))].sort(); speciesSelect.innerHTML='<option value="all">All species/types</option>'+values.map(v=>`<option value="${esc(v)}">${esc(label(v))}</option>`).join(''); speciesSelect.value=values.includes(current)?current:'all'; }
    const list=$('#character-library-list'); const rows=filteredCharacters();
    if (list) list.innerHTML=rows.length ? rows.map(item => { const asset=(item.assets||[]).find(a=>a.canonical&&a.status==='ready'); const active=state.selectedId===item.id?' active':''; const gate=item.latestContinuity?(item.latestContinuity.accepted?'continuity ok':'continuity blocked'):'no gate yet'; return `<button class="character-card${active}" data-character-open="${esc(item.id)}"><span class="character-thumb">${asset?.assetUrl?`<img src="${esc(asset.assetUrl)}" alt="">`:'<span>CHAR</span>'}</span><span class="character-card-copy"><strong>${esc(item.displayName||item.characterKey||item.id)}</strong><small>${esc(label(item.speciesType))} · ${item.canonicalReady?'canonical ready':esc(label(item.status))}</small><small>${(item.aliases||[]).length} alias(es) · ${item.productionCount||0} production(s) · ${esc(gate)}</small></span></button>`; }).join('') : empty('No persistent characters match these filters.');
    const pending=$('#character-resolution-list'); const p=data.pendingResolutions||[]; if (pending) pending.innerHTML=p.length?p.slice(0,30).map(r=>`<div class="quality-check warn"><strong>${esc(r.referenceText||r.referenceKey||'reference')}</strong><br><small>${esc(r.status)} · ${esc(r.productionId||'')}<br>${esc(r.reason||'')}</small></div>`).join(''):empty('No unresolved or ambiguous character references.');
    const actions=$('#character-operator-action-list'); const a=data.actions||[]; if (actions) actions.innerHTML=a.length?a.slice(0,30).map(r=>`<div class="quality-check ${r.status==='applied'?'pass':r.status==='rejected'?'fail':''}"><strong>${esc(label(r.actionType))}</strong><br><small>${esc(r.status)} · ${esc(r.characterId||r.targetId||'')}<br>${esc(r.reason||r.note||'')}</small></div>`).join(''):empty('No character operator actions yet.');
  }

  function resolutionRows(item) { const rows=item.pendingResolutions||[]; if (!rows.length) return '<p class="meta-line">No unresolved/ambiguous references to link.</p>'; return rows.slice(0,20).map(r=>`<div class="character-resolution-row"><div><strong>${esc(r.referenceText||r.referenceKey||'reference')}</strong><small>${esc(r.status)} · ${esc(r.productionId||'')} · ${esc(r.reason||'')}</small></div><label><input type="checkbox" data-character-persist-alias="${esc(r.id)}"> save alias</label><button class="button secondary" data-character-link-resolution="${esc(r.id)}">Link to this character</button></div>`).join(''); }

  async function openDetail(characterId, silent=false) {
    try {
      const response=await request(`/api/character-library/${encodeURIComponent(characterId)}`); const item=response.result; state.selectedId=characterId; render();
      const c=item.character||item, assets=item.assets||[], aliases=item.aliases||[], states=item.states||[], usages=item.usages||[], bindings=item.bindings||[], checks=item.continuityChecks||[], actions=item.operatorActions||[];
      const asset=assets.find(a=>a.canonical&&a.status==='ready'); const latestState=[...states].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0];
      const detail=$('#character-library-detail'); if (detail) detail.innerHTML=`<div class="character-detail-head">${asset?.assetUrl?`<img src="${esc(asset.assetUrl)}" alt="">`:''}<div><p class="eyebrow">${esc(label(c.speciesType))}</p><h2>${esc(c.displayName||c.characterKey)}</h2><code>${esc(c.id)}</code><p>${item.productionCount||0} production(s) · ${bindings.length} shot binding(s)</p></div></div>
      <div class="character-detail-block"><strong>Canonical identity (read-only)</strong><pre>${esc(JSON.stringify(c.canonicalIdentity||{},null,2))}</pre><small>fingerprint ${esc(c.identityFingerprint||'')}</small></div>
      <div class="character-detail-block"><strong>Aliases</strong><div class="character-tags">${aliases.length?aliases.map(a=>`<span>${esc(a.aliasText||a.aliasKey)}</span>`).join(''):'<span>none</span>'}</div><div class="character-operator-form"><input id="character-alias-input" maxlength="240" placeholder="Add safe alias"><button class="button secondary" data-character-add-alias>Add alias</button></div><small>Rejected if the alias already points to another character.</small></div>
      <div class="character-detail-block"><strong>Canonical character reference</strong>${asset?`<div class="character-asset-row"><img src="${esc(asset.assetUrl)}" alt=""><div><b>${esc(asset.assetRole||'character_reference')}</b><small>${esc(asset.provider||'unknown provider')} · ${esc(asset.model||'')}</small><small>sha256 ${esc((asset.assetSha256||'').slice(0,24))}</small><small>origin ${esc(asset.sourceProductionId||'')}</small></div></div>`:'<p class="meta-line">No ready canonical asset.</p>'}</div>
      <div class="character-detail-block"><strong>Latest appearance state</strong>${latestState?`<div class="character-detail-row"><span>${esc(latestState.status)} · ${esc(latestState.persistence)}</span><small>${esc(latestState.wardrobe||latestState.condition||'neutral')}</small></div>`:'<p class="meta-line">No appearance state.</p>'}</div>
      <div class="character-detail-block"><strong>Usage history</strong>${usages.length?usages.slice(0,20).map(r=>`<div class="character-detail-row"><span>${esc(r.productionId)} · ${esc(r.matchMode||'')}</span><small>${esc(r.role||'')}</small></div>`).join(''):'<p class="meta-line">No usage rows.</p>'}</div>
      <div class="character-detail-block"><strong>Cross-video continuity</strong>${checks.length?checks.slice(0,20).map(r=>`<div class="character-detail-row"><span>${r.accepted?'accepted':'blocked'} · ${esc(r.visibility||'')}</span><small>${esc((r.reasons||[]).join(', ')||r.status||'')} · ${Math.round(Number(r.visionConfidence||0)*100)}%</small></div>`).join(''):'<p class="meta-line">No checks for this character.</p>'}</div>
      <div class="character-detail-block"><strong>Explicitly link pending resolver decisions</strong><p class="meta-line">Links only to this existing character; canonical identity/reference are never rewritten.</p>${resolutionRows(item)}</div>
      <div class="character-detail-block"><strong>Operator audit</strong>${actions.length?actions.slice(0,20).map(r=>`<div class="character-detail-row"><span>${esc(label(r.actionType))} · ${esc(r.status)}</span><small>${esc(r.reason||r.note||'')}</small></div>`).join(''):'<p class="meta-line">No operator actions.</p>'}</div>`;
    } catch (error) { if (!silent) notify(error.message,'error'); }
  }

  async function addAlias() { if (!state.selectedId) return; const input=$('#character-alias-input'); const aliasText=String(input?.value||'').trim(); if (!aliasText) return notify('Enter an alias first.','error'); try { const response=await request(`/api/character-library/${encodeURIComponent(state.selectedId)}/aliases`,{method:'POST',body:JSON.stringify({aliasText,actor:'dashboard_operator'})}); if (input) input.value=''; await loadLibrary(true); await openDetail(state.selectedId,true); notify(response.result?.status==='no_change'?'Alias already linked.':'Alias linked and audited.'); } catch(error){notify(error.message,'error');} }
  async function linkResolution(id) { if (!state.selectedId||!id) return; const persistAlias=Boolean(document.querySelector(`[data-character-persist-alias="${CSS.escape(id)}"]`)?.checked); try { const response=await request(`/api/character-library/resolutions/${encodeURIComponent(id)}/link`,{method:'POST',body:JSON.stringify({characterId:state.selectedId,persistAlias,actor:'dashboard_operator'})}); await loadLibrary(true); await openDetail(state.selectedId,true); notify(response.result?.status==='no_change'?'Resolution already linked.':'Resolution linked and audited.'); } catch(error){notify(error.message,'error');} }

  document.addEventListener('input',e=>{if(e.target.matches('#character-library-search'))render();});
  document.addEventListener('change',e=>{if(e.target.matches('#character-library-status,#character-library-species'))render();});
  document.addEventListener('click',e=>{ const open=e.target.closest('[data-character-open]'); if(open)void openDetail(open.dataset.characterOpen); if(e.target.closest('#character-library-refresh'))void loadLibrary(); if(e.target.closest('[data-character-add-alias]'))void addAlias(); const link=e.target.closest('[data-character-link-resolution]'); if(link)void linkResolution(link.dataset.characterLinkResolution); if(e.target.closest('[data-view="characters"]'))setTimeout(()=>void loadLibrary(true),0); });
  window.addEventListener('hashchange',()=>{if(location.hash==='#characters')void loadLibrary(true);}); if(location.hash==='#characters')void loadLibrary(true);
})();
