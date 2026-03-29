# Decision: Tower is payload-agnostic for scope lineage migration

**Date:** 2026-03-30
**Scope:** scope-levels-l1-l5 / Tower compatibility validation
**Refs:** scope_id 8c87556f-e48d-427a-851e-aa380e25ad60, design c0c0d74e-e71e-4d4d-b5d8-18206fa44a85

## Context

The scope lineage migration (docs/design/scope-levels-l1-l5.md) replaces semantic scope fields (`product_id`, `project_id`, `scope_product_id`, `scope_project_id`, `scope_deliverable_id`) with generic depth-based lineage fields (`l1_id`–`l5_id`, `scope_l1_id`–`scope_l5_id`).

## Decision

**No Tower code changes are required for the scope lineage migration.**

Tower stores record payloads as opaque ciphertext strings (`owner_ciphertext` and group `ciphertext`). It never inspects, validates, or indexes the content of these payloads. The scope lineage fields live entirely within the encrypted payload layer.

## Validation Evidence

23 tests added in `tests/scope-lineage-compat.test.ts` confirm:

1. **All five depth levels round-trip**: L1–L5 scope records with canonical `l1_id`–`l5_id` lineage sync and fetch with payloads intact.
2. **Scoped record lineage tags round-trip**: Tasks with `scope_l1_id`–`scope_l5_id` sync and fetch correctly.
3. **Migration path works**: Legacy payloads (v1 with `product_id`/`project_id`) can be updated to canonical payloads (v2 with `l1_id`–`l5_id`) via normal version-chain sync. Record history preserves both versions.
4. **Unscoped records unaffected**: Records with all-null lineage slots work fine.
5. **Summary and heartbeat work**: Family summaries and heartbeat stale-detection function correctly with canonical payload records.
6. **Payload-agnostic by design**: Tower accepts arbitrary (non-JSON) ciphertext, mixed legacy+canonical fields, and any payload shape without inspection or rejection.

## Implications

- Tower can be deployed before, during, or after the client-side migration — it imposes no ordering constraint.
- No schema migration needed in Tower's PostgreSQL tables.
- No OpenAPI changes needed (record sync/fetch shapes are unchanged).
- The migration is purely a client-side payload transformation.
