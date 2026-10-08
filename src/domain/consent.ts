import { DomainError } from './rbac';

export type Modality = 'face' | 'fingerprint' | 'palm' | 'retina' | 'pin';
export const BIOMETRIC_MODALITIES: readonly Modality[] = ['face', 'fingerprint', 'palm', 'retina'];

export interface ConsentLike {
  subjectId: string;
  modality: string;
  purpose: string;
  grantedAt: Date;
  revokedAt: Date | null;
}

export function isBiometric(modality: string): boolean {
  return (BIOMETRIC_MODALITIES as readonly string[]).includes(modality);
}

export function isActive(c: ConsentLike, now = new Date()): boolean {
  return c.grantedAt.getTime() <= now.getTime() && (!c.revokedAt || c.revokedAt.getTime() > now.getTime());
}

/**
 * Consent revocation blocks biometric challenges where no other lawful basis applies.
 * Non-biometric alternatives (PIN) are always available.
 */
export function assertBiometricAllowed(
  consents: ConsentLike[],
  subjectId: string,
  modality: string,
  now = new Date(),
): void {
  if (!isBiometric(modality)) return;
  const ok = consents.some((c) => c.subjectId === subjectId && c.modality === modality && isActive(c, now));
  if (!ok) {
    throw new DomainError(403, 'consent_required', `No active biometric consent for ${modality}; use a non-biometric method or re-consent`);
  }
}
