"use client";

// ============================================================================
// Session + active-context.
//
// Connect is REAL now (spec parity with demo-sso-next): passkey and wallet/SIWE
// run the actual WebAuthn / SIWE ceremony against the live demo-a2a relayer + the
// ported broker routes (/connect/*, /me), producing a real Smart Agent + a signed
// AgentSession. `identity` holds that real connected agent.
//
// The seeded `person` (orgs / vault / treasury / trust-graph content) is retained
// as labeled demo content layered under the real identity until those surfaces are
// wired to the live vault.
//
// "Active context": act AS YOURSELF (person) or AS CUSTODIAN of an org you steward.
// ============================================================================

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import { PERSON } from "@/lib/seed";
import type { Address, Person } from "@/lib/types";
import { nameLabel } from "@/lib/domain";
import { connectPasskey, connectWalletSiwe, exchangeCode, startGoogleSignIn, startYouVersionSignIn } from "@/lib/connect";

export type Via = "passkey" | "wallet" | "google" | "youversion";
export type Phase = "restoring" | "anon" | "authed";

/** The real connected agent. */
export interface Identity {
  address: string;
  name: string | null;
  deployed: boolean;
  via: Via;
}

export type ActiveContext = { mode: "person" } | { mode: "org"; orgId: string };

interface SessionState {
  phase: Phase;
  /** real connected agent (from the live ceremony). */
  identity: Identity | null;
  /** seeded demo content backing the org/vault/treasury/graph surfaces. */
  person: Person | null;
  token: string | null;
  active: ActiveContext;
  defaultOrgId: string | null;
  /** Set right after a connect THIS session (not a restored session) so the gate can show
   *  the onboarding welcome beat. `fresh` = a brand-new home vs a reconnect (welcome back). */
  justConnected: { fresh: boolean } | null;
}

interface SessionApi extends SessionState {
  /** Run the real connect ceremony. `onStep` receives progress messages. Resolves to an
   *  error string on failure, null on success. */
  signIn: (via: Via, nameHint?: string, onStep?: (s: string) => void) => Promise<string | null>;
  signOut: () => void;
  setActive: (ctx: ActiveContext) => void;
  setDefaultOrg: (orgId: string | null) => void;
  /** Dismiss the welcome beat (the gate calls this when the member enters their home). */
  clearJustConnected: () => void;
}

const KEY = "impact.session.v2";
const SessionCtx = createContext<SessionApi | null>(null);

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Render the home for the REAL connected agent: overlay its name/handle/address onto
 *  the seeded person (the orgs/vault/treasury content stays demo data for now, but the
 *  identity surfaces — greeting, You card, topbar — reflect who actually connected). */
function personFromIdentity(id: Identity): Person {
  const label = id.name ? nameLabel(id.name) : shortAddr(id.address);
  return {
    ...PERSON,
    handle: label,
    name: id.name ? label : "Your agent",
    agentName: id.name ?? shortAddr(id.address),
    address: id.address as Address,
    deployed: id.deployed,
    blurb: id.name ? `${id.name} · your home` : "your home",
    // Real connected agent: it has its OWN (initially empty) data — not the seed's.
    // Balances come live from chain (useAgentBalances); orgs/vault/etc. are empty until
    // the agent actually has them. No assessment yet → no trust meter.
    trust: undefined,
    custodyOf: [],
    membershipIds: [],
    defaultOrgId: null,
    entitlements: [],
    delegations: [],
    vaultRecords: [],
    attestations: [],
    treasury: { ownerId: id.address, address: id.address as Address, balanceUsdc: 0, mandates: [] },
    pii: {
      legalName: id.name ?? label,
      preferredName: label,
      email: "",
      visibility: { preferredName: "public", legalName: "restricted" },
    },
  };
}

interface Persisted {
  token: string;
  identity: Identity;
  defaultOrgId: string | null;
  active: ActiveContext;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({
    phase: "restoring", identity: null, person: null, token: null,
    active: { mode: "person" }, defaultOrgId: null, justConnected: null,
  });

