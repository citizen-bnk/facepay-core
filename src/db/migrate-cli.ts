import { createDb, runMigrations } from './client.js';

const h = await createDb();
await runMigrations(h);
console.log(`migrations applied (${h.driver})`);
await h.close();
