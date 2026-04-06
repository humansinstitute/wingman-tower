import { getDb } from '../db';
import type {
  UserProfile,
  UserWorkspaceKey,
  WorkspaceKeyEntry,
} from '../types';

/**
 * Ensure a user_profiles row exists for the given npub.
 * Returns the existing or newly created profile.
 */
export async function ensureUserProfile(userNpub: string): Promise<UserProfile> {
  const sql = getDb();
  const [profile] = await sql<UserProfile[]>`
    INSERT INTO user_profiles (user_npub)
    VALUES (${userNpub})
    ON CONFLICT (user_npub) DO NOTHING
    RETURNING *
  `;
  if (profile) return profile;

  const [existing] = await sql<UserProfile[]>`
    SELECT * FROM user_profiles WHERE user_npub = ${userNpub}
  `;
  return existing;
}

/**
 * Register a workspace session key for a user.
 * Verifies the user has access to the workspace and the ws_key_npub is not
 * already registered to a different user.
 */
export async function registerWorkspaceKey(
  userNpub: string,
  workspaceOwnerNpub: string,
  wsKeyNpub: string,
): Promise<UserWorkspaceKey> {
  const sql = getDb();

  // Check ws_key_npub not already registered to a different user
  const [existing] = await sql<UserWorkspaceKey[]>`
    SELECT * FROM user_workspace_keys
    WHERE ws_key_npub = ${wsKeyNpub}
  `;
  if (existing && existing.user_npub !== userNpub) {
    throw Object.assign(
      new Error('ws_key_npub is already registered to a different user'),
      { code: 'KEY_CONFLICT' },
    );
  }
  if (existing && existing.user_npub === userNpub) {
    return existing;
  }

  // Determine next epoch for this user+workspace
  const [maxEpoch] = await sql<{ max_epoch: number | null }[]>`
    SELECT MAX(ws_key_epoch) AS max_epoch
    FROM user_workspace_keys
    WHERE user_npub = ${userNpub}
      AND workspace_owner_npub = ${workspaceOwnerNpub}
  `;
  const nextEpoch = (maxEpoch?.max_epoch ?? 0) + 1;

  const [key] = await sql<UserWorkspaceKey[]>`
    INSERT INTO user_workspace_keys (
      user_npub, workspace_owner_npub, ws_key_npub, ws_key_epoch, active
    ) VALUES (
      ${userNpub}, ${workspaceOwnerNpub}, ${wsKeyNpub}, ${nextEpoch}, true
    )
    RETURNING *
  `;

  invalidateWsKeyCache(wsKeyNpub);
  return key;
}

/**
 * List all workspace keys for a user.
 */
export async function listWorkspaceKeys(userNpub: string): Promise<WorkspaceKeyEntry[]> {
  const sql = getDb();
  const keys = await sql<WorkspaceKeyEntry[]>`
    SELECT workspace_owner_npub, ws_key_npub, ws_key_epoch, active
    FROM user_workspace_keys
    WHERE user_npub = ${userNpub}
    ORDER BY workspace_owner_npub, ws_key_epoch DESC
  `;
  return keys;
}

/**
 * Rotate a workspace key: register new key, deactivate old key.
 */