  useEffect(() => {
    // Social return: the OIDC callback redirects back to `/?code=…&via=…`. Exchange it.
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      const via = (params.get("via") as Via) || "google";
      window.history.replaceState({}, "", window.location.pathname);
      void (async () => {
        const out = await exchangeCode(code, via);
        if (!out.ok) { setState((s) => ({ ...s, phase: "anon" })); return; }
        const identity: Identity = { address: out.address, name: out.name, deployed: out.deployed, via };
        const active: ActiveContext = { mode: "person" };
        try { localStorage.setItem(KEY, JSON.stringify({ token: out.token, identity, defaultOrgId: null, active })); } catch { /* ignore */ }
        // Social return = a connect this session → show the welcome beat.
        setState({ phase: "authed", identity, person: personFromIdentity(identity), token: out.token, defaultOrgId: null, active, justConnected: { fresh: out.fresh } });
      })();
      return;
    }
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) { setState((s) => ({ ...s, phase: "anon" })); return; }
      const p = JSON.parse(raw) as Persisted;
      // Restored session (page reload while logged in) → no welcome beat.
      setState({
        phase: "authed", identity: p.identity, person: personFromIdentity(p.identity), token: p.token,
        defaultOrgId: p.defaultOrgId ?? null, justConnected: null,
        active: p.active ?? (p.defaultOrgId ? { mode: "org", orgId: p.defaultOrgId } : { mode: "person" }),
      });
    } catch {
      setState((s) => ({ ...s, phase: "anon" }));
    }
  }, []);

  const persist = useCallback((next: Persisted) => {
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const signIn = useCallback(
    async (via: Via, nameHint?: string, onStep?: (s: string) => void): Promise<string | null> => {
      if (via === "google") { startGoogleSignIn(); return await new Promise<string | null>(() => {}); }
      if (via === "youversion") { startYouVersionSignIn(); return await new Promise<string | null>(() => {}); }
      const out = via === "passkey" ? await connectPasskey(nameHint, onStep) : await connectWalletSiwe(nameHint, onStep);
      if (!out.ok) return out.error;
      const identity: Identity = { address: out.address, name: out.name, deployed: out.deployed, via };
      const active: ActiveContext = { mode: "person" };
      persist({ token: out.token, identity, defaultOrgId: null, active });
      setState({ phase: "authed", identity, person: personFromIdentity(identity), token: out.token, defaultOrgId: null, active, justConnected: { fresh: out.fresh } });
      return null;
    },
    [persist],
  );

  const signOut = useCallback(() => {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    setState({ phase: "anon", identity: null, person: null, token: null, active: { mode: "person" }, defaultOrgId: null, justConnected: null });
  }, []);

  const clearJustConnected = useCallback(() => {
    setState((s) => ({ ...s, justConnected: null }));
  }, []);

  const setActive = useCallback((ctx: ActiveContext) => {
    setState((s) => {
      if (s.token && s.identity) persist({ token: s.token, identity: s.identity, defaultOrgId: s.defaultOrgId, active: ctx });
      return { ...s, active: ctx };
    });
  }, [persist]);

  const setDefaultOrg = useCallback((orgId: string | null) => {
    setState((s) => {
      const active: ActiveContext = orgId ? { mode: "org", orgId } : { mode: "person" };
      if (s.token && s.identity) persist({ token: s.token, identity: s.identity, defaultOrgId: orgId, active });
      return { ...s, defaultOrgId: orgId, active };
    });
  }, [persist]);

  const api = useMemo<SessionApi>(
    () => ({ ...state, signIn, signOut, setActive, setDefaultOrg, clearJustConnected }),
    [state, signIn, signOut, setActive, setDefaultOrg, clearJustConnected],
  );

  return <SessionCtx.Provider value={api}>{children}</SessionCtx.Provider>;
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}
