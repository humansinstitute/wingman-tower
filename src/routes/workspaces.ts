import { Hono } from 'hono';
import { requireNip98Auth } from '../auth';
import { config } from '../config';
import {
  canManageWorkspace,
  createWorkspace,
  listWorkspacesForMember,
  recoverWorkspace,
  updateWorkspace,
} from '../services/workspaces';
import type { CreateWorkspaceInput, UpdateWorkspaceInput } from '../types';

export const workspacesRouter = new Hono();

function uniqueMembers(memberKeys: { member_npub: string }[]) {
  return new Set((memberKeys || []).map((entry) => String(entry.member_npub || '').trim()).filter(Boolean)).size;
}

workspacesRouter.post('/', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;

  const body = await c.req.json<CreateWorkspaceInput>();
  if (!body.workspace_owner_npub || !body.name || !body.wrapped_workspace_nsec || !body.wrapped_by_npub) {
    return c.json({ error: 'workspace_owner_npub, name, wrapped_workspace_nsec, and wrapped_by_npub required' }, 400);
  }
  if (body.wrapped_by_npub !== authNpub) {
    return c.json({ error: 'wrapped_by_npub must match authenticated npub' }, 403);
  }
  if (!body.default_group_npub || !body.private_group_npub) {
    return c.json({ error: 'default_group_npub and private_group_npub required' }, 400);
  }
  if (!Array.isArray(body.default_group_member_keys) || body.default_group_member_keys.length === 0) {
    return c.json({ error: 'default_group_member_keys required' }, 400);
  }
  if (!Array.isArray(body.private_group_member_keys) || body.private_group_member_keys.length === 0) {
    return c.json({ error: 'private_group_member_keys required' }, 400);
  }
  if (uniqueMembers(body.default_group_member_keys) !== body.default_group_member_keys.length) {
    return c.json({ error: 'default_group_member_keys must contain unique members' }, 400);
  }
  if (uniqueMembers(body.private_group_member_keys) !== body.private_group_member_keys.length) {
    return c.json({ error: 'private_group_member_keys must contain unique members' }, 400);
  }
  if (!body.default_group_member_keys.some((entry) => entry.member_npub === authNpub)) {
    return c.json({ error: 'creator must be present in default_group_member_keys' }, 400);
  }
  if (!body.private_group_member_keys.some((entry) => entry.member_npub === authNpub)) {
    return c.json({ error: 'creator must be present in private_group_member_keys' }, 400);
  }

  try {
    const result = await createWorkspace(body, authNpub);
    return c.json({
      workspace_id: result.workspace.id,
      workspace_owner_npub: result.workspace.workspace_owner_npub,
      creator_npub: result.workspace.creator_npub,
      name: result.workspace.name,
      description: result.workspace.description,
      avatar_url: result.workspace.avatar_url,
      direct_https_url: config.directHttpsUrl,
      default_group_id: result.defaultGroup.id,
      default_group_npub: result.defaultGroup.group_npub,
      private_group_id: result.privateGroup.id,
      private_group_npub: result.privateGroup.group_npub,
      wrapped_workspace_nsec: result.workspace.wrapped_workspace_nsec,
      wrapped_by_npub: result.workspace.wrapped_by_npub,
      created_at: result.workspace.created_at,
      updated_at: result.workspace.updated_at,
    }, 201);
  } catch (error) {
    if (error instanceof Error && /duplicate key value/i.test(error.message)) {
      return c.json({ error: 'workspace or group identity already exists' }, 409);
    }
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create workspace' }, 500);
  }
});

