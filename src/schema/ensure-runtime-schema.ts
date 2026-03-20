import { getDb } from '../db';

export async function ensureRuntimeSchema() {
  const sql = getDb();

  await sql.unsafe(`
    ALTER TABLE v4_groups
    ADD COLUMN IF NOT EXISTS group_npub TEXT
  `);

  await sql.unsafe(`
    ALTER TABLE v4_groups
    ADD COLUMN IF NOT EXISTS group_kind TEXT NOT NULL DEFAULT 'shared'
  `);

  await sql.unsafe(`
    ALTER TABLE v4_groups
    ADD COLUMN IF NOT EXISTS private_member_npub TEXT
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS idx_v4_groups_private_member
    ON v4_groups(private_member_npub)
  `);

  await sql.unsafe(`
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await sql.unsafe(`
    ALTER TABLE v4_workspaces
    ADD COLUMN IF NOT EXISTS avatar_url TEXT
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS idx_v4_workspaces_creator
    ON v4_workspaces(creator_npub)
  `);

  await sql.unsafe(`
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
    )
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS idx_v4_gmk_group ON v4_group_member_keys(group_id)
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS idx_v4_gmk_member ON v4_group_member_keys(member_npub)
  `);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS v4_group_epochs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID NOT NULL REFERENCES v4_groups(id) ON DELETE CASCADE,
      epoch INTEGER NOT NULL,
      group_npub TEXT NOT NULL UNIQUE,
      created_by_npub TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      superseded_at TIMESTAMPTZ,
      UNIQUE(group_id, epoch)
    )
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS idx_v4_group_epochs_group
    ON v4_group_epochs(group_id)
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS idx_v4_group_epochs_npub
    ON v4_group_epochs(group_npub)
  `);

  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_v4_groups_group_npub
    ON v4_groups(group_npub)
    WHERE group_npub IS NOT NULL
  `);

  await sql.unsafe(`
    INSERT INTO v4_group_epochs (group_id, epoch, group_npub, created_by_npub, created_at)
    SELECT g.id, 1, g.group_npub, g.owner_npub, g.created_at
    FROM v4_groups g
    WHERE g.group_npub IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM v4_group_epochs ge
        WHERE ge.group_id = g.id
          AND ge.epoch = 1
      )
  `);

  await sql.unsafe(`
    ALTER TABLE v4_record_group_payloads
    ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES v4_groups(id) ON DELETE SET NULL
  `);

  await sql.unsafe(`
    ALTER TABLE v4_record_group_payloads
    ADD COLUMN IF NOT EXISTS group_epoch INTEGER
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS idx_v4_rgp_group_id_epoch
    ON v4_record_group_payloads(group_id, group_epoch)
  `);

  await sql.unsafe(`
    UPDATE v4_record_group_payloads rgp
    SET group_id = g.id,
        group_epoch = COALESCE(rgp.group_epoch, 1)
    FROM v4_groups g
    WHERE rgp.group_id IS NULL
      AND rgp.group_npub = g.group_npub
  `);

  await sql.unsafe(`
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ
    )
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS idx_v4_storage_owner ON v4_storage_objects(owner_npub)
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS idx_v4_storage_creator ON v4_storage_objects(created_by_npub)
  `);

  await sql.unsafe(`
    ALTER TABLE v4_storage_objects
    ADD COLUMN IF NOT EXISTS access_group_npubs TEXT[] NOT NULL DEFAULT '{}'
  `);
}
