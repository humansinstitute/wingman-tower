# SBIP-0006: Delegated Group Writes

- Status: Draft
- Type: Standards Track
- Created: 2026-03-29
- Requires: SBIP-0002, SBIP-0004, SBIP-0005

## Abstract

This document defines how a non-owner actor may write a record on behalf of a
workspace owner using group-scoped write authority.

## Motivation

Shared records need a way for non-owner participants to create or update data
without directly possessing the owner's private identity. The current protocol
uses a second NIP-98 proof signed by the current group identity.

## Specification

### Overview

A delegated write involves two authenticated statements:

1. the top-level request authenticated by the submitting actor
2. a group write proof authenticated by the current write-group identity

The submitting actor and the proof signer are different principals with
different meanings.

### Request Requirements

For a non-owner write:

- the authenticated actor MUST equal `record.signature_npub`
- the actor MUST NOT be the same as `owner_npub`
- the record MUST specify either `write_group_id` or `write_group_npub`
- the request MUST include a matching entry in `group_write_tokens`

### Canonical Proof Payload

The current protocol defines the write-proof payload hash over the canonical
JSON object:

```json
{
  "owner_npub": "<owner>",
  "records": [ ... ]
}
```

The `group_write_tokens` field is intentionally excluded from that hashed
payload.

Servers implementing this protocol MUST verify delegated write proofs against
that canonical payload, not against the raw request body.

### Group Write Token Map

`group_write_tokens` is a map where:

- key: either a current `group_npub` or a stable `group_id`
- value: a NIP-98 authorization token

For each token, the server resolves the target group as follows:

1. if the map key looks like a UUID, resolve it as a group ID and use the
   current epoch
2. otherwise resolve it as the group's current `group_npub`

If the proof verifies and the proof signer matches the target group's current
`group_npub`, that group becomes an authorized write group for the request.

### Additional Delegated Write Checks

After proof verification, a non-owner write MUST satisfy all of the following:

- the authenticated actor is a current member of the write group
- the write group has valid proof in `group_write_tokens`

For new records:

- the record MUST include at least one group payload addressed to that group
- that payload MUST have `write = true`

For updates to an existing record:

- the prior version MUST already include a writable group payload for that group

### Scope Of Delegation

Delegated write authority is per request and per group proof.

The current implementation does not define:

- long-lived server-side group write sessions
- reusable server-issued write grants
- delegation beyond the current active group identity

### Failure Cases

A delegated write MUST be rejected if:

- the write group cannot be resolved
- no valid proof exists for the write group
- the authenticated actor is not a current member of the write group
- a new record is not shared back to the write group with `write = true`
- an updated record was not writable by that group on the prior version

## Security Considerations

- The proof signer is the current group identity, not an individual member.
- Because proofs bind to `{ owner_npub, records }`, clients MUST regenerate the
  proof if the record batch changes.
- Delegated writes depend on current membership for the submitting actor, even
  if the record payload references historical group epochs.

## Backward Compatibility Notes

This SBIP documents the current Tower delegated-write behavior exactly, notably
the canonical proof hash and the use of current `group_npub` as the proof
signer.

## Reference Implementation Notes

Reference files:

- `src/routes/records.ts`
- `src/services/records.ts`
- `tests/records.test.ts`
