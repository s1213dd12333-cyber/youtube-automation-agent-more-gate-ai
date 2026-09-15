'use strict';

const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const target = path.join(upstream, 'utils', 'reusable-location-library-v11.js');
let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const marker = "matchMode: 'resolver_unresolved_register_new'";
if (!source.includes(marker)) {
  const anchor = "    await this.locationResolver.ensureLocationAliases(location, environment);\n\n    return {\n";
  if (!source.includes(anchor)) throw new Error('Phase 11.9.4 audit hardening anchor not found in reusable-location-library-v11.js');
  const block = [
    "    // Phase 11.9.4 audit hardening: once an unresolved reference becomes a legitimately new location,",
    "    // replace the provisional unresolved resolver row with the truthful final outcome.",
    "    if (!existing && resolution?.status === 'unresolved' && this.db?.saveReusableLocationResolution) {",
    "      await this.db.saveReusableLocationResolution({",
    "        namespace: this.namespace,",
    "        productionId: production.id,",
    "        environmentId: environment.environmentId,",
    "        referenceText: resolution.referenceText || environment.locationReference || environment.locationName || environment.name || environment.reusableLocationKey || environment.locationKey || environment.category || null,",
    "        referenceKey: resolution.referenceKey || null,",
    "        requestedType: resolution.requestedType || location.locationType || null,",
    "        status: 'registered_new',",
    "        locationId: location.id,",
    "        matchMode: 'resolver_unresolved_register_new',",
    "        confidence: 1,",
    "        candidateLocationIds: [],",
    "        reason: 'no_safe_reusable_location_match_registered_new',",
    "        identityFingerprint: fingerprint",
    "      });",
    "    }",
    "",
    "    await this.locationResolver.ensureLocationAliases(location, environment);",
    "",
    "    return {",
    ""
  ].join('\n');
  source = source.replace(anchor, block);
  fs.writeFileSync(target, source, 'utf8');
}

console.log('Phase 11.9.4 audit hardening active: unresolved resolver rows are finalized as registered_new after a legitimate new reusable location is created.');
