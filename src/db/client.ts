import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as schema from './schema.js';

export type Db = PgDatabase<any, typeof schema>;
export { schema };

export interface DbHandle {
  db: Db;
  driver: 'pglite' | 'pg' | 'neon';
  close(): Promise<void>;
}

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/** Postgres when DATABASE_URL is set (node-postgres, or Neon serverless with DB_DRIVER=neon); PGlite otherwise. */
export async function createDb(opts: { url?: string | null; dataDir?: string } = {}): Promise<DbHandle> {
  const url = opts.url === undefined ? process.env.DATABASE_URL : opts.url;
  if (url) {
    if (process.env.DB_DRIVER === 'neon') {
      const { Pool, neonConfig } = await import('@neondatabase/serverless');
      if (typeof WebSocket !== 'undefined') neonConfig.webSocketConstructor = WebSocket;
      const { drizzle } = await import('drizzle-orm/neon-serverless');
      const pool = new Pool({ connectionString: url });
      return { db: drizzle(pool, { schema }) as unknown as Db, driver: 'neon', close: () => pool.end() };
    }
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 5)});
    return { db: drizzlePg(pool, { schema }) as unknown as Db, driver: 'pg', close: () => pool.end() };
  }
  const client = new PGlite(opts.dataDir ?? process.env.PGLITE_DIR ?? undefined);
  return { db: drizzlePglite(client, { schema }) as unknown as Db, driver: 'pglite', close: () => client.close() };
}

export async function runMigrations(h: DbHandle): Promise<void> {
  if (h.driver === 'pglite') await migratePglite(h.db as any, { migrationsFolder });
  else await migratePg(h.db as any, { migrationsFolder });
}
