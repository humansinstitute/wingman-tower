-- V4 Coworker MVP schema

CREATE TABLE IF NOT EXISTS v4_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_npub TEXT NOT NULL,
  name TEXT NOT NULL,
  group_npub TEXT NOT NULL UNIQUE,
  group_kind TEXT NOT NULL DEFAULT 'shared',
  private_member_npub TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v4_groups_owner ON v4_groups(owner_npub);
CREATE INDEX IF NOT EXISTS idx_v4_groups_private_member ON v4_groups(private_member_npub);

CREATE TABLE IF NOT EXISTS v4_group_epochs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES v4_groups(id) ON DELETE CASCADE,
  epoch INTEGER NOT NULL,
  group_npub TEXT NOT NULL UNIQUE,
  created_by_npub TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at TIMESTAMPTZ,
  UNIQUE(group_id, epoch)
);

CREATE INDEX IF NOT EXISTS idx_v4_group_epochs_group ON v4_group_epochs(group_id);
CREATE INDEX IF NOT EXISTS idx_v4_group_epochs_npub ON v4_group_epochs(group_npub);

CREATE TABLE IF NOT EXISTS v4_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_owner_npub TEXT NOT NULL UNIQUE,
  creator_npub TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  wrapped_workspace_nsec TEXT NOT NULL,
  wrapped_by_npub TEXT NOT NULL,
  default_group_id UUID REFERENCES v4_groups(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v4_workspaces_creator ON v4_workspaces(creator_npub);

CREATE TABLE IF NOT EXISTS v4_group_member_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES v4_groups(id) ON DELETE CASCADE,
  member_npub TEXT NOT NULL,
  wrapped_group_nsec TEXT NOT NULL,
  wrapped_by_npub TEXT NOT NULL,
  approved_by_npub TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(group_id, member_npub, key_version)
);

CREATE INDEX IF NOT EXISTS idx_v4_gmk_group ON v4_group_member_keys(group_id);
CREATE INDEX IF NOT EXISTS idx_v4_gmk_member ON v4_group_member_keys(member_npub);

CREATE TABLE IF NOT EXISTS v4_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES v4_groups(id) ON DELETE CASCADE,
  member_npub TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id, member_npub)
);

CREATE INDEX IF NOT EXISTS idx_v4_group_members_group ON v4_group_members(group_id);

CREATE TABLE IF NOT EXISTS v4_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id TEXT NOT NULL,
  owner_npub TEXT NOT NULL,
  record_family_hash TEXT NOT NULL,
  version INTEGER NOT NULL,
  previous_version INTEGER NOT NULL DEFAULT 0,
  signature_npub TEXT NOT NULL,
  owner_ciphertext TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(record_id, version)
);

CREATE INDEX IF NOT EXISTS idx_v4_records_owner ON v4_records(owner_npub);
CREATE INDEX IF NOT EXISTS idx_v4_records_family ON v4_records(owner_npub, record_family_hash);
CREATE INDEX IF NOT EXISTS idx_v4_records_record_id ON v4_records(record_id);
CREATE INDEX IF NOT EXISTS idx_v4_records_updated ON v4_records(updated_at);

CREATE TABLE IF NOT EXISTS v4_record_group_payloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_row_id UUID NOT NULL REFERENCES v4_records(id) ON DELETE CASCADE,
  group_id UUID REFERENCES v4_groups(id) ON DELETE SET NULL,
  group_epoch INTEGER,
  group_npub TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  can_write BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_v4_rgp_row ON v4_record_group_payloads(record_row_id);
CREATE INDEX IF NOT EXISTS idx_v4_rgp_group_id_epoch ON v4_record_group_payloads(group_id, group_epoch);
CREATE INDEX IF NOT EXISTS idx_v4_rgp_group ON v4_record_group_payloads(group_npub);

CREATE TABLE IF NOT EXISTS v4_storage_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_npub TEXT NOT NULL,
  created_by_npub TEXT NOT NULL,
  access_group_npubs TEXT[] NOT NULL DEFAULT '{}',
  file_name TEXT,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  sha256_hex TEXT,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_v4_storage_owner ON v4_storage_objects(owner_npub);
CREATE INDEX IF NOT EXISTS idx_v4_storage_creator ON v4_storage_objects(created_by_npub);
