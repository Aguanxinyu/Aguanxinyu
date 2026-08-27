/**
 * Local memory-backed API for Web SPA development / manual testing.
 * Usage: node --import tsx packages/backend/scripts/dev-memory-server.ts
 * Or after build: node packages/backend/dist/../scripts — prefer tsx via npx.
 */
import { createServer } from 'node:http';

import {
  ApiService,
  MemoryDatabase,
  createFakeWeChatIdentityResolver,
  startServer
} from '../src/index.js';

const port = Number(process.env.PORT ?? '8080');
const database = new MemoryDatabase();
const api = new ApiService({
  database,
  now: () => Date.now(),
  resolveWeChatIdentity: createFakeWeChatIdentityResolver()
});

const server = startServer({
  api,
  port,
  logger: (message) => {
    console.log(message);
  }
});

console.log(`[dev-memory] listening on http://127.0.0.1:${String(port)} with FAKE wechat login`);
