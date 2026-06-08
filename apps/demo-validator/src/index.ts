// Local Node server (standalone). Vercel uses api/index.ts instead.
import { serve } from '@hono/node-server';
import app from './app.js';

const port = Number(process.env.PORT ?? 8792);
serve({ fetch: app.fetch, port });
console.log(`demo-validator listening on :${port}`);
