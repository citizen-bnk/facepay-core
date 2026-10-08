import { handle } from 'hono/vercel';
import { createApp } from '../src/api/app';

export const config = { runtime: 'nodejs' };

const app = createApp();
const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
