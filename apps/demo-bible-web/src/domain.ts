// White-label / vertical literals — centralized here per ADR-0021. ALL
// branding + copy lives in one module; the rest of the app reads from it.

export const BRANDING = {
  name: 'Verse Lookup',
  tagline: 'Scripture by reference + translation, with verifiable provenance',
  footer:
    'Public-domain text only (Berean Standard Bible, CC0). Trust comes from the issuer’s signature + a content commitment — never a platform claim.',
};

export const COPY = {
  pickPassage: 'Choose a passage',
  edition: 'Translation',
  book: 'Book',
  chapter: 'Chapter',
  verse: 'Verse',
  lookup: 'Get verse',
  provenance: 'Provenance',
  verified: 'Verified',
  notVerified: 'Not verified',
  licensedBlocked: 'This translation is licensed — retrieval requires an entitlement.',
  issueEntitlement: 'Issue a demo entitlement',
  citation: 'Citation record',
};

// The a2a agent base path (Vite dev-proxied to the a2a worker).
export const A2A_BASE = '/a2a';
