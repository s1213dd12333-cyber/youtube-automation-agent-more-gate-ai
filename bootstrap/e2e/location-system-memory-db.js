'use strict';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class MemoryLocationDb {
  constructor() {
    this.n = 0;
    for (const key of ['locations', 'usages', 'aliases', 'resolutions', 'autos', 'zones', 'zoneUsages', 'states', 'assets', 'cross']) this[key] = [];
  }
  id(prefix) { this.n += 1; return `${prefix}_${this.n}`; }
  upsert(items, find, value, prefix = null) {
    const index = items.findIndex(find);
    const record = { ...(index >= 0 ? items[index] : {}), ...clone(value) };
    if (prefix && !record.id) record.id = this.id(prefix);
    if (index >= 0) items[index] = record; else items.push(record);
    return clone(record);
  }

  async getReusableLocationByFingerprint(namespace, fingerprint) { return clone(this.locations.find(x => x.namespace === (namespace || 'default') && x.identityFingerprint === fingerprint) || null); }
  async getReusableLocation(id) { return clone(this.locations.find(x => x.id === id) || null); }
  async listReusableLocations(namespace = 'default') { return clone(this.locations.filter(x => x.namespace === namespace)); }
  async saveReusableLocation(value) { return this.upsert(this.locations, x => x.id === value.id || (x.namespace === value.namespace && x.identityFingerprint === value.identityFingerprint), value); }

  async saveReusableLocationUsage(value) { return this.upsert(this.usages, x => x.locationId === value.locationId && x.productionId === value.productionId && x.environmentId === value.environmentId, value, 'use'); }
  async getReusableLocationUsage(locationId, productionId, environmentId) { return clone(this.usages.find(x => x.locationId === locationId && x.productionId === productionId && x.environmentId === environmentId) || null); }
  async listReusableLocationUsages(locationId) { return clone(this.usages.filter(x => x.locationId === locationId)); }
  async listProductionReusableLocations(productionId) {
    return clone(this.usages.filter(x => x.productionId === productionId).map(usage => {
      const location = this.locations.find(x => x.id === usage.locationId);
      return { ...location, usage, reusedAcrossVideos: Boolean(location?.createdFromProductionId && location.createdFromProductionId !== productionId) };
    }));
  }

  async saveReusableLocationAlias(value) { return this.upsert(this.aliases, x => x.namespace === value.namespace && x.locationId === value.locationId && x.aliasKey === value.aliasKey, value, 'alias'); }
  async listReusableLocationAliasesByKey(namespace, aliasKey) { return clone(this.aliases.filter(x => x.namespace === (namespace || 'default') && x.aliasKey === aliasKey)); }
  async listReusableLocationAliases(locationId) { return clone(this.aliases.filter(x => x.locationId === locationId)); }

  async saveReusableLocationResolution(value) { return this.upsert(this.resolutions, x => x.productionId === value.productionId && x.environmentId === value.environmentId, value, 'resolution'); }
  async listProductionReusableLocationResolutions(productionId) { return clone(this.resolutions.filter(x => x.productionId === productionId)); }

  async saveReusableLocationAutoSelection(value) { return this.upsert(this.autos, x => x.productionId === value.productionId && x.environmentId === value.environmentId, value, 'auto'); }
  async listReusableLocationAutoSelections(namespace = 'default', limit = 100) { return clone(this.autos.filter(x => x.namespace === namespace).slice(-limit).reverse()); }

  async getReusableLocationZoneByKey(locationId, zoneKey) { return clone(this.zones.find(x => x.locationId === locationId && x.zoneKey === zoneKey) || null); }
  async saveReusableLocationZone(value) { return this.upsert(this.zones, x => x.id === value.id || (x.locationId === value.locationId && x.zoneKey === value.zoneKey), value); }
  async saveReusableLocationZoneUsage(value) { return this.upsert(this.zoneUsages, x => x.productionId === value.productionId && x.sceneId === value.sceneId, value, 'zone_usage'); }
  async listReusableLocationZones(locationId) { return clone(this.zones.filter(x => x.locationId === locationId)); }
  async listProductionReusableLocationZones(productionId) { return clone(this.zoneUsages.filter(x => x.productionId === productionId).map(usage => ({ ...this.zones.find(z => z.id === usage.zoneId), usage }))); }

  async saveReusableLocationStateLayer(value) { return this.upsert(this.states, x => x.productionId === value.productionId && x.sceneId === value.sceneId, value); }
  async getReusableLocationStateLayer(productionId, sceneId) { return clone(this.states.find(x => x.productionId === productionId && x.sceneId === sceneId) || null); }

  async getReusableLocationAssetByKey(assetKey) { return clone(this.assets.find(x => x.assetKey === assetKey) || null); }
  async getReusableLocationAsset(id) { return clone(this.assets.find(x => x.id === id) || null); }
  async saveReusableLocationAsset(value) { return this.upsert(this.assets, x => x.assetKey === value.assetKey, value, 'asset'); }
  async listReusableLocationAssets(locationId, zoneId = null) { return clone(this.assets.filter(x => x.locationId === locationId && (zoneId == null || x.zoneId === zoneId))); }

  async getLatestSemanticPropCheck() { return null; }
  async saveCrossVideoContinuityCheck(value) { const record = { id: this.id('cross_video'), ...clone(value) }; this.cross.push(record); return clone(record); }
}

module.exports = { MemoryLocationDb, clone };
