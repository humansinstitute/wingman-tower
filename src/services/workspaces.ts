import { getDb } from '../db';
import { resolveWsKeyNpub } from './user-workspace-keys';
import type {
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  V4Group,
  V4GroupMember,
  V4Workspace,
  WorkspaceListEntry,
} from '../types';

async function insertGroup(
  tx: ReturnType<typeof getDb>,
  {
    ownerNpub,
    name,
    groupNpub,
    groupKind,
    privateMemberNpub = null,
    memberKeys,
    approvedByNpub,
  }: {
    ownerNpub: string;
    name: string;
    groupNpub: string;
    groupKind: string;
    privateMemberNpub?: string | null;
    memberKeys: CreateWorkspaceInput['default_group_member_keys'];
    approvedByNpub: string;
  },
): Promise<{ group: V4Group; members: V4GroupMember[] }> {
  const [group] = await tx<V4Group[]>`
    INSERT INTO v4_groups (owner_npub, name, group_npub, group_kind, private_member_npub)
    VALUES (${ownerNpub}, ${name}, ${groupNpub}, ${groupKind}, ${privateMemberNpub})
    RETURNING *
  `;

  await tx`
    INSERT INTO v4_group_epochs (group_id, epoch, group_npub, created_by_npub, created_at)
    VALUES (${group.id}, 1, ${group.group_npub}, ${approvedByNpub}, ${group.created_at})
  `;

  for (const mk of memberKeys) {
    await tx`
      INSERT INTO v4_group_members (group_id, member_npub)
      VALUES (${group.id}, ${mk.member_npub})
      ON CONFLICT (group_id, member_npub) DO NOTHING
    `;

    await tx`
      INSERT INTO v4_group_member_keys (group_id, member_npub, wrapped_group_nsec, wrapped_by_npub, approved_by_npub, key_version)
      VALUES (${group.id}, ${mk.member_npub}, ${mk.wrapped_group_nsec}, ${mk.wrapped_by_npub}, ${approvedByNpub}, 1)
    `;
  }

  const members = await tx<V4GroupMember[]>`
    SELECT *
    FROM v4_group_members
    WHERE group_id = ${group.id}
    ORDER BY created_at ASC, member_npub ASC
  `;

  return { group, members };
}

export async function createWorkspace(
  input: CreateWorkspaceInput,
  creatorNpub: string,
): Promise<{
  workspace: V4Workspace;
  defaultGroup: V4Group;
  defaultGroupMembers: V4GroupMember[];
  adminGroup: V4Group;
  adminGroupMembers: V4GroupMember[];
  privateGroup: V4Group;
  privateGroupMembers: V4GroupMember[];
}> {
  const sql = getDb();

  return sql.begin(async (tx) => {
    const [workspace] = await tx<V4Workspace[]>`
      INSERT INTO v4_workspaces (
        workspace_owner_npub,
        creator_npub,
        name,
        description,
        avatar_url,
        wrapped_workspace_nsec,
        wrapped_by_npub
      )
      VALUES (
        ${input.workspace_owner_npub},
        ${creatorNpub},
        ${input.name},
        ${input.description || ''},
        ${null},
        ${input.wrapped_workspace_nsec},
        ${input.wrapped_by_npub}
      )
      RETURNING *
    `;

    const { group: defaultGroup, members: defaultGroupMembers } = await insertGroup(tx, {
      ownerNpub: input.workspace_owner_npub,
      name: input.default_group_name || `${input.name} Shared`,
      groupNpub: input.default_group_npub,
      groupKind: 'workspace_shared',
      memberKeys: input.default_group_member_keys,
      approvedByNpub: creatorNpub,
    });

    const { group: adminGroup, members: adminGroupMembers } = await insertGroup(tx, {
      ownerNpub: input.workspace_owner_npub,
      name: input.admin_group_name || 'Workspace Admins',
      groupNpub: input.admin_group_npub,
      groupKind: 'workspace_admin',
      memberKeys: input.admin_group_member_keys,
      approvedByNpub: creatorNpub,
    });

    const ownerPrivateMember =
      input.private_group_member_keys.find((entry) => entry.member_npub === creatorNpub)?.member_npub
      || creatorNpub;

    const { group: privateGroup, members: privateGroupMembers } = await insertGroup(tx, {
      ownerNpub: input.workspace_owner_npub,
      name: input.private_group_name || 'Private',
      groupNpub: input.private_group_npub,
      groupKind: 'private',
      privateMemberNpub: ownerPrivateMember,
      memberKeys: input.private_group_member_keys,
      approvedByNpub: creatorNpub,
    });

    const [updatedWorkspace] = await tx<V4Workspace[]>`
      UPDATE v4_workspaces
      SET default_group_id = ${defaultGroup.id},
          admin_group_id = ${adminGroup.id},
          updated_at = NOW()
      WHERE id = ${workspace.id}
      RETURNING *
    `;

    return {
      workspace: updatedWorkspace,
      defaultGroup,
      defaultGroupMembers,
      adminGroup,
      adminGroupMembers,
      privateGroup,
      privateGroupMembers,
    };
  });
}

export async function getWorkspaceCreator(workspaceOwnerNpub: string): Promise<string | null> {
  const sql = getDb();
  const [workspace] = await sql<Pick<V4Workspace, 'creator_npub'>[]>`
    SELECT creator_npub
    FROM v4_workspaces
    WHERE workspace_owner_npub = ${workspaceOwnerNpub}
  `;
  return workspace?.creator_npub ?? null;
}

