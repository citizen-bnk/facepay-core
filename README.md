# facepay-core

FACE YOUR MONEY. The FacePay API, domain logic and database layer: TypeScript, Hono, Drizzle ORM and Postgres, deployable on Vercel.

- API base: `/v1` (OpenAPI at `/v1/openapi.json`, docs page at `/`)
- Typed client: [`packages/sdk`](packages/sdk) (`@facepay/sdk`)
- Money is integers in minor units (ZAR cents). Wallet balances are sourced from the payment provider. A payment is never `captured` or `paid` until the provider confirms it. No raw biometrics are stored or exposed (only opaque vendor references).

## Quick start

```bash
npm install
npm run dev            # http://localhost:8787, in-memory PGlite, demo data seeded
npm test               # vitest (spec section 16 acceptance cases)
npm run typecheck
```

Smoke test:

```bash
TOKEN=$(curl -s -X POST localhost:8787/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"thabo@facepay.demo","password":"facepay-demo"}' | jq -r .token)
curl -s localhost:8787/v1/wallet -H "authorization: Bearer $TOKEN"
```

Demo users (password `facepay-demo`): `thabo@facepay.demo` (customer), `owner@abcstore.demo` (merchant owner), `cashier@abcstore.demo` (merchant cashier), `ops@facepay.demo` (support agent), `super@facepay.demo` (super user), `auditor@facepay.demo` (auditor), plus `finance@`, `kyc@`, `tech@`, `integrations@facepay.demo` and `owner@capecoffee.demo` (a second tenant for isolation checks).

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (Neon pooled string works). Unset: in-memory PGlite for local, dev and tests. |
| `JWT_SECRET` | HS256 signing secret, 32+ chars. Required when `NODE_ENV=production` (the API answers 503 without it). |
| `ALLOWED_ORIGINS` | Comma-separated CORS allow-list, e.g. `https://facepay.com,https://app.facepay.com,https://portal.facepay.com`. Unset: only localhost in non-production, nothing in production. |
| `AUTO_MIGRATE` | `false` to skip migrations at boot (default runs them). |
| `AUTO_SEED` | `false` to skip demo data seeding (default seeds an empty database). Set to `false` for real production data. |
| `DB_DRIVER` | `neon` to use the Neon serverless driver (WebSocket) instead of node-postgres. |
| `DB_POOL_MAX` | node-postgres pool size (default 5). |
| `PGLITE_DIR` | Persist PGlite to a directory instead of memory. |
| `REFUND_APPROVAL_THRESHOLD_MINOR` | Refunds at or above this need a distinct checker (default 500000 = R 5,000.00). |
| `CASHIER_REFUND_LIMIT_MINOR` | Cashier self-service refund limit (default 50000 = R 500.00). |
| `PORT` | Local server port (default 8787). |

Database commands: `npm run db:generate` (new migration from `src/db/schema.ts`), `npm run db:migrate`, `npm run db:seed [-- --force]`.

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel (framework preset: Other). `vercel.json` routes every path to the `api/index.ts` serverless function and bundles `drizzle/**` migrations.
2. Set `DATABASE_URL`, `JWT_SECRET` (`openssl rand -hex 32`) and `ALLOWED_ORIGINS` for Production and Preview.
3. Deploy. Migrations run on first request. Demo data is seeded only into an empty database; set `AUTO_SEED=false` once you hold real data.
4. Check `https://<deployment>/v1/health` and `https://<deployment>/v1/openapi.json`.

Without `DATABASE_URL` the function falls back to in-memory PGlite, which resets per instance. Use that only for demos.

### Neon setup

1. Create a project at neon.tech and copy the pooled connection string (`...-pooler...neon.tech/db?sslmode=require`).
2. Set it as `DATABASE_URL` in Vercel. node-postgres over the pooled endpoint is the default. Set `DB_DRIVER=neon` to use the serverless WebSocket driver.
3. Optional: run `DATABASE_URL=... npm run db:migrate` locally before the first deploy.

### Domain: api.facepay.com

In Vercel, Project, Settings, Domains, add `api.facepay.com`, then create the DNS record Vercel shows (CNAME `api` to `cname.vercel-dns.com`, or an A record for apex use). Front-ends (website facepay.com / facepay.africa, app.facepay.com, portal.facepay.com) call it via `NEXT_PUBLIC_API_URL` / `EXPO_PUBLIC_API_URL` set to `https://api.facepay.com`, and each origin must be listed in `ALLOWED_ORIGINS`.

## Layout

```
api/index.ts          Vercel serverless entry
src/api/              Hono app, routes, OpenAPI, docs page, idempotency, CORS
src/domain/           payment-intent state machine, refund maker/checker, consent, reconciliation, RBAC, audit chain
src/db/               Drizzle schema, migrations runner, PGlite/pg/neon client, seed
src/providers/        payment + biometric interfaces and mock adapters
src/services/         orchestration (payments, refunds, audit)
src/auth.ts           JWT (jose) and password checks (bcrypt)
packages/sdk/         @facepay/sdk typed fetch client
drizzle/              generated SQL migrations
tests/                vitest suites
```

## Behaviour notes

- Roles: the 10 roles of spec section 3 (customer, merchant owner, merchant cashier, support agent, KYC/risk analyst, finance operator, device technician, integration operator, super user, auditor). Tokens carry the permission scopes; `GET /v1/roles` returns the matrix. No role has raw biometric access, and `GET /v1/customers/{id}/biometric-media` always answers 403 and is audited.
- Tenant isolation: tenant-scoped roles only see rows of their own tenant; customers only their own. Cross-tenant reads return 404, cross-tenant writes with an explicit foreign merchant id return 403.
- Idempotency: `POST /v1/payment-intents` requires `Idempotency-Key`. Same key and body replays the stored response (`Idempotent-Replayed: true`); same key with a different body is 422. Refund, device and webhook POSTs accept the header too. Confirm is duplicate-safe via compare-and-set state transitions.
- Mock provider magic amounts (minor units, sandbox only): `%1000 == 999` declined, `998` provider timeout (stays `processing`), `997` authorised but capture unconfirmed (stays `authorised`). Insufficient funds declines.
- Refunds: amounts at or above the threshold (and cashier refunds above the cashier limit) go to `pending_approval` and need a different approver. Approve and reject are audited.
- Audit events are hash-chained (`prevHash`, `hash`) and a database trigger rejects UPDATE and DELETE. `GET /v1/audit-events` includes chain verification.
- Rate limiting is an in-memory best effort per instance; put a Vercel firewall rule in front for production.
- Login tokens last one hour; there is no refresh or revocation list yet. Privileged-user MFA/passkeys (spec section 10) are not implemented in this demo.

## SDK

```ts
import { createClient } from '@facepay/sdk';
const api = createClient({ baseUrl: 'https://api.facepay.com' });
await api.login('thabo@facepay.demo', 'facepay-demo');
const wallet = await api.wallet();
```

Build with `npm run build:sdk`; publish `packages/sdk` to your registry.
