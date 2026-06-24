"use client";

// ============================================================================
// Session + active-context.
// Phase 1: sign-in is stubbed (every entry method resolves to the seeded member,
// Grace). The real ceremonies (passkey / SIWE / Google / YouVersion via the live
// demo-a2a custody bridge) wire in behind this same interface in a later phase.
//
// "Active context" is the heart of the home: a person can act AS THEMSELVES
// (person-only) or AS A CUSTODIAN of one of their organizations. They may also
// pin a default org so they land in that context on arrival.
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { PERSON } from "@/lib/seed";
import type { Person } from "@/lib/types";

export type Via = "passkey" | "wallet" | "google" | "youversion";
export type Phase = "restoring" | "anon" | "authed";

/** Acting as yourself, or as custodian of a specific org. */
export type ActiveContext =
  | { mode: "person" }
  | { mode: "org"; orgId: string };

interface SessionState {
  phase: Phase;
  person: Person | null;
  via: Via | null;
  active: ActiveContext;
  /** the org the member pinned to land in (null = person home). */
  defaultOrgId: string | null;
}

interface SessionApi extends SessionState {
  signIn: (via: Via) => void;
  signOut: () => void;
  setActive: (ctx: ActiveContext) => void;
  setDefaultOrg: (orgId: string | null) => void;
}

const KEY = "impact.session.v1";

const SessionCtx = createContext<SessionApi | null>(null);

interface Persisted {
  via: Via;
  defaultOrgId: string | null;
  active: ActiveContext;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({
    phase: "restoring",
    person: null,
    via: null,
    active: { mode: "person" },
    defaultOrgId: null,
  });

  // Restore on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) {
        setState((s) => ({ ...s, phase: "anon" }));
        return;
      }
      const p = JSON.parse(raw) as Persisted;
      setState({
        phase: "authed",
        person: PERSON,
        via: p.via,
        defaultOrgId: p.defaultOrgId ?? null,
        active: p.active ?? (p.defaultOrgId ? { mode: "org", orgId: p.defaultOrgId } : { mode: "person" }),
      });
    } catch {
      setState((s) => ({ ...s, phase: "anon" }));
    }
  }, []);

  const persist = useCallback((next: Persisted) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const signIn = useCallback(
    (via: Via) => {
      const active: ActiveContext = PERSON.defaultOrgId
        ? { mode: "org", orgId: PERSON.defaultOrgId }
        : { mode: "person" };
      const defaultOrgId = PERSON.defaultOrgId;
      persist({ via, defaultOrgId, active });
      setState({ phase: "authed", person: PERSON, via, active, defaultOrgId });
    },
    [persist],
  );

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setState({ phase: "anon", person: null, via: null, active: { mode: "person" }, defaultOrgId: null });
  }, []);

  const setActive = useCallback(
    (ctx: ActiveContext) => {
      setState((s) => {
        if (s.via) persist({ via: s.via, defaultOrgId: s.defaultOrgId, active: ctx });
        return { ...s, active: ctx };
      });
    },
    [persist],
  );

  const setDefaultOrg = useCallback(
    (orgId: string | null) => {
      setState((s) => {
        const active: ActiveContext = orgId ? { mode: "org", orgId } : { mode: "person" };
        if (s.via) persist({ via: s.via, defaultOrgId: orgId, active });
        return { ...s, defaultOrgId: orgId, active };
      });
    },
    [persist],
  );

  const api = useMemo<SessionApi>(
    () => ({ ...state, signIn, signOut, setActive, setDefaultOrg }),
    [state, signIn, signOut, setActive, setDefaultOrg],
  );

  return <SessionCtx.Provider value={api}>{children}</SessionCtx.Provider>;
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}
