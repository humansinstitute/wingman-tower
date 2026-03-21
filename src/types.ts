// ---- Groups ----

export interface V4Group {
  id: string;
  owner_npub: string;
  name: string;
  group_npub: string;
  group_kind: string;
  private_member_npub: string | null;
  created_at: Date;
}

export interface V4GroupEpoch {
  id: string;
  group_id: string;
  epoch: number;
  group_npub: string;
  created_by_npub: string;
  created_at: Date;
  superseded_at: Date | null;
}

export interface V4Workspace {
  id: string;
  workspace_owner_npub: string;
  creator_npub: string;
  name: string;
  description: string;
  avatar_url: string | null;
  wrapped_workspace_nsec: string;
  wrapped_by_npub: string;
  default_group_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface V4GroupMember {
  id: string;
  group_id: string;
  member_npub: string;
  created_at: Date;
}

export interface V4GroupMemberKey {
  id: string;
  group_id: string;
  member_npub: string;
  wrapped_group_nsec: string;
  wrapped_by_npub: string;
  approved_by_npub: string;
  key_version: number;
  created_at: Date;
  revoked_at: Date | null;
}

export interface MemberKeyInput {
  member_npub: string;
  wrapped_group_nsec: string;
  wrapped_by_npub: string;
}

export interface CreateGroupInput {
  owner_npub: string;
  name: string;
  group_npub: string;
  group_kind?: string;
  private_member_npub?: string | null;
  member_keys: MemberKeyInput[];
}

export interface CreateWorkspaceInput {
  workspace_owner_npub: string;
  name: string;
  description?: string;
  wrapped_workspace_nsec: string;
  wrapped_by_npub: string;
  default_group_npub: string;
  default_group_name?: string;
  default_group_member_keys: MemberKeyInput[];
  private_group_npub: string;
  private_group_name?: string;
  private_group_member_keys: MemberKeyInput[];
}

export interface UpdateWorkspaceInput {
  name?: string;
  description?: string;
  avatar_url?: string | null;
}

export interface AddMemberInput {
  member_npub: string;
  wrapped_group_nsec: string;
  wrapped_by_npub: string;
}

export interface WrappedGroupKeyEntry {
  group_id: string;
  group_npub: string;
  epoch: number;
  name: string;
  member_npub: string;
  wrapped_group_nsec: string;
  wrapped_by_npub: string;
  approved_by_npub: string;
  key_version: number;
}

export interface UpdateGroupInput {
  name: string;
}

export interface RotateGroupEpochInput {
  group_npub: string;
  member_keys: MemberKeyInput[];
  name?: string;
}

export interface WorkspaceListEntry {
  workspace_id: string;
  workspace_owner_npub: string;
  creator_npub: string;
  name: string;
  description: string;
  avatar_url: string | null;
  default_group_id: string | null;
  default_group_npub: string | null;
  private_group_id: string | null;
  private_group_npub: string | null;
  wrapped_workspace_nsec: string | null;
  wrapped_by_npub: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface V4StorageObject {
  id: string;
  owner_npub: string;
  owner_group_id: string | null;
  created_by_npub: string;
  access_group_ids: string[];
  is_public: boolean;
  file_name: string | null;
  content_type: string;
  size_bytes: number;
  sha256_hex: string | null;
  storage_path: string;
  created_at: Date;
  completed_at: Date | null;
}

export interface PrepareStorageInput {
  owner_npub: string;
  owner_group_id?: string | null;
  access_group_ids?: string[] | null;
  is_public?: boolean;
  content_type: string;
  size_bytes?: number | null;
  file_name?: string | null;
}

export interface CompleteStorageInput {
  sha256_hex?: string | null;
  size_bytes?: number | null;
}

// ---- Records ----

export interface GroupPayloadInput {
  group_id?: string;
  group_epoch?: number;
  group_npub: string;
  ciphertext: string;
  write: boolean;
}

export interface SyncRecordInput {
  record_id: string;
  owner_npub: string;
  record_family_hash: string;
  version: number;
  previous_version: number;
  signature_npub: string;
  write_group_id?: string;
  write_group_npub?: string;
  owner_payload: { ciphertext: string };
  group_payloads?: GroupPayloadInput[];
}

export interface SyncRequestBody {
  owner_npub: string;
  records: SyncRecordInput[];
  group_write_tokens?: Record<string, string>;
}

export interface V4Record {
  id: string;
  record_id: string;
  owner_npub: string;
  record_family_hash: string;
  version: number;
  previous_version: number;
  signature_npub: string;
  owner_ciphertext: string;
  created_at: Date;
  updated_at: Date;
}

export interface V4RecordGroupPayload {
  id: string;
  record_row_id: string;
  group_id: string | null;
  group_epoch: number | null;
  group_npub: string;
  ciphertext: string;
  can_write: boolean;
}

export interface RecordResponse {
  record_id: string;
  owner_npub: string;
  record_family_hash: string;
  version: number;
  previous_version: number;
  signature_npub: string;
  owner_payload: { ciphertext: string };
  group_payloads: {
    group_id?: string;
    group_epoch?: number;
    group_npub: string;
    ciphertext: string;
    write: boolean;
  }[];
  updated_at: string;
}

export interface FetchRecordsInput {
  owner_npub: string;
  viewer_npub?: string;
  record_family_hash: string;
  since?: string;
}

export interface FetchRecordsSummaryInput {
  owner_npub: string;
  viewer_npub?: string;
  record_family_hash?: string;
  since?: string;
}

export interface RecordFamilySummary {
  record_family_hash: string;
  latest_updated_at: string;
  latest_record_count: number;
  count_since: number | null;
}

export interface RecordsSummaryResponse {
  families: RecordFamilySummary[];
}

export interface SyncResult {
  synced: number;
  created: number;
  updated: number;
  rejected: { record_id: string; reason: string }[];
}
