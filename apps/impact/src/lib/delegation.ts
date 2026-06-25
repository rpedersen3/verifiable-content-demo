// ERC-7710 delegation issuance for impact's home-managed agents (ADR-0019). Ported from
// agenticprimitives/demo-sso-next/src/lib/delegation.ts, trimmed to the pieces impact's
// treasury/stewardship flow needs: the approved-hash site/stewardship grant + its wire form.
// DelegationManager + enforcers are already deployed (src/lib/chain.ts CONTRACTS).
import {
  type Delegation,
  type Caveat,
  buildCaveat,
  encodeTimestampTerms,
  encodeAllowedTargetsTerms,
  encodeValueTerms,
  hashDelegation,
  ROOT_AUTHORITY,
} from '@agenticprimitives/delegation';
import type { Address, Hex } from '@agenticprimitives/types';
import { CHAIN_ID, CONTRACTS } from './chain';

/** Wire form of a Delegation (bigint salt → string) for transport / storage. */
export interface DelegationWire {
  delegator: Address;
  delegate: Address;
  authority: Hex;
  caveats: Caveat[];
  salt: string;
  signature: Hex;
}
export const toWire = (d: Delegation): DelegationWire => ({ ...d, salt: d.salt.toString() });

/** spec 253 — the approved-hash sentinel signature. A delegation carrying this 1-byte wire
 *  signature is NOT signed off-chain; instead its delegator SA pre-approved the EIP-712 digest
 *  in the ApprovedHashRegistry (inside its own deploy userOp), and the SA's ERC-1271
 *  `isValidSignature` honors it via the `0x03` branch — so a child agent can grant stewardship
 *  to its parent in the SAME deploy that creates it, with no second signature. */
export const APPROVED_HASH_SENTINEL: Hex = '0x03';

/** Least-privilege caveats for a home-managed grant: time-boxed, value 0, scoped to the
 *  on-chain targets a delegate needs (naming + relationship). */
function siteCaveats(validUntil: number): Caveat[] {
  return [
    buildCaveat(CONTRACTS.timestampEnforcer, encodeTimestampTerms(0, validUntil)),
    buildCaveat(CONTRACTS.valueEnforcer, encodeValueTerms(0n)),
    buildCaveat(
      CONTRACTS.allowedTargetsEnforcer,
      encodeAllowedTargetsTerms([
        CONTRACTS.agentRelationship,
        CONTRACTS.agentNameRegistry,
        CONTRACTS.permissionlessSubregistry,
      ]),
    ),
  ];
}

/** Build the unsigned delegation struct (shared by the signed + approved-hash variants). */
function buildSiteDelegation(delegator: Address, delegateSA: Address, validitySeconds: number): Delegation {
  const validUntil = Math.floor(Date.now() / 1000) + validitySeconds;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let salt = 0n;
  for (const b of bytes) salt = (salt << 8n) | BigInt(b);
  return { delegator, delegate: delegateSA, authority: ROOT_AUTHORITY, caveats: siteCaveats(validUntil), salt, signature: '0x' };
}

/** spec 253 — build a `delegator → delegateSA` grant WITHOUT an off-chain signature. Returns the
 *  delegation (wire signature = the `0x03` sentinel) plus its EIP-712 `digest`, so the caller
 *  batches `approvedHashRegistry.approveHash(digest)` into the DELEGATOR's own userOp. The digest
 *  excludes the signature field, so it is identical to what the relayer + on-chain redeem recompute.
 *  The delegator MUST be the account whose userOp runs the `approveHash` (the agent being deployed). */
export function buildApprovedSiteDelegation(
  delegator: Address,
  delegateSA: Address,
  validitySeconds = 60 * 60 * 24 * 365,
): { delegation: Delegation; digest: Hex } {
  const d = buildSiteDelegation(delegator, delegateSA, validitySeconds);
  const digest = hashDelegation(d, CHAIN_ID, CONTRACTS.delegationManager);
  d.signature = APPROVED_HASH_SENTINEL;
  return { delegation: d, digest };
}

/** Build an UNSIGNED `delegator → delegateSA` site grant + its EIP-712 `digest`, for the caller to
 *  sign OFF-CHAIN with the delegator's credential (passkey / social C_sub / wallet). Used for the
 *  self session-delegation (person → person) that authorizes the member's own vault reads WITHOUT a
 *  custodian shortcut — the signed delegation IS the read authority (mirrors demo-sso-next
 *  issueSessionDelegation). Set `delegation.signature` to the returned signature before sending. */
export function buildUnsignedSiteDelegation(
  delegator: Address,
  delegateSA: Address,
  validitySeconds = 60 * 60 * 12,
): { delegation: Delegation; digest: Hex } {
  const d = buildSiteDelegation(delegator, delegateSA, validitySeconds);
  const digest = hashDelegation(d, CHAIN_ID, CONTRACTS.delegationManager);
  return { delegation: d, digest };
}
