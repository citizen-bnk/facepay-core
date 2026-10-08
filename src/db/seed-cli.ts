import { createDb, runMigrations } from './client';
import { seed } from './seed';

const h = await createDb();
await runMigrations(h);
const r = await seed(h.db, { force: process.argv.includes('--force') });
console.log(r.seeded ? 'seeded demo data' : 'already seeded');
await h.close();
