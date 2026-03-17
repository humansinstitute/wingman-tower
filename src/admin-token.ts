import { Buffer } from 'node:buffer';

export interface AdminWorkspaceConnectionInput {
  directHttpsUrl: string;
  serviceNpub?: string | null;
  workspaceOwnerNpub: string;
  appNpub: string;
  relayUrls?: string[];
}

function encodeBase64Json(value: unknown) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

export function buildSuperBasedConnectionToken({
  directHttpsUrl,
  serviceNpub,
  workspaceOwnerNpub,
  appNpub,
  relayUrls = [],
}: AdminWorkspaceConnectionInput) {
  const payload: Record<string, unknown> = {
    type: 'superbased_connection',
    version: 2,
    direct_https_url: String(directHttpsUrl || '').trim(),
    workspace_owner_npub: String(workspaceOwnerNpub || '').trim(),
    app_npub: String(appNpub || '').trim(),
  };

  const normalizedServiceNpub = String(serviceNpub || '').trim();
  if (normalizedServiceNpub) payload.service_npub = normalizedServiceNpub;

  const normalizedRelays = Array.isArray(relayUrls)
    ? relayUrls.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (normalizedRelays.length === 1) payload.relay = normalizedRelays[0];
  if (normalizedRelays.length > 1) payload.relays = normalizedRelays;

  return encodeBase64Json(payload);
}

export function buildAdminAgentConnectPackage({
  directHttpsUrl,
  serviceNpub,
  workspaceOwnerNpub,
  appNpub,
  relayUrls = [],
}: AdminWorkspaceConnectionInput) {
  const token = buildSuperBasedConnectionToken({
    directHttpsUrl,
    serviceNpub,
    workspaceOwnerNpub,
    appNpub,
    relayUrls,
  });

  return {
    kind: 'coworker_agent_connect',
    version: 4,
    generated_at: new Date().toISOString(),
    service: {
      direct_https_url: directHttpsUrl,
      service_npub: serviceNpub || null,
      relay_urls: relayUrls,
    },
    workspace: {
      owner_npub: workspaceOwnerNpub,
    },
    app: {
      app_npub: appNpub,
    },
    connection_token: token,
  };
}
