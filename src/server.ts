import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config';
import { buildDocsHtml, buildOpenApiDocument, buildTableViewerHtml } from './openapi';
import { adminRouter } from './routes/admin';
import { groupsRouter } from './routes/groups';
import { recordsRouter } from './routes/records';
import { storageRouter } from './routes/storage';
import { workspacesRouter } from './routes/workspaces';

export function createApp() {
  const app = new Hono();

  app.use('*', cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }));

  app.get('/health', (c) => c.json({ status: 'ok', service_npub: config.service.npub || null }));
  app.get('/openapi.json', (c) => {
    const origin = new URL(c.req.url).origin;
    return c.json(buildOpenApiDocument(origin));
  });
  app.get('/docs', (c) => {
    const origin = new URL(c.req.url).origin;
    return c.html(buildDocsHtml(origin));
  });
  app.get('/table-viewer', (c) => {
    const origin = new URL(c.req.url).origin;
    return c.html(buildTableViewerHtml(origin));
  });

  app.route('/api/v4/groups', groupsRouter);
  app.route('/api/v4/workspaces', workspacesRouter);
  app.route('/api/v4/records', recordsRouter);
  app.route('/api/v4/storage', storageRouter);
  app.route('/api/v4/admin', adminRouter);

  return app;
}
