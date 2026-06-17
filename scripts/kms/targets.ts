// Deploy-target secret writers — write a named secret to Cloudflare or Vercel with NO terminal echo and
// no copy/paste. Cloudflare: pipe into `wrangler secret put`. Vercel: REST API (vercel env add from stdin
// is unreliable — observed storing empty). Values are passed in-memory; never logged.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Pipe a secret value into `wrangler secret put <name> --env <env>` from the worker's dir (no echo). */
export function writeCloudflareSecret(dir: string, env: string, name: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', 'secret', 'put', name, '--env', env], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`wrangler secret put ${name} failed (${code}): ${err.slice(-300)}`))));
    child.stdin.write(value.endsWith('\n') ? value : value + '\n');
    child.stdin.end();
  });
}

// ── Vercel REST ──
const vercelToken = (): string => {
  const j = JSON.parse(readFileSync(join(homedir(), '.local/share/com.vercel.cli/auth.json'), 'utf8')) as { token?: string };
  if (!j.token) throw new Error('no Vercel CLI token at ~/.local/share/com.vercel.cli/auth.json (run `vercel login`)');
  return j.token;
};

async function vercelProjectId(token: string, project: string): Promise<{ id: string; teamId: string | null }> {
  const h = { authorization: `Bearer ${token}` };
  let r = await fetch(`https://api.vercel.com/v9/projects/${project}`, { headers: h });
  if (r.ok) return { id: (await r.json() as { id: string }).id, teamId: null };
  const teams = (await (await fetch('https://api.vercel.com/v2/teams', { headers: h })).json()) as { teams?: Array<{ id: string }> };
  for (const t of teams.teams ?? []) {
    const rr = await fetch(`https://api.vercel.com/v9/projects/${project}?teamId=${t.id}`, { headers: h });
    if (rr.ok) return { id: (await rr.json() as { id: string }).id, teamId: t.id };
  }
  throw new Error(`Vercel project not found: ${project}`);
}

/** Upsert an encrypted env var on a Vercel project for the given target (delete any existing, then create). */
export async function writeVercelSecret(project: string, target: string, name: string, value: string): Promise<void> {
  const token = vercelToken();
  const { id, teamId } = await vercelProjectId(token, project);
  const q = teamId ? `?teamId=${teamId}` : '';
  const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const list = (await (await fetch(`https://api.vercel.com/v9/projects/${id}/env${q}`, { headers: h })).json()) as { envs?: Array<{ id: string; key: string; target?: string[] }> };
  for (const e of (list.envs ?? []).filter((e) => e.key === name && (e.target ?? []).includes(target))) {
    await fetch(`https://api.vercel.com/v9/projects/${id}/env/${e.id}${q}`, { method: 'DELETE', headers: h });
  }
  const c = await fetch(`https://api.vercel.com/v10/projects/${id}/env${q}`, { method: 'POST', headers: h, body: JSON.stringify({ key: name, value, type: 'encrypted', target: [target] }) });
  if (!c.ok) throw new Error(`Vercel env create ${name} failed: ${c.status} ${(await c.text()).slice(0, 200)}`);
}
