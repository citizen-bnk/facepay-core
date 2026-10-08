import { handle } from '@hono/node-server/vercel';
import { createApp } from '../src/api/app';

export const config = { runtime: 'nodejs' };

const app = createApp();
// Standalone Vercel Node functions receive IncomingMessage/ServerResponse.
export default handle(app);
