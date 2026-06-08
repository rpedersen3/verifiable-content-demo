// @verifiable-content-demo/legal-content-extension — a SECOND content vertical
// (US legal code) built ENTIRELY on the published @agenticprimitives/content-
// primitives. It contains no scripture code and never touches agenticprimitives
// source — proving content-primitives is a generic substrate (a verse and a
// statute are both just "verifiable content" with a domain-specific canonical
// locus). Mirrors the scripture vertical's shape: controlled-token, versioned,
// scheme-independent canonical locus → one canonicalId.

import {
  canonicalReference,
  LOCUS_ID_SCHEME,
  type CanonicalLocusEnvelope,
  type CanonicalReference,
} from '@agenticprimitives/content-primitives';
import { USC_TITLES, lookupTitle, type UscTitle } from './canon.js';

export { USC_TITLES, lookupTitle, type UscTitle } from './canon.js';

export const LEGAL_PROVISION_CONTENT_TYPE = 'legal.provision';
export const CONTENT_DOMAIN = 'legal';

/** Versioned locus profile — the governance seam (spec 266 §2.1). Bundles the
 *  jurisdiction + codification model. A different codification = a new namespace. */
export const LEGAL_PROVISION_PROFILE_V1 = 'ap.legal.provision.v1';
/** The codification model id (the legal analog of scripture's versification). */
export const CODIFICATION_V1 = 'us-code';

/** Controlled-token canonical locus for a US Code provision (profile v1). */
export interface LegalProvisionLocusV1 {
  kind: 'legal.provision';
  jurisdiction: string; // 'us'
  code: string; // 'usc'
  title: number;
  section: string; // lowercased; sections can be alphanumeric (e.g. '1395dd')
  codification: string;
}

export interface LegalSelector {
  kind: 'legal';
  jurisdiction: string;
  code: string;
  title: number;
  section: string;
  codification: string;
}

export class InvalidLegalReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLegalReferenceError';
  }
}

export function legalCanonicalLocus(title: number, section: string): LegalProvisionLocusV1 {
  const t = lookupTitle(title);
  if (!t) throw new InvalidLegalReferenceError(`invalid US Code title: ${title}`);
  const sec = section.trim().toLowerCase();
  if (!/^[0-9][0-9a-z-]*$/.test(sec)) throw new InvalidLegalReferenceError(`invalid section: ${section}`);
  return { kind: 'legal.provision', jurisdiction: 'us', code: 'usc', title: t.title, section: sec, codification: CODIFICATION_V1 };
}

export function legalEnvelope(locus: LegalProvisionLocusV1): CanonicalLocusEnvelope {
  return {
    idScheme: LOCUS_ID_SCHEME,
    contentDomain: CONTENT_DOMAIN,
    locusProfile: LEGAL_PROVISION_PROFILE_V1,
    canonicalLocus: locus as unknown as Record<string, unknown>,
  };
}

export function legalSelector(title: number, section: string): LegalSelector {
  const l = legalCanonicalLocus(title, section);
  return { kind: 'legal', jurisdiction: l.jurisdiction, code: l.code, title: l.title, section: l.section, codification: l.codification };
}

export interface ParsedLegalReference {
  title: number;
  section: string;
  titleName: string;
  selector: LegalSelector;
  locus: LegalProvisionLocusV1;
  reference: CanonicalReference;
}

// US-ASCII only (confusable defense; spec 266 §threat-model).
const ASCII_ONLY = /^[\x20-\x7E]*$/;

/**
 * Parse a legal-code alias into its canonical locus. Accepts the canonical alias
 * `usc:42:1983` and tolerant citation forms (`usc:42.1983`, `42 U.S.C. § 1983`,
 * `42 USC 1983`). All normalize to ONE canonical locus → one canonicalId.
 */
export function parseLegalAlias(alias: string): ParsedLegalReference {
  const raw = alias.normalize('NFC').trim();
  // Strip the code prefix + U.S.C./§ noise (§ is a legitimate non-ASCII symbol),
  // collapse separators to one space, THEN confusable-check the title/section.
  const cleaned = raw
    .replace(/^usc:/i, '')
    .replace(/u\.?\s*s\.?\s*c\.?/i, ' ')
    .replace(/§/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!ASCII_ONLY.test(cleaned)) {
    throw new InvalidLegalReferenceError('non-ASCII characters are rejected (confusable defense)');
  }
  const m = /^([1-9][0-9]?)[:.\s]+([0-9][0-9a-zA-Z-]*)$/.exec(cleaned);
  if (!m) throw new InvalidLegalReferenceError(`unrecognized legal reference: "${alias}"`);

  const title = Number(m[1]);
  const section = m[2]!;
  const locus = legalCanonicalLocus(title, section); // validates title + section
  const t = lookupTitle(title)!;
  const canonicalAlias = `usc:${title}:${locus.section}`;
  return {
    title,
    section: locus.section,
    titleName: t.name,
    selector: legalSelector(title, section),
    locus,
    reference: canonicalReference(legalEnvelope(locus), canonicalAlias),
  };
}

/** Canonical display citation, e.g. '42 U.S.C. § 1983'. */
export function displayCitation(title: number, section: string): string {
  return `${title} U.S.C. § ${section}`;
}