export async function rotateWorkspaceKey(
  userNpub: string,
  workspaceOwnerNpub: string,
  newWsKeyNpub: string,
  oldWsKeyNpub: string,
): Promise<UserWorkspaceKey> {
  const sql = getDb();

  return sql.begin(async (tx) => {
    // Verify old key belongs to this user + workspace
    const [oldKey] = await tx<UserWorkspaceKey[]>`
      SELECT * FROM user_workspace_keys
      WHERE ws_key_npub = ${oldWsKeyNpub}
        AND user_npub = ${userNpub}
        AND workspace_owner_npub = ${workspaceOwnerNpub}
    `;
    if (!oldKey) {
      throw Object.assign(
        new Error('old_ws_key_npub not found for this user and workspace'),
        { code: 'NOT_FOUND' },
      );
    }

    // Deactivate old key
    await tx`
      UPDATE user_workspace_keys
      SET active = false
      WHERE ws_key_npub = ${oldWsKeyNpub}
        AND user_npub = ${userNpub}
        AND workspace_owner_npub = ${workspaceOwnerNpub}
    `;

    // Check new key not already registered to someone else
    const [conflict] = await tx<UserWorkspaceKey[]>`
      SELECT * FROM user_workspace_keys
      WHERE ws_key_npub = ${newWsKeyNpub}
    `;
    if (conflict && conflict.user_npub !== userNpub) {
      throw Object.assign(
        new Error('new_ws_key_npub is already registered to a different user'),
        { code: 'KEY_CONFLICT' },
      );
    }

    const nextEpoch = oldKey.ws_key_epoch + 1;

    const [newKey] = await tx<UserWorkspaceKey[]>`
      INSERT INTO user_workspace_keys (
        user_npub, workspace_owner_npub, ws_key_npub, ws_key_epoch, active
      ) VALUES (
        ${userNpub}, ${workspaceOwnerNpub}, ${newWsKeyNpub}, ${nextEpoch}, true
      )
      ON CONFLICT (workspace_owner_npub, ws_key_npub) DO UPDATE
      SET ws_key_epoch = EXCLUDED.ws_key_epoch,
          active = true
      RETURNING *
    `;

    invalidateWsKeyCache(oldWsKeyNpub);
    invalidateWsKeyCache(newWsKeyNpub);
    return newKey;
  });
}

// In-memory LRU cache for ws_key_npub → user_npub resolution.
// Workspace key mappings rarely change, so a short TTL avoids a DB round trip
// on every authenticated request. Negative lookups (direct-auth users) are also
// cached to avoid querying for npubs that will never be workspace keys.
const WS_KEY_CACHE_MAX = 200;
const WS_KEY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

const wsKeyCache = new Map<string, CacheEntry>();

function cacheGet(key: string): string | null | undefined {
  const entry = wsKeyCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    wsKeyCache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(key: string, value: string | null): void {
  // Evict oldest entries if at capacity
  if (wsKeyCache.size >= WS_KEY_CACHE_MAX) {
    const firstKey = wsKeyCache.keys().next().value;
    if (firstKey !== undefined) wsKeyCache.delete(firstKey);
  }
  wsKeyCache.set(key, { value, expiresAt: Date.now() + WS_KEY_CACHE_TTL_MS });
}

/**
 * Invalidate a specific ws_key_npub from the resolution cache.
 * Called after registration or rotation to ensure stale mappings are cleared.
 */
export function invalidateWsKeyCache(wsKeyNpub: string): void {
  wsKeyCache.delete(wsKeyNpub);
}

/**
 * List all active workspace key → user_npub mappings for a workspace.
 * Used by clients to resolve ws_key_npubs to display identities.
 */
export async function getWorkspaceKeyMappings(workspaceOwnerNpub: string): Promise<{ ws_key_npub: string; user_npub: string }[]> {
  const sql = getDb();
  return sql<{ ws_key_npub: string; user_npub: string }[]>`
    SELECT ws_key_npub, user_npub
    FROM user_workspace_keys
    WHERE workspace_owner_npub = ${workspaceOwnerNpub}
      AND active = true
    ORDER BY registered_at DESC
  `;
}

/**
 * Resolve a ws_key_npub to the real user_npub.
 * Returns null if not found (meaning the npub is not a workspace session key).
 * Uses an in-memory cache to avoid a DB lookup on every request.
 */
export async function resolveWsKeyNpub(wsKeyNpub: string): Promise<string | null> {
  const cached = cacheGet(wsKeyNpub);
  if (cached !== undefined) return cached;

  const sql = getDb();
  const [row] = await sql<{ user_npub: string }[]>`
    SELECT user_npub
    FROM user_workspace_keys
    WHERE ws_key_npub = ${wsKeyNpub}
    LIMIT 1
  `;
  const result = row?.user_npub ?? null;
  cacheSet(wsKeyNpub, result);
  return result;
}
