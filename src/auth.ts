import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { DomainError, isRole, permissionsFor, type Principal, type Role } from './domain/rbac.js';

const ISSUER = 'facepay-core';
const AUDIENCE = 'facepay-api';
const DEV_SECRET = 'dev-only-insecure-secret-change-me-0123456789';

export const TOKEN_TTL_SECONDS = 60 * 60;

function secretKey(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === 'production') throw new DomainError(503, 'server_misconfigured', 'JWT_SECRET is not configured');
    return new TextEncoder().encode(DEV_SECRET);
  }
  if (s.length < 32 && process.env.NODE_ENV === 'production') throw new DomainError(503, 'server_misconfigured', 'JWT_SECRET must be at least 32 characters');
  return new TextEncoder().encode(s);
}

export async function signToken(user: { id: string; role: Role; tenantId: string }): Promise<string> {
  return new SignJWT({ role: user.role, tid: user.tenantId, scope: permissionsFor(user.role).join(' ') })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyToken(token: string): Promise<Principal> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
    const role = String(payload.role);
    if (!payload.sub || !isRole(role) || typeof payload.tid !== 'string') throw new Error('bad claims');
    return { id: payload.sub, role, tenantId: payload.tid, scopes: String(payload.scope ?? '').split(' ').filter(Boolean) };
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError(401, 'invalid_token', 'Missing, invalid or expired token');
  }
}

// A real bcrypt hash used to keep login timing uniform when the user does not exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
export async function checkPassword(password: string, hash: string | undefined): Promise<boolean> {
  const ok = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return !!hash && ok;
}
