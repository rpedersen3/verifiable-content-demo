# Agentic Trust Technical Description

## Simple Description

This approach gives agents a shared way to reference, verify, retrieve, cite, and audit content.

Instead of an agent saying:

> "Here is John 3:16 from this translation. Trust me."

the agent returns a verifiable evidence bundle:

> "Here is the canonical reference I resolved, the issuer-signed descriptor I used, the content commitment I verified, the policy that allowed access, and the signed citation record for this response."

The core idea is that content trust is split into separate parts:

- A stable content reference, such as the canonical identity for `John 3:16`.
- A signed `ContentDescriptor`, where an issuer claims a specific rendering exists for that reference.
- A commitment/hash of the actual text, so retrieved text can be checked.
- A Merkle inclusion proof, so the descriptor can be checked against the issuer corpus.
- An optional Groth16 zk membership proof, so a validator can confirm corpus membership without learning the leaf or index.
- A policy and entitlement layer, so licensed/private content is not treated as open content.
- A signed `CitationAssertion`, where the responding agent records exactly what it used.
- An independent validator, so trust does not depend on the responding agent grading itself.
- A signed `ValidationAttestation`, where the validator records its outcome over the exact evidence bundle.
- A trust graph snapshot, so the UI can show who trusted, validated, cited, and issued what.
- Optional on-chain attestation anchoring, so a compact hash of the validation result can be checked independently.
- An audit trail, so the response can be reviewed later.

Scripture is the first vertical, but the pattern works for any content domain where agents need trustworthy references.

## Roles

```mermaid
flowchart LR
  User["User / App"]
  Agent["Translation or Content Agent"]
  Resolver["Resolver / MCP Tools"]
  Issuer["Publisher / Rights Holder Agent"]
  Validator["Third-Party Validator"]
  ZK["ZK Membership\nGroth16 + Poseidon"]
  Registry["Agent Naming + Corpus Registry"]
  Attestation["ValidationAttestation"]
  Graph["Trust Graph"]
  Anchor["Attestation Anchor"]

  User -->|"intent request"| Agent
  Agent -->|"resolve + retrieve"| Resolver
  Resolver -->|"descriptor + text under policy"| Agent
  Issuer -->|"signed descriptors + corpus roots"| Registry
  Agent -->|"evidence bundle"| Validator
  Validator -->|"validated / rejected"| User
  Validator --> Registry
  Validator --> ZK
  Validator --> Attestation
  Attestation --> Graph
  Attestation --> Anchor
```

### Publisher or Rights Holder Agent

The publisher agent owns the authority for a translation or corpus. It signs descriptors, controls retrieval, issues entitlements, and may anchor corpus roots on-chain.

### Translation or Content Agent

The responding agent handles the user's request. It may resolve references, retrieve text, produce summaries, quote content, or generate a translation-oriented response. To establish trust, it must include enough structured evidence for validators to check its work.

### Third-Party Validator

The validator is independent of the responding agent. It does not need to trust the agent's claim. It checks signatures, names, corpus membership, zk membership, commitments, policies, entitlements, response binding, and citation records. It then signs a `ValidationAttestation`, returns a trust graph, and optionally anchors the attestation hash on-chain.

### End User or App

The user sees a simple outcome: verified, partially verified, gated, or rejected. The detailed proof stays machine-readable unless the user wants to inspect provenance.

## Agentic Trust Flow

```mermaid
sequenceDiagram
  participant User
  participant Agent as Translation Agent
  participant MCP as Resolver / MCP
  participant Issuer as Publisher Agent
  participant Validator as Third-Party Validator
  participant ZK as ZK Membership
  participant Registry as Naming / Corpus Registry
  participant Attest as ValidationAttestationRegistry

  User->>Agent: Intent: quote or use John 3:16
  Agent->>MCP: Resolve reference + requested edition
  MCP->>Registry: Check issuer name and corpus root when available
  MCP-->>Agent: Canonical locus + candidate descriptors
  Agent->>MCP: Retrieve text with entitlement if required
  MCP->>Issuer: Verify entitlement/signature when required
  MCP-->>Agent: Text + descriptor + policy result
  Agent->>Agent: Verify text commitment
  Agent->>Agent: Generate zk membership proof when configured
  Agent->>Agent: Build and sign CitationAssertion
  Agent-->>Validator: Intent response + evidence bundle
  Validator->>Registry: Verify issuer identity and corpus root
  Validator->>Validator: Verify descriptor, commitment, policy, citation, response hash
  Validator->>ZK: Verify Groth16 proof using root + signalHash
  Validator->>Validator: Sign ValidationAttestation
  Validator->>Attest: Optional attestation hash anchor
  Validator-->>User: Outcome + attestation + trust graph
```

