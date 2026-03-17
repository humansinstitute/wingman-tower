# SuperBased BE Instructions

This backend implements the generic sync and access model described in:

- [../ARCHITECTURE.md](../ARCHITECTURE.md)
- [../design.md](../design.md)
- [../roadmap.md](../roadmap.md)

## Role of this project

- Provide encrypted sync and access control for Coworker workspaces
- Stay generic enough to support multiple record families
- Avoid taking on app-specific translation responsibilities

## Hard rules

- Do not encode Coworker UI assumptions into backend storage
- Do not make the backend schema-aware beyond generic routing/indexing helpers
- Keep access rules generic around owner, groups, membership, and version chains
- Treat member-aware fetch as the real security boundary

## Workspace model

- A workspace has one `owner_npub`
- In v1 a workspace has one authoritative backend
- Users may belong to multiple workspaces, but that is not per-person backend fanout
- Keep backend interfaces workspace-aware so the FE can switch cleanly

## Data model principles

- Records are encrypted payloads plus generic metadata
- `record_family_hash` exists for routing and filtering, not for app translation
- Groups are the access primitive
- Group-authorized writes flow forward from the previous valid record state
- Conflicts should be handled generically, not through app-specific shortcuts

## Future direction

- Support workspace discovery and member-aware access cleanly
- Leave room for replication and mirroring later
- Keep authority-backend and mirror concepts distinct
