# Phase 11.9.2 — Reusable Location Zones / Rooms

Phase 11.9.2 promotes scene-level zone labels into persistent subspaces of the production-independent Reusable Location Library introduced in 11.9.1.

A recurring place can now own stable rooms and subspaces such as:

```text
Miller House
├── Living Room
├── Kitchen
├── Bedroom
├── Bathroom
├── Hallway
├── Entrance
└── Exterior
```

Each zone receives a deterministic `zoneId` under the stable parent `locationId`. A later video that maps its production-local environment to the same reusable location and names the same room reuses the same zone record instead of creating a new room.

## Persistence

`reusable_location_zones` stores canonical zone identities.

`reusable_location_zone_usages` binds each production scene to the shared `locationId + zoneId` pair.

Zone identity includes only stable hierarchy information:

- parent reusable location ID;
- parent location identity fingerprint;
- normalized zone key;
- zone type;
- canonical display name.

Temporary state is deliberately excluded. Night/day, rain, lighting, characters, actions, camera angle, shot size, and temporary clutter do not create a new zone.

## Evidence and fail-closed behavior

The registry reuses the zone emitted by Phase 11.7.4 when available. If the old mapper has no zone, 11.9.2 can recover a room only from an explicit, unambiguous scene term.

Examples:

```text
"Tom waits in the kitchen"            -> kitchen
"Tom walks through the hallway"       -> hallway
"Tom leaves the kitchen and enters
 the living room"                      -> ambiguous, no zone binding
```

The registry does not invent room adjacency, dimensions, doors, furniture, or prop placement. Canonical visual assets for individual zones belong to 11.9.3.

## Supported normalized zone identities

The initial registry includes living room, kitchen, bedroom, bathroom, dining area, hallway, entrance, stairs, office, garage, basement, attic, classroom, garden, yard, porch, balcony, play area, forest path, and exterior, including common English/Portuguese aliases.

## Configuration

```env
REUSABLE_LOCATION_ZONES_ENABLED=true
```

## Apply and verify

Apply 11.9.1 first, then:

```powershell
node ..\bootstrap\phase11-location-zones.js
npm run test:location-zones
```

The verifier covers normalization, alias stability, ambiguity fail-closed behavior, parent/zone fingerprints, cross-video reuse, temporary-state invariance, missing-location handling, SQLite schema/methods, pipeline integration, dashboard integration, and configuration.
