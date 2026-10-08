import { eq, sql } from 'drizzle-orm';
import { createDb, runMigrations, type Db, type DbHandle } from './db/client.js';
import { providerAccounts } from './db/schema.js';
import { seed } from './db/seed.js';
import { createMockProviders } from './providers/mock.js';
import type { Providers } from './providers/types.js';

export interface AppContext {
  db: Db;
  providers: Providers;
  close?: () => Promise<void>;
}

export function providersFor(db: Db): Providers {
  return createMockProviders({
    async balance(holderId) {
      const [r] = await db.select().from(providerAccounts).where(eq(providerAccounts.holderId, holderId));
      return r?.availableBalanceMinor ?? 0;
    },
    async adjust(holderId, delta) {
      await db.update(providerAccounts).set({ availableBalanceMinor: sql`${providerAccounts.availableBalanceMinor} + ${delta}`, asOf: new Date() }).where(eq(providerAccounts.holderId, holderId));
    },
  });
}

export async function createContext(opts: { url?: string | null; seedDemo?: boolean } = {}): Promise<AppContext> {
  const h: DbHandle = await createDb({ url: opts.url });
  if (process.env.AUTO_MIGRATE !== 'false') await runMigrations(h);
  if (opts.seedDemo ?? process.env.AUTO_SEED !== 'false') await seed(h.db);
  return { db: h.db, providers: providersFor(h.db), close: h.close };
}

let shared: Promise<AppContext> | undefined;
/** Process-wide context (one per serverless instance). Migrates, and seeds demo data unless AUTO_SEED=false. */
export function getContext(): Promise<AppContext> {
  shared ??= createContext().catch((e) => {
    shared = undefined;
    throw e;
  });
  return shared;
}