## What the Third-Party Validator Checks

A validator can validate an agent response if the response includes enough common evidence.

The validator checks:

- The human reference was normalized into the expected canonical reference.
- The selected descriptor matches that canonical reference.
- The descriptor was signed by the claimed issuer.
- The issuer identity resolves through Agent Naming when on-chain trust mode is used.
- The descriptor belongs to the claimed corpus using a Merkle inclusion proof.
- The corpus root matches the anchored root when a content corpus registry is available.
- The optional Groth16 proof proves the cited commitment is in the issuer corpus without revealing leaf/index.
- The returned text matches the descriptor commitment.
- The access policy was followed.
- Any entitlement was signed by the right issuer and applies to the right corpus.
- The responding agent signed the `CitationAssertion`.
- The citation's descriptor, commitment, canonical id, agent run id, and output id match the response.
- The response hash matches the served text or quoted output.
- The validator signed the `ValidationAttestation`.
- The trust graph scopes the result to the validator, profile, output, descriptor, and issuer.
- The attestation hash is anchored on-chain when the registry is configured.

The configured demo validator in `apps/demo-validator` returns one of three outcomes:

| Outcome | Meaning |
| --- | --- |
| `validated` | Critical checks passed and policy allowed the content. |
| `gated` | The content was correctly withheld because no valid entitlement was present. |
| `rejected` | A critical proof, signature, policy, trust, or binding check failed. |

## Signed Validation Attestation

After validation, the validator signs a credential-like `ValidationAttestation` using the same EIP-712 VC pattern as citations and entitlements. The attestation binds the validator's identity to a specific evidence bundle and output.

Key fields:

| Field | Purpose |
| --- | --- |
| `validatorAgentId` | Validator identity, EOA or Smart Agent. |
| `validatorName` | Human-readable validator name, currently `demo-validator.agent`. |
| `subjectAgentId` | Responding agent being validated, such as `scripture-resolver.agent`. |
| `agentRunId` | A2A run being validated. |
| `outputId` | Specific output being validated. |
| `evidenceBundleHash` | Hash of the exact bundle checked. |
| `responseHash` | Hash of the visible response/text. |
| `validationProfile` | Profile used, such as `public-domain-demo+zk-membership`. |
| `outcome` | `validated`, `gated`, or `rejected`. |
| `checksHash` | Hash of the per-check result object. |
| `proof` | Validator signature. In Smart Agent mode, verifiable by ERC-1271. |

The validator can optionally anchor the attestation hash in `ValidationAttestationRegistry`. The full bundle and checks stay off-chain; the chain stores compact facts and lets consumers verify that a signed validation result was anchored.

## Trust Graph

The validator returns a small graph snapshot for the UI:

```mermaid
flowchart LR
  Consumer["You / app"]
  Validator["demo-validator.agent"]
  Profile["public-domain-demo"]
  Agent["scripture-resolver.agent"]
  Issuer["berean.publishers.agent"]
  Descriptor["desc_bsb_..."]

  Consumer -->|"TRUSTS_VALIDATOR"| Validator
  Validator -->|"TRUSTS_PROFILE"| Profile
  Validator -->|"VALIDATED_OUTPUT"| Agent
  Agent -->|"CITED_DESCRIPTOR"| Descriptor
  Issuer -->|"ISSUED_DESCRIPTOR"| Descriptor
```

This is an ERC-8004-like pattern: trust is not global. It is scoped to a validator, a profile, a subject agent output, a cited descriptor, and an issuer claim.

## Common Bits Every Agent Should Include

For validators to validate intent responses, other agents should include this evidence bundle.

### 1. Agent Identity

The responding agent should identify itself.

Required fields:

| Field | Purpose |
| --- | --- |
| `agentId` | Stable agent identifier, DID, address, or Smart Agent address. |
| `agentName` | Optional human-readable name, preferably resolvable through Agent Naming. |
| `agentSignature` | Signature over the response or signed citation. |
| `agentRunId` | Unique run id for audit and replay analysis. |
| `outputId` | Id of the specific generated response/output. |

### 2. User Intent

The validator needs to know what the agent was trying to do.

Required fields:

| Field | Purpose |
| --- | --- |
| `intentType` | Example: `quote`, `reference`, `summarize`, `translate`, `compare`, `retrieve`. |
| `requestedReference` | Original user reference, such as `John 3:16`. |
| `requestedEdition` | Requested translation or edition, if any. |
| `constraints` | Policy or user constraints, such as public-domain only, licensed allowed, or ministry sensitivity profile. |

### 3. Canonical Reference

The response must include the normalized reference.

Required fields:

