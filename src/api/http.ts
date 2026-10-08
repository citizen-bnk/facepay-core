import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { DomainError, type Permission, type Principal } from '../domain/rbac.js';
import type { AppContext } from '../context.js';

export type Env = { Variables: { principal: Principal; app: AppContext } };

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  try {
    return schema.parse(data);
  } catch (e) {
    if (e instanceof ZodError) {
      throw new DomainError(422, 'validation_error', e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
    }
    throw e;
  }
}

export async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new DomainError(400, 'invalid_json', 'Request body must be valid JSON');
  }
}

export function requirePerm(c: Context<Env>, perm: Permission): Principal {
  const p = c.get('principal');
  if (!p) throw new DomainError(401, 'unauthenticated', 'Authentication required');
  if (!p.scopes.includes(perm)) throw new DomainError(403, 'forbidden', `Missing permission ${perm}`);
  return p;
}

export function pageParams(c: Context) {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '25', 10) || 25, 1), 100);
  return { limit, cursor: c.req.query('cursor') };
}

export const encodeCursor = (d: Date, id: string) => Buffer.from(`${d.toISOString()}|${id}`).toString('base64url');
export function decodeCursor(c?: string): { at: Date; id: string } | null {
  if (!c) return null;
  try {
    const [at, id] = Buffer.from(c, 'base64url').toString().split('|');
    const d = new Date(at!);
    if (!id || isNaN(d.getTime())) throw 0;
    return { at: d, id };
  } catch {
    throw new DomainError(400, 'invalid_cursor', 'Invalid cursor');
  }
}
