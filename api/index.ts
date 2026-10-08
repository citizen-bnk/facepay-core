import { handle } from '@hono/node-server/vercel';
import { createApp } from '../src/api/app.js';

export const config = { runtime: 'nodejs' };

const app = createApp();
// Standalone Vercel Node functions use IncomingMessage/ServerResponse,
// rather than the Web Request handlers used by Next.js App Router.
export default handle(app);