workspacesRouter.get('/', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;

  const memberNpub = c.req.query('member_npub') || c.req.query('npub');
  if (!memberNpub) {
    return c.json({ error: 'member_npub query param required' }, 400);
  }
  if (memberNpub !== authNpub) {
    return c.json({ error: 'member_npub must match authenticated npub' }, 403);
  }

  try {
    const workspaces = await listWorkspacesForMember(memberNpub);
    return c.json({
      workspaces: workspaces.map((workspace) => ({
        ...workspace,
        direct_https_url: config.directHttpsUrl,
      })),
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to list workspaces' }, 500);
  }
});

workspacesRouter.post('/recover', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;

  const body = await c.req.json<{
    workspace_owner_npub: string;
    name: string;
    wrapped_workspace_nsec: string;
    wrapped_by_npub: string;
  }>();

  if (!body.workspace_owner_npub || !body.name || !body.wrapped_workspace_nsec || !body.wrapped_by_npub) {
    return c.json({ error: 'workspace_owner_npub, name, wrapped_workspace_nsec, and wrapped_by_npub required' }, 400);
  }
  if (body.wrapped_by_npub !== authNpub) {
    return c.json({ error: 'wrapped_by_npub must match authenticated npub' }, 403);
  }

  try {
    const workspace = await recoverWorkspace(
      body.workspace_owner_npub,
      authNpub,
      body.name,
      body.wrapped_workspace_nsec,
      body.wrapped_by_npub,
    );

    const workspaces = await listWorkspacesForMember(authNpub);
    const entry = workspaces.find((w) => w.workspace_owner_npub === body.workspace_owner_npub);

    return c.json({
      ...(entry || {}),
      workspace_id: workspace.id,
      workspace_owner_npub: workspace.workspace_owner_npub,
      creator_npub: workspace.creator_npub,
      name: workspace.name,
      direct_https_url: config.directHttpsUrl,
      wrapped_workspace_nsec: workspace.wrapped_workspace_nsec,
      wrapped_by_npub: workspace.wrapped_by_npub,
      created_at: workspace.created_at,
      updated_at: workspace.updated_at,
    }, 201);
  } catch (error) {
    if (error instanceof Error && (error as any).code === 'ALREADY_EXISTS') {
      return c.json({ error: 'workspace already exists' }, 409);
    }
    if (error instanceof Error && (error as any).code === 'NOT_MEMBER') {
      return c.json({ error: 'not a member of any group for this workspace owner' }, 403);
    }
    return c.json({ error: error instanceof Error ? error.message : 'Failed to recover workspace' }, 500);
  }
});

workspacesRouter.patch('/:workspaceOwnerNpub', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;

  const workspaceOwnerNpub = String(c.req.param('workspaceOwnerNpub') || '').trim();
  if (!workspaceOwnerNpub) {
    return c.json({ error: 'workspaceOwnerNpub path param required' }, 400);
  }

  if (!(await canManageWorkspace(workspaceOwnerNpub, authNpub))) {
    return c.json({ error: 'Not authorized to manage this workspace' }, 403);
  }

  const body = await c.req.json<UpdateWorkspaceInput>();
  const hasName = body.name !== undefined;
  const hasDescription = body.description !== undefined;
  const hasAvatarUrl = body.avatar_url !== undefined;
  if (!hasName && !hasDescription && !hasAvatarUrl) {
    return c.json({ error: 'name, description, or avatar_url required' }, 400);
  }

  const nextName = hasName ? String(body.name || '').trim() : undefined;
  if (hasName && !nextName) {
    return c.json({ error: 'name cannot be empty' }, 400);
  }

  const nextDescription = hasDescription ? String(body.description || '').trim() : undefined;
  const nextAvatarUrl = hasAvatarUrl
    ? (body.avatar_url == null ? null : String(body.avatar_url || '').trim() || null)
    : undefined;

  try {
    const updated = await updateWorkspace(workspaceOwnerNpub, {
      name: nextName,
      description: nextDescription,
      avatar_url: nextAvatarUrl,
    });
    if (!updated) {
      return c.json({ error: 'Workspace not found' }, 404);
    }

    const workspaces = await listWorkspacesForMember(authNpub);
    const workspace = workspaces.find((entry) => entry.workspace_owner_npub === workspaceOwnerNpub);
    if (!workspace) {
      return c.json({ error: 'Workspace not visible to actor after update' }, 404);
    }

    return c.json({
      ...workspace,
      direct_https_url: config.directHttpsUrl,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update workspace' }, 500);
  }
});
