import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { recoverAddress, type Hex } from 'viem';
import {
  buildContentDescriptor,
  verifyContentDescriptor,
  contentCommitment,
  computeCanonicalId,
  type SignatureVerifier,
} from '@agenticprimitives/content-primitives';
import {
  parseLegalAlias,
  legalCanonicalLocus,
  legalEnvelope,
  legalSelector,
  InvalidLegalReferenceError,
  CODIFICATION_V1,
  LEGAL_PROVISION_PROFILE_V1,
  LEGAL_PROVISION_CONTENT_TYPE,
  USC_TITLES,
} from '../src/index.js';

describe('parseLegalAlias — basics', () => {
  it('parses usc:42:1983 to controlled tokens', () => {
    const r = parseLegalAlias('usc:42:1983');
    expect(r.locus).toMatchObject({ kind: 'legal.provision', jurisdiction: 'us', code: 'usc', title: 42, section: '1983', codification: CODIFICATION_V1 });
    expect(r.titleName).toBe('The Public Health and Welfare');
    expect(r.reference.envelope.locusProfile).toBe(LEGAL_PROVISION_PROFILE_V1);
  });
  it('the id equals the hash of the legal envelope', () => {
    const r = parseLegalAlias('usc:42:1983');
    expect(r.reference.id).toBe(computeCanonicalId(legalEnvelope(legalCanonicalLocus(42, '1983'))));
  });
});

describe('CONFORMANCE — these all produce the SAME canonicalId', () => {
  it('citation-form equivalence', () => {
    const ids = ['usc:42:1983', 'usc:42.1983', '42 U.S.C. § 1983', '42 USC 1983', '42 U.S.C. 1983'].map((a) => parseLegalAlias(a).reference.id);
    expect(new Set(ids).size).toBe(1);
  });
});

describe('CONFORMANCE — these produce DIFFERENT canonicalIds', () => {
  const id = (a: string) => parseLegalAlias(a).reference.id;
  it('different section', () => expect(id('usc:42:1983')).not.toBe(id('usc:42:1985')));
  it('different title', () => expect(id('usc:42:1983')).not.toBe(id('usc:18:1983')));
  it('different codification (governance seam)', () => {
    const env = legalEnvelope(legalCanonicalLocus(42, '1983'));
    const other = { ...env, canonicalLocus: { ...legalCanonicalLocus(42, '1983'), codification: 'state-code-tx' } };
    expect(computeCanonicalId(env)).not.toBe(computeCanonicalId(other));
  });
  it('different profile version', () => {
    const env = legalEnvelope(legalCanonicalLocus(42, '1983'));
    expect(computeCanonicalId(env)).not.toBe(computeCanonicalId({ ...env, locusProfile: 'ap.legal.provision.v2' }));
  });
  it('cross-domain: a legal locus never collides with a scripture-shaped one', () => {
    // same numbers, different domain/profile → different id (domain-separated).
    const legal = computeCanonicalId(legalEnvelope(legalCanonicalLocus(3, '16')));
    const scriptureShaped = computeCanonicalId({ idScheme: 'ap-locus-id-v1', contentDomain: 'scripture', locusProfile: 'ap.scripture.locus.v1', canonicalLocus: { chapter: 3, verse: 16 } });
    expect(legal).not.toBe(scriptureShaped);
  });
});

describe('CONFORMANCE — these fail validation', () => {
  it('invalid title', () => expect(() => parseLegalAlias('usc:99:1')).toThrow(InvalidLegalReferenceError));
  it('non-ASCII', () => expect(() => parseLegalAlias('４2 USC 1983')).toThrow(/non-ASCII/));
  it('garbage', () => expect(() => parseLegalAlias('not a citation')).toThrow(InvalidLegalReferenceError));
  it('66 titles? no — only 1..54', () => expect(USC_TITLES.every((t) => t.title >= 1 && t.title <= 54)).toBe(true));
});

// THE GENERICITY PROOF: a real ContentDescriptor for a US Code provision, built
// + verified through the SAME @agenticprimitives/content-primitives substrate
// the scripture vertical uses. Public-domain US legal text.
describe('GENERICITY — content-primitives builds + verifies a LEGAL descriptor', () => {
  const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
  const verify: SignatureVerifier = async ({ signer, hash, signature }) =>
    (await recoverAddress({ hash, signature })).toLowerCase() === signer.toLowerCase();
  // 42 U.S.C. § 1983 (Civil action for deprivation of rights) — public domain.
  const TEXT = 'Every person who, under color of any statute, ordinance, regulation, custom, or usage, of any State or Territory ... subjects, or causes to be subjected, any citizen of the United States ... to the deprivation of any rights, privileges, or immunities secured by the Constitution and laws, shall be liable to the party injured in an action at law ...';

  it('builds a signed legal ContentDescriptor and verifies it (no scripture code involved)', async () => {
    const ref = parseLegalAlias('42 U.S.C. § 1983');
    const descriptor = await buildContentDescriptor(
      {
        id: 'desc_usc_42_1983',
        canonicalId: ref.reference.id,
        contentType: LEGAL_PROVISION_CONTENT_TYPE,
        issuer: { address: account.address, did: 'did:web:law.example' },
        issuedAt: '2026-06-07T00:00:00Z',
        status: 'active',
        work: { title: '42 U.S.C. § 1983', language: 'en', edition: 'us-code-2024', rightsStatus: 'public-domain' },
        selector: legalSelector(42, '1983') as unknown as Record<string, unknown>,
        commitment: contentCommitment(TEXT),
        retrievalPointer: 'content://legal.provision/usc/42/1983',
        proofPolicy: 'issuer-signature-and-hash-v1',
        accessPolicy: 'public',
      },
      (hash: Hex) => account.sign({ hash }),
    );
    const v = await verifyContentDescriptor(descriptor, { verifySignature: verify });
    expect(v.ok).toBe(true);
    expect(descriptor.contentType).toBe('legal.provision');
    // the commitment binds the off-chain text without containing it
    expect(JSON.stringify(descriptor)).not.toMatch(/Every person who/);
  });
});
