// Generate an ES256 (ECDSA P-256) broker signing keypair and print the PRIVATE JWK + kid.
//
//   node apps/impact/scripts/gen-broker-key.mjs
//
// The broker key is the home's own session-signing key — server-side only. Set it in
// Vercel (Settings → Environment Variables, mark Sensitive):
//   BROKER_PRIVATE_JWK = <the printed privateJwk JSON>
//   BROKER_KID         = <the printed kid>
// Only the PUBLIC half is ever exposed, via GET /jwks. Never commit a populated value.
import { webcrypto as crypto } from "node:crypto";

const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const privateJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
const kid = "broker-" + Buffer.from(crypto.getRandomValues(new Uint8Array(4))).toString("hex");

console.log("BROKER_KID=" + kid);
console.log("BROKER_PRIVATE_JWK=" + JSON.stringify(privateJwk));
