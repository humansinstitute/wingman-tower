# SBIP-0001: Terminology And Object Model

- Status: Draft
- Type: Standards Track
- Created: 2026-03-29
- Requires: SBIP-0000

## Abstract

This document defines the core nouns and identity model for Superbased V4.

## Motivation

The current implementation uses a small number of shared concepts across
workspaces, groups, records, and storage. Those concepts need stable meanings
before the rest of the protocol can be specified.

## Specification

### Workspace

A `workspace` is the top-level authority and ownership domain for shared data.

A workspace has:

- a stable `workspace_owner_npub`
- optionally a synonymous `workspace_npub`
- a `creator_npub`
- metadata such as `name`, `description`, and `avatar_url`
- a wrapped workspace secret `wrapped_workspace_nsec`
- a `default_group_id`

The `workspace_owner_npub` is the canonical owner identity for shared data in
that workspace. It is not required to equal the actor who bootstrapped the
workspace.

Implementations MAY also expose `workspace_npub` as a clearer alias for the same
value. When both fields are present, `workspace_npub` and
`workspace_owner_npub` MUST be equal.

The `creator_npub` is the actor that created the workspace record on the server.
In the current Tower implementation, this actor is also the principal manager
for workspace-level administrative actions.

The current protocol treats workspace identity and service identity as separate
axes:

- `workspace_owner_npub` identifies the workspace authority domain
- `service_npub` identifies the HTTPS service currently hosting that workspace

Clients MUST NOT treat a URL by itself as a durable workspace identity.

### Group

A `group` is a durable sharing domain inside a workspace.

A group has:

- a stable server-generated UUID `id`
- an `owner_npub`
- a mutable `group_npub`
- a `group_kind`
- an optional `private_member_npub`

The stable `group.id` is the long-lived server identity of the group.

The mutable `group_npub` is the current public identity of the group for the
active epoch. It MAY rotate over time.

### Group Epoch

A `group epoch` is a versioned group identity snapshot.

An epoch has:

- a `group_id`
- an integer `epoch`
- a `group_npub`
- a `created_by_npub`
- an optional `superseded_at`

Each epoch represents a new active public identity and a new key distribution
version for the same stable group.

### Group Membership

`v4_group_members` represents current membership only.

Current membership is mutable and is not by itself sufficient to reconstruct
historical read access. Historical access depends on `group_id + epoch` through
wrapped keys and record payload references.

### Wrapped Group Member Key

A wrapped group member key binds:

- `group_id`
- `member_npub`
- `wrapped_group_nsec`
- `wrapped_by_npub`
- `approved_by_npub`
- `key_version`

In the current protocol, `key_version` is the same logical value as the group
epoch number. Implementations SHOULD treat `key_version == epoch` as the
canonical relationship for epoch-based access.

### Record

A `record` is an append-only version chain identified by `record_id`.

Each concrete stored version has:

- `record_id`
- `owner_npub`
- `record_family_hash`
- `version`
- `previous_version`
- `signature_npub`
- `owner_ciphertext`

`record_family_hash` is an opaque application-defined family identifier in the
current protocol.

### Group Payload

A record version MAY include zero or more `group_payloads`.

Each group payload contains:

- `group_id` optional
- `group_epoch` optional
- `group_npub`
- `ciphertext`
- `write`

If `group_id` and `group_epoch` are present, they identify a stable historical
access scope. This is the preferred form for durable shared records.

If only `group_npub` is present, access resolution is based on that public group
identity and may track current membership rather than historical epoch state.

### Storage Object

A `storage object` is an immutable binary object with separate metadata and
content lifecycle.

A storage object has:

- `owner_npub`
- optional `owner_group_id`
- `created_by_npub`
- `access_group_ids`
- `is_public`
- `content_type`
- `size_bytes`
- optional `sha256_hex`
- `storage_path`
- optional `completed_at`

### Visibility Domains

Superbased currently has three main visibility domains:

- owner-visible
- group-visible
- public

Records use owner visibility plus per-record group payloads.
Storage objects use owner visibility, `access_group_ids`, and optional public
exposure.

## Security Considerations

- Implementations MUST distinguish stable group UUIDs from rotating `group_npub`
  identities.
- Implementations SHOULD prefer `group_id + group_epoch` when durable historical
  access semantics matter.
- A client MUST NOT assume current membership implies historical access.

## Backward Compatibility Notes

The current Tower implementation accepts payloads identified only by
`group_npub`. This remains valid but is less precise than UUID-plus-epoch
addressing.

## Reference Implementation Notes

Reference files:

- `src/schema/001_init.sql`
- `src/types.ts`
- `src/services/workspaces.ts`
- `src/services/groups.ts`
- `src/services/records.ts`
- `src/services/storage.ts`
