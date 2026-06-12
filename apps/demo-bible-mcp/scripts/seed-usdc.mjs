// Seed mock USDC into the treasuries (Base Sepolia 84532). MockUSDC.mint is permissionless, but the
// submitting EOA needs a little Base-Sepolia ETH for gas.
//
//   FUND_PK=0x<a funded EOA key>  node apps/demo-bible-mcp/scripts/seed-usdc.mjs  [addr ...]
//
// Defaults: 1000 USDC each to lbsb.impact + lbsb-treasury.impact. Override amount with AMOUNT=<usdc>.
// Pass extra addresses (e.g. a reader's treasury SA) as args to seed them too.
import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

const RPC = process.env.RPC || 'https://base-sepolia.g.alchemy.com/v2/WvEny4nR70VTUMX0DfR-A';
const PK = process.env.FUND_PK;
const USDC = '0x8fb56ff3C13347DFC4E1287aE83E88deE5a7211C';
const AMOUNT = BigInt(process.env.AMOUNT || '1000') * 1_000_000n; // 6 decimals
const DEFAULTS = [
  '0x91b43817d8f9ff449a4c68cb187821b13b5feabe', // lbsb.impact
  '0xa9e0acecfbce08548358b4f5681b13a00a5cab7a', // lbsb-treasury.impact
];
const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULTS;
const ABI = parseAbi(['function mint(address to, uint256 amount)', 'function balanceOf(address) view returns (uint256)']);

if (!PK) { console.error('Set FUND_PK=0x<a Base-Sepolia-funded EOA private key> (the submitter — pays gas only).'); process.exit(1); }
const account = privateKeyToAccount(PK);
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });
const pc = createPublicClient({ chain: baseSepolia, transport: http(RPC) });

const eth = await pc.getBalance({ address: account.address });
console.log('funder', account.address, '·', (Number(eth) / 1e18).toFixed(5), 'ETH');
if (eth === 0n) { console.error('funder has no Base-Sepolia ETH for gas — top it up (a faucet) first.'); process.exit(1); }

for (const to of targets) {
  const hash = await wallet.writeContract({ address: USDC, abi: ABI, functionName: 'mint', args: [to, AMOUNT] });
  await pc.waitForTransactionReceipt({ hash });
  const bal = await pc.readContract({ address: USDC, abi: ABI, functionName: 'balanceOf', args: [to] });
  console.log('  +', (Number(AMOUNT) / 1e6).toFixed(0), 'USDC →', to, '· now', (Number(bal) / 1e6).toFixed(2), '· tx', hash);
}
console.log('done.');
