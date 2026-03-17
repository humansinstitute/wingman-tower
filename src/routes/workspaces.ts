import { Hono } from 'hono';
import { requireNip98Auth } from '../auth';
import { config } from '../config';
import { createWorkspace, listWorkspacesForMember } from '../services/workspaces';
import type { CreateWorkspaceInput } from '../types';

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
