import { createHash } from 'crypto';
import { nip19, verifyEvent } from 'nostr-tools';
import type { Context } from 'hono';
import { resolveWsKeyNpub } from './services/user-workspace-keys';

const NIP98_KIND = 27235;
const MAX_EVENT_AGE_SECONDS = 300;

function normalizePathname(value: string): string {
  const normalized = value.replace(/\/+$/, '');
  return normalized || '/';
}

function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  return value.split(',')[0]?.trim() || null;
}

function parseCfVisitorScheme(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed?.scheme === 'string' ? parsed.scheme : null;
  } catch {
    return null;
  }
}

function getEffectiveUrl(request: Request): URL {
  const requestUrl = new URL(request.url);

  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'));
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'));

  if (forwardedProto && forwardedHost) {
    return new URL(`${forwardedProto}://${forwardedHost}${requestUrl.pathname}${requestUrl.search}`);
  }

  const host = firstHeaderValue(request.headers.get('host'));
  const cfVisitorScheme = parseCfVisitorScheme(firstHeaderValue(request.headers.get('cf-visitor')));
  const scheme = forwardedProto || cfVisitorScheme || requestUrl.protocol.replace(':', '');

  if (host) {
    return new URL(`${scheme}://${host}${requestUrl.pathname}${requestUrl.search}`);
  }

  return requestUrl;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

type Nip98VerificationInput = {
  authHeader: string | null;
  request: Request;
  rawBody?: string | null;
  overridePayloadHash?: string | null;
};

async function verifyNip98Token({
  authHeader,
  request,
  rawBody,
  overridePayloadHash = null,
}: Nip98VerificationInput): Promise<string | null> {
  if (!authHeader?.startsWith('Nostr ')) return null;
  try {
    const token = authHeader.slice(6).trim();
    const event = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));

    if (!verifyEvent(event)) return null;
    if (event.kind !== NIP98_KIND) return null;

    const effectiveUrl = getEffectiveUrl(request);
    const uTag = event.tags?.find((tag: string[]) => tag[0] === 'u');
    if (!uTag?.[1]) return null;

    const eventUrl = new URL(uTag[1]);
    if (
      eventUrl.origin !== effectiveUrl.origin ||
      normalizePathname(eventUrl.pathname) !== normalizePathname(effectiveUrl.pathname)
    ) {
      return null;
    }

    const methodTag = event.tags?.find((tag: string[]) => tag[0] === 'method');
    if (!methodTag?.[1] || methodTag[1].toUpperCase() !== request.method.toUpperCase()) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(event.created_at)) > MAX_EVENT_AGE_SECONDS) {
      return null;
    }

    const needsPayloadHash = ['POST', 'PUT', 'PATCH'].includes(request.method.toUpperCase());
    const payloadTag = event.tags?.find((tag: string[]) => tag[0] === 'payload');
    if (needsPayloadHash) {
      const effectiveBody = overridePayloadHash
        ? null
        : (rawBody ?? await request.clone().text());
      const expectedHash = overridePayloadHash || sha256Hex(effectiveBody || '');
      if (!payloadTag?.[1] || expectedHash !== payloadTag[1]) {
        return null;
      }
    }

    return nip19.npubEncode(event.pubkey);
  } catch {
    return null;
  }
}

export async function verifyNip98Auth(request: Request): Promise<string | null> {
  return verifyNip98Token({
    authHeader: request.headers.get('authorization'),
    request,
  });
}

export async function verifyNip98AuthHeader(
  authHeader: string | null,
  request: Request,
  options: { rawBody?: string | null; overridePayloadHash?: string | null } = {},
): Promise<string | null> {
  return verifyNip98Token({
    authHeader,
    request,
    rawBody: options.rawBody,
    overridePayloadHash: options.overridePayloadHash ?? null,
  });
}

export async function requireNip98Auth(c: Context): Promise<string | Response> {
  const npub = await verifyNip98Auth(c.req.raw);
  if (!npub) {
    return c.json({ error: 'nip98 auth required' }, 401);
  }
  return npub;
}

/**
 * Resolved auth identity. signerNpub is the NIP-98 event signer.
 * userNpub is the real user identity — same as signerNpub for direct auth,
 * or the resolved real npub when the signer is a workspace session key.
 */
export interface ResolvedAuth {
  signerNpub: string;
  userNpub: string;
}

/**
 * NIP-98 auth with workspace session key resolution.
 *
 * 1. Verify NIP-98 signature → signerNpub
 * 2. Check: is signerNpub a registered ws_key_npub? → resolve to real userNpub
 * 3. Otherwise: signerNpub === userNpub (backward compat)
 */
export async function requireNip98AuthResolved(c: Context): Promise<ResolvedAuth | Response> {
  const signerNpub = await verifyNip98Auth(c.req.raw);
  if (!signerNpub) {
    return c.json({ error: 'nip98 auth required' }, 401);
  }

  const resolvedUserNpub = await resolveWsKeyNpub(signerNpub);
  return {
    signerNpub,
    userNpub: resolvedUserNpub ?? signerNpub,
  };
}
