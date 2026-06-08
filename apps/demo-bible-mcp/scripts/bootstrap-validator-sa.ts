// Create the VALIDATOR Smart Agent (an AgentAccount) on a chain with the
// agenticprimitives contracts deployed, and prove its ERC-1271. The validator
// then signs ValidationAttestations + anchors them AS this SA (verified via
// ERC-1271), instead of a bare EOA.
//
//   RPC_URL=$BASE_SEPOLIA_RPC AP_DEPLOYMENTS=.../deployments-base-sepolia.json \
//   DEPLOYER_PK=0x<funded> VALIDATOR_OWNER_PK=0x<owner> tsx scripts/bootstrap-validator-sa.ts

import { readFileSync } from 'node:fs';
import { createPublicClient, http, keccak256, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { AgentAccountClient } from '@agenticprimitives/agent-account';

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const DEPLOYMENTS = process.env.AP_DEPLOYMENTS ?? '/home/barb/agenticprimitives/packages/contracts/deployments-anvil.json';
// The SA owner pays gas for the deploy + signs. Default anvil#0; on testnet use a funded key.
const OWNER_PK = (process.env.VALIDATOR_OWNER_PK ?? process.env.DEPLOYER_PK ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex;

async function main() {
  const d = JSON.parse(readFileSync(DEPLOYMENTS, 'utf8'));
  const factory = d.agentAccountFactory as Address;
  const chainId = d.chainId as number;
  const owner = privateKeyToAccount(OWNER_PK);
  const pub = createPublicClient({ transport: http(RPC) });

  // salt 99 → a Validator SA distinct from the issuer SA (salt 7).
  const aac = new AgentAccountClient({ rpcUrl: RPC, factory, chainId });
  const spec = { mode: 0, custodians: [owner.address], trustees: [] as Address[], salt: 99n };
  const validatorSA = await aac.createAgentAccountFromAccount(spec, owner);
  console.log(`Validator Smart Agent: ${validatorSA} (owner ${owner.address})`);

  for (let i = 0; i < 30; i++) {
    const code = await pub.getCode({ address: validatorSA });
    if (code && code.length > 2) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  const sampleHash = keccak256(toHex('demo-validator:erc1271-probe'));
  const sig = await owner.signMessage({ message: { raw: sampleHash } });
  const ok = await aac.isValidSignature(validatorSA, sampleHash, sig);
  console.log(`ERC-1271 isValidSignature: ${ok ? 'OK ✓' : 'FAILED ✗'}`);
  if (!ok) throw new Error('Validator SA cannot sign');

  console.log('\nSet these on the validator (Vercel) + restart:');
  console.log(`  VALIDATOR_SA=${validatorSA}`);
  console.log(`  VALIDATOR_OWNER_PK=${OWNER_PK}`);
  console.log('VALIDATOR SA BOOTSTRAP OK');
}

main().catch((e) => {
  console.error('bootstrap failed:', e);
  process.exit(1);
});
