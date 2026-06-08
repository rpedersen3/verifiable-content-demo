// Vercel serverless entry (Node runtime). Vercel pre-parses the request body
// into req.body and the raw stream never re-emits — so stream-based adapters
// (getRequestListener / hono/vercel) hang. We build a Web Request from the
// already-parsed body and hand it to the Hono app's fetch.
import app from '../src/app.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any): Promise<void> {
  const method: string = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD' && req.body !== undefined && req.body !== null;
  const bodyText = hasBody ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : undefined;

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers ?? {})) if (typeof v === 'string') headers.set(k, v);

  const request = new Request(`https://${req.headers?.host ?? 'validator'}${req.url ?? '/'}`, {
    method,
    headers,
    body: bodyText,
  });

  const response = await app.fetch(request);
  res.statusCode = response.status;
  response.headers.forEach((value: string, key: string) => res.setHeader(key, value));
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}
