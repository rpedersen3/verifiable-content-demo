// End-to-end test of the spec-277 delegated data vault against the deployed MCP. Exercises the full chain:
// encrypted write → fail-closed entitlement gate → owner grant → one-time DecryptGrant/KAS → OAuth ingress
// → field-projected read. Mirrors scripts/validator-e2e.ts.
//   MCP_URL=https://… pnpm vault:e2e   (defaults to the production MCP)
const MCP = process.env.MCP_URL ?? 'https://demo-bible-mcp-production.richardpedersen3.workers.dev';
const OWNER = 'eip155:84532:0xVaultE2EOwner';
const ACTOR = 'eip155:84532:0xVaultE2EAgent';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(`${MCP}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
};

async function main() {
  console.log(`Vault e2e → ${MCP}\n`);

  // 0. RFC 9728 protected-resource metadata is served.
  const meta = await (await fetch(`${MCP}/.well-known/oauth-protected-resource`)).json().catch(() => ({})) as any;
  check('protected-resource metadata served', meta?.resource?.includes('/vault') && Array.isArray(meta?.scopes_supported), `scopes: ${(meta?.scopes_supported ?? []).join(',')}`);

  // 1. Encrypted write of a sensitive object.
  const set = await post('/tools/vault_set', { owner: OWNER, resource: 'person-profile', data: { name: 'E2E', email: 'e2e@example.com', locale: 'en' }, classification: 'pii.sensitive' });
  check('vault_set (pii.sensitive) ok', set.json.ok === true);

  // 2. Read before any grant → fail-closed entitlement deny.
  const before = await post('/tools/vault_get', { owner: OWNER, resource: 'person-profile', actor: ACTOR, fields: ['email'] });
  check('ungranted read denied', before.status === 403 && before.json.stage === 'entitlement', `reason: ${before.json.reason}`);

  // 3. Owner grants the actor read on [email].
  const grant = await post('/tools/vault_grant', { principal: OWNER, actor: ACTOR, resource: 'person-profile', actions: ['read'], fields: ['email'], classificationCeiling: 'pii.sensitive' });
  check('vault_grant ok', grant.json.ok === true, grant.json.credentialId);

  // 4. Over-requesting a non-granted field → fail-closed.
  const over = await post('/tools/vault_get', { owner: OWNER, resource: 'person-profile', actor: ACTOR, fields: ['name', 'email'] });
  check('over-request denied (field_not_allowed)', over.status === 403 && over.json.reason === 'field_not_allowed');

  // 5. In-scope read → allow; data is decrypted (KMS) + projected to [email] only.
  const ok = await post('/tools/vault_get', { owner: OWNER, resource: 'person-profile', actor: ACTOR, fields: ['email'] });
  check('in-scope read allowed', ok.json.ok === true);
  check('decrypted + projected to [email] only', JSON.stringify(ok.json.object?.data) === JSON.stringify({ email: 'e2e@example.com' }), JSON.stringify(ok.json.object?.data));

  // 6. OAuth lane: mint a bearer bound to a grant bundle.
  const mint = await post('/tools/vault_oauth_mint', { principal: OWNER, delegate: ACTOR, resource: 'person-profile', fields: ['email'] });
  check('vault_oauth_mint ok', mint.json.ok === true && typeof mint.json.token === 'string');

  // 7. OAuth-protected read with the bearer → allow, via the grant bundle.
  const viaOauth = await post('/mcp/vault/read', { resource: 'person-profile', fields: ['email'] }, { authorization: `Bearer ${mint.json.token}` });
  check('OAuth read allowed via grant bundle', viaOauth.json.ok === true && !!viaOauth.json.viaGrantBundle, viaOauth.json.viaGrantBundle);
  check('OAuth read decrypted + projected', JSON.stringify(viaOauth.json.object?.data) === JSON.stringify({ email: 'e2e@example.com' }));

  // 8. OAuth read without a bearer → 401.
  const noAuth = await fetch(`${MCP}/mcp/vault/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resource: 'person-profile' }) });
  check('no-bearer read → 401', noAuth.status === 401);

  // cleanup
  await post('/tools/vault_set', { owner: OWNER, resource: 'person-profile', data: null });

  console.log(`\n${failures === 0 ? 'VAULT E2E PASSED ✓' : `VAULT E2E FAILED ✗ (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error('e2e error:', (e as Error).message); process.exit(1); });
