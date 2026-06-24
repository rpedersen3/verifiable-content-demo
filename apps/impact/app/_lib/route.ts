// Wrap a Next route handler so ANY unexpected throw from the ported broker (missing
// BROKER_PRIVATE_JWK, KV failure, RPC error, …) returns a JSON 500 with the message,
// instead of an empty 500 body that makes the client throw "Unexpected end of JSON
// input". Makes production misconfiguration self-diagnosing.
export function jsonErrorBoundary(
  fn: (request: Request, ctx?: unknown) => Promise<Response>,
): (request: Request, ctx?: unknown) => Promise<Response> {
  return async (request: Request, ctx?: unknown) => {
    try {
      return await fn(request, ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "broker error";
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  };
}