| Field | Purpose |
| --- | --- |
| `canonicalId` | Deterministic `CanonicalLocusId`. |
| `canonicalEnvelope` | Structured, schema-validated reference object used to produce the id. |
| `scheme` | Domain scheme, such as `scripture.verse`. |
| `normalizationVersion` | Version of the domain normalization model. |
| `displayReference` | Human-readable reference shown to the user. |

### 4. Content Descriptor

The descriptor is the issuer's signed claim about a rendering.

Required fields:

| Field | Purpose |
| --- | --- |
| `descriptorId` | Stable descriptor id. |
| `descriptor` | Full signed `ContentDescriptor` or a resolvable pointer to it. |
| `issuer` | Issuer address, DID, or Smart Agent identity. |
| `issuerName` | Optional Agent Naming name, such as `bsb.agent`. |
| `edition` | Translation/corpus edition. |
| `rightsStatus` | Public-domain, licensed, private, etc. |
| `accessPolicy` | Public, licensed, private, or custom policy. |
| `retrievalPointer` | Pointer to the off-platform artifact/text. |

### 5. Commitment and Proof

The validator needs to prove the text came from the descriptor's committed rendering.

Required fields:

| Field | Purpose |
| --- | --- |
| `commitment` | Hash/commitment from the descriptor. |
| `commitmentAlgorithm` | Algorithm used to compute the commitment. |
| `normalizationSpec` | Text normalization rules used before hashing. |
| `commitmentVerified` | Whether the responding agent verified the returned text. |
| `inclusionProof` | Merkle proof showing descriptor/artifact membership in the corpus. |
| `corpusRef` | Stable corpus reference. |
| `corpusRoot` | Merkle root used for validation. |
| `anchoredCorpusRoot` | Optional on-chain root read by validator. |
| `leafIndex` | Included in the current demo bundle so the agent can assemble proofs; not exposed by the ZK public signals. |
| `zkMembership` | Optional Groth16 proof with public signals `[root, signalHash]`. |

ZK membership is privacy-preserving membership evidence. The validator derives the Poseidon root from the issuer's public commitments, then verifies the proof against that root and the response-bound `signalHash`. The proof does not reveal which leaf was cited.

### 6. Policy and Entitlement

If content is not public, the validator must see why access was allowed.

Required fields:

| Field | Purpose |
| --- | --- |
| `policyProfile` | Trust profile used by the agent, such as public-domain demo or strict rights-holder. |
| `policyDecision` | Allow, deny, gated, or partial. |
| `entitlement` | Signed entitlement credential, if required. |
| `entitlementIssuer` | Issuer that signed the entitlement. |
| `entitlementVerification` | Structural and signature validation result. |
| `accessScope` | Corpus, edition, subject, expiry, and access level. |

### 7. Citation Assertion

The citation is the agent's signed record of content use.

Required fields:

| Field | Purpose |
| --- | --- |
| `citation` | Signed `CitationAssertion`. |
| `citationKind` | Quote, reference, summary, translation, comparison, etc. |
| `contentIssuer` | Issuer of the underlying descriptor/content. |
| `agentIssuer` | Agent that signed the citation. |
| `validFrom` | Time the citation was created. |
| `proof` | Signature proof over the citation. |

### 8. Response Binding

The evidence must be bound to the actual response, not just attached beside it.

Required fields:

| Field | Purpose |
| --- | --- |
| `responseHash` | Hash of the user-visible response or quoted span. |
| `quotedSpans` | Exact spans quoted, if the response quotes text. |
| `sourceMap` | Mapping from response spans to descriptor/canonical ids. |
| `redactions` | Any intentionally withheld or gated content. |
| `auditEventIds` | Optional links to audit records. |

### 9. Validator Attestation and Graph

Validator responses should include:

| Field | Purpose |
| --- | --- |
| `attestation` | Signed `ValidationAttestation` over the bundle and checks. |
| `graph` | Trust graph snapshot for UI or downstream trust policy. |
| `anchor` | Optional on-chain attestation anchor. |
| `validator` | Validator endpoint or agent identity used. |

## Minimal Validation Envelope

A compact interoperable response could look like this:

