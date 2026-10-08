import { serve } from '@hono/node-server';
import { createApp } from './api/app';
import { getContext } from './context';

const port = Number(process.env.PORT ?? 8787);
await getContext(); // migrate + seed up front so the first request is fast
serve({ fetch: createApp().fetch, port }, (i) => console.log(`facepay-core listening on http://localhost:${i.port}`));
