import { createDb, runMigrations } from './client';

const h = await createDb();
await runMigrations(h);
console.log(`migrations applied (${h.driver})`);
await h.close();