```json
{
  "intent": {
    "intentType": "quote",
    "requestedReference": "John 3:16",
    "requestedEdition": "bsb",
    "agentRunId": "run_123",
    "outputId": "answer_1"
  },
  "agent": {
    "agentId": "eip155:31337:0x...",
    "agentName": "scripture-resolver.agent"
  },
  "content": {
    "canonicalId": "0x...",
    "canonicalEnvelope": {},
    "scheme": "scripture.verse",
    "descriptorId": "desc_bsb_...",
    "descriptor": {},
    "issuer": "0x...",
    "issuerName": "bsb.agent",
    "edition": "bsb",
    "accessPolicy": "public"
  },
  "proof": {
    "commitment": {
      "value": "0x...",
      "algorithm": "sha-256",
      "normalization": "..."
    },
    "commitmentVerified": true,
    "corpusRef": "0x...",
    "corpusRoot": "0x...",
    "inclusionProof": ["0x..."],
    "leafIndex": 0,
    "zkMembership": {
      "proof": {},
      "publicSignals": ["123...", "456..."]
    }
  },
  "policy": {
    "policyProfile": "public-domain-demo",
    "policyDecision": "allow",
    "entitlement": null
  },
  "citation": {
    "type": ["VerifiableCredential", "CitationAssertion"],
    "credentialSubject": {},
    "proof": {}
  },
  "response": {
    "text": "For God so loved the world...",
    "responseHash": "0x...",
    "quotedSpans": [
      {
        "start": 0,
        "end": 29,
        "descriptorId": "desc_bsb_..."
      }
    ]
  },
  "validation": {
    "outcome": "validated",
    "attestation": {
      "type": ["VerifiableCredential", "ValidationAttestation"],
      "credentialSubject": {},
      "proof": {}
    },
    "graph": {
      "nodes": [],
      "edges": []
    },
    "anchor": {
      "onchain": true,
      "attestationHash": "0x..."
    }
  }
}
```

## Validation Outcomes

```mermaid
flowchart TD
  Bundle["Agent response + evidence bundle"]
  Shape{"Schema valid?"}
  Identity{"Agent and issuer signatures valid?"}
  Reference{"Canonical reference valid?"}
  Descriptor{"Descriptor admitted by trust profile?"}
  Corpus{"Merkle proof / corpus root valid?"}
  ZK{"ZK membership valid?"}
  Text{"Text commitment matches?"}
  Policy{"Policy and entitlement valid?"}
  Citation{"Citation signature matches response?"}
  Attestation{"ValidationAttestation signed?"}
  Anchor{"Anchor valid if present?"}
  Pass["Validated response"]
  Fail["Rejected or degraded trust"]

  Bundle --> Shape
  Shape -->|no| Fail
  Shape -->|yes| Identity
  Identity -->|no| Fail
  Identity -->|yes| Reference
  Reference -->|no| Fail
  Reference -->|yes| Descriptor
  Descriptor -->|no| Fail
  Descriptor -->|yes| Corpus
  Corpus -->|no| Fail
  Corpus -->|yes| ZK
  ZK -->|no| Fail
  ZK -->|yes| Text
  Text -->|no| Fail
  Text -->|yes| Policy
  Policy -->|no| Fail
  Policy -->|yes| Citation
  Citation -->|no| Fail
  Citation -->|yes| Attestation
  Attestation -->|no| Fail
  Attestation -->|yes| Anchor
  Anchor -->|no| Fail
  Anchor -->|yes| Pass
```

## How Other Translation Agents Use This

Other agents can bring their own translation workflows, models, retrieval systems, or publisher integrations. They do not need to copy this app. They need to emit the common trust artifacts.

At minimum, a compatible translation agent should:

1. Resolve user references into canonical ids using the relevant domain extension.
2. Use issuer-signed descriptors for the content it references.
3. Retrieve text through policy-aware paths.
4. Verify the retrieved text against descriptor commitments.
5. Include Merkle inclusion proof and corpus root evidence.
6. Generate a ZK membership proof when the validator profile requires query privacy.
7. Respect entitlements for licensed/private content.
8. Sign a citation assertion for the exact response it produced.
9. Return a validation envelope that third-party validators can check.
10. Preserve the signed `ValidationAttestation`, trust graph, and optional anchor returned by the validator.

If the agent produces a new translation, paraphrase, or generated rendering, it should also include:

- The source descriptors it used.
- The transformation intent, such as translation, simplification, summary, or comparison.
- The generated output hash.
- The model or agent identity that produced it.
- A signed assertion distinguishing source quotation from generated rendering.
- Any reviewer, publisher, or validator attestations attached to the generated output.

## Why This Matters

This creates portable agentic trust. A user, platform, publisher, or ministry organization does not have to trust a single app's internal database. They can ask an independent validator to check the evidence.

The validator can answer:

- Was this the right canonical reference?
- Who issued the content claim?
- Did the issuer's name resolve to the expected agent identity?
- Was the descriptor part of the claimed corpus?
- Did the text match the commitment?
- Did the ZK proof show membership in the issuer corpus without revealing the leaf?
- Was access allowed under policy?
- Did the responding agent sign the citation?
- Does the citation match the actual response?
- Did the validator sign the validation outcome?
- Does the trust graph show the scope of trust?
- Was the attestation anchored on-chain when configured?

That is the difference between content access and agentic trust.