export async function canManageWorkspace(workspaceOwnerNpub: string, actorNpub: string): Promise<boolean> {
  if (!workspaceOwnerNpub || !actorNpub) return false;
  // Resolve ws_key_npub → real user_npub if applicable
  const resolvedNpub = await resolveWsKeyNpub(actorNpub) ?? actorNpub;
  const sql = getDb();
  const [workspace] = await sql<Pick<V4Workspace, 'creator_npub' | 'admin_group_id'>[]>`
    SELECT creator_npub, admin_group_id
    FROM v4_workspaces
    WHERE workspace_owner_npub = ${workspaceOwnerNpub}
    LIMIT 1
  `;
  if (!workspace) return false;
  if (workspace.creator_npub === resolvedNpub) return true;
  if (!workspace.admin_group_id) return false;

  const [membership] = await sql<{ ok: number }[]>`
    SELECT 1 AS ok
    FROM v4_group_members
    WHERE group_id = ${workspace.admin_group_id}
      AND member_npub = ${resolvedNpub}
    LIMIT 1
  `;
  return membership?.ok === 1;
}

export async function updateWorkspace(
  workspaceOwnerNpub: string,
  input: UpdateWorkspaceInput,
): Promise<V4Workspace | null> {
  const sql = getDb();
  const [current] = await sql<V4Workspace[]>`
    SELECT *
    FROM v4_workspaces
    WHERE workspace_owner_npub = ${workspaceOwnerNpub}
  `;
  if (!current) return null;

  const nextName = input.name ?? current.name;
  const nextDescription = input.description ?? current.description;
  const nextAvatarUrl = input.avatar_url === undefined ? current.avatar_url : input.avatar_url;

  const [updated] = await sql<V4Workspace[]>`
    UPDATE v4_workspaces
    SET name = ${nextName},
        description = ${nextDescription},
        avatar_url = ${nextAvatarUrl},
        updated_at = NOW()
    WHERE workspace_owner_npub = ${workspaceOwnerNpub}
    RETURNING *
  `;

  return updated ?? null;
}

export async function recoverWorkspace(
  workspaceOwnerNpub: string,
  creatorNpub: string,
  name: string,
  wrappedWorkspaceNsec: string,
  wrappedByNpub: string,
): Promise<V4Workspace> {
  const sql = getDb();

  const existing = await sql<V4Workspace[]>`
    SELECT * FROM v4_workspaces WHERE workspace_owner_npub = ${workspaceOwnerNpub}
  `;
  if (existing.length > 0) {
    throw Object.assign(new Error('workspace already exists'), { code: 'ALREADY_EXISTS' });
  }

  const isMember = await sql<{ count: string }[]>`
    SELECT COUNT(*) AS count
    FROM v4_group_members gm
    JOIN v4_groups g ON g.id = gm.group_id
    WHERE g.owner_npub = ${workspaceOwnerNpub}
      AND gm.member_npub = ${creatorNpub}
  `;
  if (!isMember.length || Number(isMember[0].count) === 0) {
    throw Object.assign(new Error('not a member of any group for this workspace owner'), { code: 'NOT_MEMBER' });
  }

  const sharedGroups = await sql<V4Group[]>`
    SELECT * FROM v4_groups
    WHERE owner_npub = ${workspaceOwnerNpub}
      AND group_kind = 'workspace_shared'
    ORDER BY created_at ASC
    LIMIT 1
  `;
  const defaultGroupId = sharedGroups.length > 0 ? sharedGroups[0].id : null;

  const [workspace] = await sql<V4Workspace[]>`
    INSERT INTO v4_workspaces (
      workspace_owner_npub, creator_npub, name, description,
      wrapped_workspace_nsec, wrapped_by_npub, default_group_id
    ) VALUES (
      ${workspaceOwnerNpub}, ${creatorNpub}, ${name}, '',
      ${wrappedWorkspaceNsec}, ${wrappedByNpub}, ${defaultGroupId}
    )
    RETURNING *
  `;

  return workspace;
}

export async function listWorkspacesForMember(memberNpub: string, resolveKey = false): Promise<WorkspaceListEntry[]> {
  const sql = getDb();
  // If the caller might be using a ws_key_npub, resolve to real identity
  const effectiveNpub = resolveKey ? (await resolveWsKeyNpub(memberNpub) ?? memberNpub) : memberNpub;

  const workspaces = await sql<WorkspaceListEntry[]>`
    SELECT DISTINCT
      w.id AS workspace_id,
      w.workspace_owner_npub,
      w.creator_npub,
      w.name,
      w.description,
      w.avatar_url,
      w.default_group_id,
      dg.group_npub AS default_group_npub,
      w.admin_group_id,
      ag.group_npub AS admin_group_npub,
      pg.id AS private_group_id,
      pg.group_npub AS private_group_npub,
      CASE WHEN w.creator_npub = ${effectiveNpub} THEN w.wrapped_workspace_nsec ELSE NULL END AS wrapped_workspace_nsec,
      CASE WHEN w.creator_npub = ${effectiveNpub} THEN w.wrapped_by_npub ELSE NULL END AS wrapped_by_npub,
      w.created_at,
      w.updated_at
    FROM v4_workspaces w
    LEFT JOIN v4_groups dg
      ON dg.id = w.default_group_id
    LEFT JOIN v4_groups ag
      ON ag.id = w.admin_group_id
    LEFT JOIN v4_groups pg
      ON pg.owner_npub = w.workspace_owner_npub
     AND pg.group_kind = 'private'
     AND pg.private_member_npub = ${effectiveNpub}
    LEFT JOIN v4_groups g
      ON g.owner_npub = w.workspace_owner_npub
    LEFT JOIN v4_group_members gm
      ON gm.group_id = g.id
    WHERE w.creator_npub = ${effectiveNpub}
       OR gm.member_npub = ${effectiveNpub}
    ORDER BY w.updated_at DESC, w.created_at DESC
  `;

  return workspaces;
}
