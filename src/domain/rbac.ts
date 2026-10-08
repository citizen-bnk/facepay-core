/** RBAC permission matrix for the roles in spec section 3, plus tenant isolation. */
export const ROLES = [
  'customer',
  'merchant_owner',
  'merchant_cashier',
  'support_agent',
  'kyc_risk_analyst',
  'finance_operator',
  'device_technician',
  'integration_operator',
  'super_user',
  'auditor',
] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'wallet:read',
  'transactions:read',
  'payment_intents:create',
  'payment_intents:read',
  'payment_intents:confirm',
  'verification:create',
  'refunds:create',
  'refunds:read',
  'refunds:approve',
  'settlements:read',
  'devices:read',
  'devices:enrol',
  'merchants:read',
  'customers:read',
  'consents:read',
  'consents:revoke',
  'admin:overview',
  'merchant:dashboard',
  'roles:read',
  'approvals:read',
  'approvals:decide',
  'audit:read',
  'integrations:read',
  'webhooks:write',
  /** Raw biometric media/templates. Deliberately granted to NO role. */
  'biometrics:read_raw',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** own = rows owned by the user; tenant = rows of the user's tenant; platform = all tenants. */
export type DataScope = 'own' | 'tenant' | 'platform';

export interface RoleDefinition {
  role: Role;
  label: string;
  description: string;
  restrictions: string;
  scope: DataScope;
  permissions: readonly Permission[];
}

export const ROLE_MATRIX: Record<Role, RoleDefinition> = {
  customer: {
    role: 'customer',
    label: 'Customer',
    description: 'View own linked accounts, methods, history, disputes; request transactions',
    restrictions: 'Only own tenant and permitted accounts',
    scope: 'own',
    permissions: ['wallet:read', 'transactions:read', 'consents:read', 'consents:revoke', 'refunds:read', 'verification:create', 'payment_intents:read'],
  },
  merchant_owner: {
    role: 'merchant_owner',
    label: 'Merchant owner',
    description: 'Merchant reports, refunds within limits, employees, devices, invoices',
    restrictions: 'Own merchant; sensitive financial actions gated',
    scope: 'tenant',
    permissions: [
      'transactions:read', 'payment_intents:create', 'payment_intents:read', 'payment_intents:confirm', 'verification:create',
      'refunds:create', 'refunds:read', 'refunds:approve', 'settlements:read', 'devices:read', 'devices:enrol',
      'merchants:read', 'customers:read', 'merchant:dashboard', 'integrations:read', 'webhooks:write',
    ],
  },
  merchant_cashier: {
    role: 'merchant_cashier',
    label: 'Merchant cashier',
    description: 'Take payment, issue receipt, limited refunds',
    restrictions: 'Cannot change settlement account or global settings',
    scope: 'tenant',
    permissions: [
      'transactions:read', 'payment_intents:create', 'payment_intents:read', 'payment_intents:confirm', 'verification:create',
      'refunds:create', 'refunds:read', 'merchants:read', 'merchant:dashboard',
    ],
  },
  support_agent: {
    role: 'support_agent',
    label: 'Support agent',
    description: 'Search minimal customer records, open support cases, view masked payment status',
    restrictions: 'No raw biometric templates or payment secrets',
    scope: 'platform',
    permissions: ['transactions:read', 'payment_intents:read', 'customers:read', 'merchants:read', 'refunds:read', 'consents:read'],
  },
  kyc_risk_analyst: {
    role: 'kyc_risk_analyst',
    label: 'KYC / Risk analyst',
    description: 'Review consent/KYC evidence, alerts, holds and escalations',
    restrictions: 'Segregated approvals; access logged',
    scope: 'platform',
    permissions: ['customers:read', 'consents:read', 'transactions:read', 'merchants:read', 'refunds:read', 'approvals:read', 'audit:read'],
  },
  finance_operator: {
    role: 'finance_operator',
    label: 'Finance operator',
    description: 'Reconciliation, settlement queues, financial reports',
    restrictions: 'No unilateral bank detail changes',
    scope: 'platform',
    permissions: ['settlements:read', 'transactions:read', 'refunds:read', 'refunds:approve', 'merchants:read', 'admin:overview'],
  },
  device_technician: {
    role: 'device_technician',
    label: 'Device technician',
    description: 'Inventory, activation, health, firmware rollout',
    restrictions: 'No access to unrelated transaction personal data',
    scope: 'platform',
    permissions: ['devices:read', 'devices:enrol', 'merchants:read'],
  },
  integration_operator: {
    role: 'integration_operator',
    label: 'Integration operator',
    description: 'Partners, environments, keys metadata and webhook health',
    restrictions: 'Secrets rotated via vault; never shown in plaintext after creation',
    scope: 'platform',
    permissions: ['integrations:read', 'webhooks:write', 'merchants:read'],
  },
  super_user: {
    role: 'super_user',
    label: 'Super user',
    description: 'Provision roles, policies and platform configuration',
    restrictions: 'Break-glass MFA; dual approval; time-limited access',
    scope: 'platform',
    permissions: [
      'transactions:read', 'payment_intents:read', 'refunds:read', 'refunds:approve', 'settlements:read', 'devices:read', 'devices:enrol',
      'merchants:read', 'customers:read', 'consents:read', 'admin:overview', 'roles:read', 'approvals:read', 'approvals:decide',
      'audit:read', 'integrations:read', 'webhooks:write',
    ],
  },
  auditor: {
    role: 'auditor',
    label: 'Auditor (read only)',
    description: 'Access immutable logs, changes and approved evidence',
    restrictions: 'No mutation privileges',
    scope: 'platform',
    permissions: [
      'transactions:read', 'payment_intents:read', 'refunds:read', 'settlements:read', 'devices:read', 'merchants:read',
      'customers:read', 'consents:read', 'roles:read', 'approvals:read', 'audit:read', 'integrations:read',
    ],
  },
};

export function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v);
}

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_MATRIX[role].permissions];
}

export function can(role: Role, perm: Permission): boolean {
  return ROLE_MATRIX[role].permissions.includes(perm);
}

export interface Principal {
  id: string;
  role: Role;
  tenantId: string;
  scopes: string[];
}

export const PLATFORM_TENANT = 'tenant_platform';

/** Tenant isolation: may this principal touch a row belonging to `rowTenantId` / `ownerUserId`? */
export function canAccessRow(p: Principal, row: { tenantId?: string | null; ownerUserId?: string | null }): boolean {
  const scope = ROLE_MATRIX[p.role].scope;
  if (scope === 'platform') return true;
  if (scope === 'tenant') return !!row.tenantId && row.tenantId === p.tenantId;
  return !!row.ownerUserId && row.ownerUserId === p.id;
}

/** Biometric media/templates are never exposed through the API; this is the single guard. */
export function canReadRawBiometrics(_p: Principal): boolean {
  return false;
}

export class DomainError extends Error {
  constructor(public status: 400 | 401 | 429 | 403 | 404 | 409 | 422 | 502 | 503, public code: string, message: string) {
    super(message);
  }
}
