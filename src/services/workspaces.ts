import { getDb } from '../db';
import type {
  CreateWorkspaceInput,
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
        wrapped_workspace_nsec,
        wrapped_by_npub
      )
      VALUES (
        ${input.workspace_owner_npub},
        ${creatorNpub},
        ${input.name},
        ${input.description || ''},
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
          updated_at = NOW()
      WHERE id = ${workspace.id}
      RETURNING *
    `;

    return {
      workspace: updatedWorkspace,
      defaultGroup,
      defaultGroupMembers,
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
  if (workspaceOwnerNpub === actorNpub) return true;
  const creator = await getWorkspaceCreator(workspaceOwnerNpub);
  return creator === actorNpub;
}

export async function listWorkspacesForMember(memberNpub: string): Promise<WorkspaceListEntry[]> {
  const sql = getDb();

  const workspaces = await sql<WorkspaceListEntry[]>`
    SELECT DISTINCT
      w.id AS workspace_id,
      w.workspace_owner_npub,
      w.creator_npub,
      w.name,
      w.description,
      w.default_group_id,
      dg.group_npub AS default_group_npub,
      pg.id AS private_group_id,
      pg.group_npub AS private_group_npub,
      CASE WHEN w.creator_npub = ${memberNpub} THEN w.wrapped_workspace_nsec ELSE NULL END AS wrapped_workspace_nsec,
      CASE WHEN w.creator_npub = ${memberNpub} THEN w.wrapped_by_npub ELSE NULL END AS wrapped_by_npub,
      w.created_at,
      w.updated_at
    FROM v4_workspaces w
    LEFT JOIN v4_groups dg
      ON dg.id = w.default_group_id
    LEFT JOIN v4_groups pg
      ON pg.owner_npub = w.workspace_owner_npub
     AND pg.group_kind = 'private'
     AND pg.private_member_npub = ${memberNpub}
    LEFT JOIN v4_groups g
      ON g.owner_npub = w.workspace_owner_npub
    LEFT JOIN v4_group_members gm
      ON gm.group_id = g.id
    WHERE w.creator_npub = ${memberNpub}
       OR gm.member_npub = ${memberNpub}
    ORDER BY w.updated_at DESC, w.created_at DESC
  `;

  return workspaces;
}
