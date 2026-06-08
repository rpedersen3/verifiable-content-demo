// The resolving agent's signing identity. It signs CitationAssertions so a
// citation is a real, verifiable credential — the "AI-safe citation provenance"
// (who cited what, under which entitlement, with a matching commitment).
//
// Dev EOA stands in for the agent's Smart Agent (ERC-1271 in production).

import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import type { CredentialSigner } from '@agenticprimitives/verifiable-credentials';

export const DEMO_CHAIN_ID = 31337;

// DEV-ONLY agent key (anvil account #2). Clearly not a secret.
const AGENT_PK = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as const;
const agentAccount = privateKeyToAccount(AGENT_PK);

export const AGENT_ADDRESS = agentAccount.address;
export const AGENT_DID = `eip155:${DEMO_CHAIN_ID}:${agentAccount.address}`;

export const agentSigner: CredentialSigner = {
  issuerAddress: agentAccount.address,
  chainId: DEMO_CHAIN_ID,
  verifyingContract: agentAccount.address,
  signDigest: (digest: Hex) => agentAccount.sign({ hash: digest }),
};
