import { Hono } from 'hono';
import { requireNip98Auth, requireNip98AuthResolved } from '../auth';
import {
  ensureUserProfile,
  registerWorkspaceKey,
  listWorkspaceKeys,
  rotateWorkspaceKey,
  getWorkspaceKeyMappings,
} from '../services/user-workspace-keys';
import { listWorkspacesForMember } from '../services/workspaces';
import type { RegisterWorkspaceKeyInput, RotateWorkspaceKeyInput } from '../types';

export const userRouter = new Hono();

// POST /api/v4/user/workspace-keys — register a workspace session key
// Intentionally uses requireNip98Auth (not Resolved) — registration must be
// signed by the real user npub. A workspace key cannot register itself.
userRouter.post('/workspace-keys', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;

  const body = await c.req.json<RegisterWorkspaceKeyInput>();

  if (!body.workspace_owner_npub || !body.ws_key_npub) {
    return c.json({ error: 'workspace_owner_npub and ws_key_npub required' }, 400);
  }

  // Verify user has access to the workspace
  const workspaces = await listWorkspacesForMember(authNpub);
  const hasAccess = workspaces.some(
    (w) => w.workspace_owner_npub === body.workspace_owner_npub,
  );
  if (!hasAccess) {
    return c.json({ error: 'user does not have access to this workspace' }, 403);
  }

  try {
    await ensureUserProfile(authNpub);
    const key = await registerWorkspaceKey(
      authNpub,
      body.workspace_owner_npub,
      body.ws_key_npub,
    );
    return c.json({
      workspace_owner_npub: key.workspace_owner_npub,
      ws_key_npub: key.ws_key_npub,
      ws_key_epoch: key.ws_key_epoch,
      active: key.active,
    }, 201);
  } catch (err: any) {
    if (err.code === 'KEY_CONFLICT') {
      return c.json({ error: err.message }, 409);
    }
    throw err;
  }
});

// GET /api/v4/user/workspace-keys — list workspace keys for the authenticated user
userRouter.get('/workspace-keys', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;

  const keys = await listWorkspaceKeys(authNpub);
  return c.json({ keys });
});

// POST /api/v4/user/workspace-keys/rotate — rotate a workspace session key
// Intentionally requires the real user signer — rotation is a privileged
// operation. The user must re-engage their extension/bunker signer to rotate.
userRouter.post('/workspace-keys/rotate', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;

  const body = await c.req.json<RotateWorkspaceKeyInput>();

  if (!body.workspace_owner_npub || !body.new_ws_key_npub || !body.old_ws_key_npub) {
    return c.json(
      { error: 'workspace_owner_npub, new_ws_key_npub, and old_ws_key_npub required' },
      400,
    );
  }

  try {
    await ensureUserProfile(authNpub);
    const key = await rotateWorkspaceKey(
      authNpub,
      body.workspace_owner_npub,
      body.new_ws_key_npub,
      body.old_ws_key_npub,
    );
    return c.json({
      workspace_owner_npub: key.workspace_owner_npub,
      ws_key_npub: key.ws_key_npub,
      ws_key_epoch: key.ws_key_epoch,
      active: key.active,
    });
  } catch (err: any) {
    if (err.code === 'NOT_FOUND') {
      return c.json({ error: err.message }, 404);
    }
    if (err.code === 'KEY_CONFLICT') {
      return c.json({ error: err.message }, 409);
    }
    throw err;
  }
});

// GET /api/v4/user/workspace-key-mappings?workspace_owner_npub=<npub>
// Returns ws_key_npub → user_npub mappings for display resolution.
// Accepts workspace key auth so clients can call this after bootstrap.
userRouter.get('/workspace-key-mappings', async (c) => {
  const auth = await requireNip98AuthResolved(c);
  if (auth instanceof Response) return auth;

  const workspaceOwnerNpub = c.req.query('workspace_owner_npub');
  if (!workspaceOwnerNpub) {
    return c.json({ error: 'workspace_owner_npub query param required' }, 400);
  }

  const mappings = await getWorkspaceKeyMappings(workspaceOwnerNpub);
  return c.json({ mappings });
});
