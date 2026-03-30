# SBIP-0008: Connection Tokens And Service Discovery

- Status: Draft
- Type: Standards Track
- Created: 2026-03-29
- Requires: SBIP-0001, SBIP-0002, SBIP-0003

## Abstract

This document defines the base Superbased connection token used for workspace
service discovery and client bootstrap.

## Motivation

Clients need a compact format that tells them which HTTPS service to use, which
workspace owner to bind to, and which application namespace they are acting
under.

## Specification

### Token Encoding

A connection token is a base64-encoded UTF-8 JSON object.

The current token payload uses:

- `type`
- `version`
- `direct_https_url`
- `workspace_owner_npub`
- `app_npub`
- optional `service_npub`
- optional `relay` or `relays`

### Required Fields

The token MUST include:

- `type = "superbased_connection"`
- `version = 2`
- `direct_https_url`
- `workspace_owner_npub`
- `app_npub`

### Optional Fields

The token MAY include:

- `service_npub`
- `relay`
- `relays`

If one relay URL is present, the current reference implementation emits
`relay`.

If multiple relay URLs are present, it emits `relays`.

### Semantics

`direct_https_url` is the base HTTPS origin clients should use for the API.

`workspace_owner_npub` identifies the workspace authority domain the client will
operate within.

`app_npub` identifies the application namespace or app authority the client is
binding to.

`service_npub`, when present, identifies the server's Nostr service identity.

Relay hints are advisory discovery information. They are not currently required
for HTTP operation.

### Validation

Clients decoding a token SHOULD verify:

- `type` is recognized
- `version` is supported
- `direct_https_url` is a usable HTTPS base URL
- `workspace_owner_npub` is present
- `app_npub` is present

Clients MUST reject or warn on unsupported token versions.

## Security Considerations

- The current token format is not signed by itself. It must therefore be
  obtained over a trusted channel or bundled inside a trusted higher-level
  package.
- Clients SHOULD treat the token as configuration data, not proof of authority.

## Backward Compatibility Notes

This SBIP only covers the base token format. Higher-level packaging such as
Agent Connect profiles are specified separately.

## Reference Implementation Notes

Reference files:

- `src/admin-token.ts`
- `src/routes/admin.ts`
- `tests/admin-token.test.ts`
