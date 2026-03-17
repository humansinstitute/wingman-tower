import { describe, expect, test } from 'bun:test';
import { createApp } from '../src/server';

describe('OpenAPI docs', () => {
  const app = createApp();

  test('GET /openapi.json exposes the API spec', async () => {
    const res = await app.request('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = await res.json();
    expect(body.openapi).toBe('3.1.0');
    expect(body.info.title).toBe('SuperBased V4 API');
    expect(body.paths['/api/v4/records/sync']).toBeDefined();
    expect(body.paths['/api/v4/groups']).toBeDefined();
    expect(body.paths['/api/v4/groups/keys']).toBeDefined();
    expect(body.paths['/api/v4/groups'].get.parameters[0].name).toBe('npub');
    expect(body.components.schemas.WrappedKeyEntry.required).toContain('name');
  });

  test('GET /docs exposes a docs page', async () => {
    const res = await app.request('/docs');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');

    const html = await res.text();
    expect(html).toContain('SwaggerUIBundle');
    expect(html).toContain('/openapi.json');
  });
});
