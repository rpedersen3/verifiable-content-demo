# @verifiable-content-demo/legal-content-extension

A **second content vertical — US legal code** — built entirely on the published
[`@agenticprimitives/content-primitives`](https://www.npmjs.com/package/@agenticprimitives/content-primitives),
with **no scripture code and no changes to agenticprimitives**.

It exists to prove the thesis: `content-primitives` is a *generic* verifiable-
content substrate, and scripture was only its first projection. A verse and a
statute are both just "content with a domain-specific canonical locus."

```ts
import { parseLegalAlias } from '@verifiable-content-demo/legal-content-extension';

const r = parseLegalAlias('42 U.S.C. § 1983');
r.reference.id;   // canonicalId — SAME for 'usc:42:1983', 'usc:42.1983', '42 USC 1983'
r.locus;          // { kind:'legal.provision', jurisdiction:'us', code:'usc', title:42, section:'1983', codification:'us-code' }
```

It mirrors the scripture vertical exactly: a controlled-token, versioned
(`ap.legal.provision.v1` + `codification`), scheme-independent canonical locus →
one `canonicalId`; many citation forms normalize to one locus; US-ASCII only.
US federal statutory law is public domain (no copyright — unlike most scripture
translations), so the demo text is freely usable.

The test suite (`test/parse.test.ts`) includes the **genericity proof**: a real
US Code `ContentDescriptor`, built and verified through the same
`content-primitives` SDK the scripture vertical uses.
