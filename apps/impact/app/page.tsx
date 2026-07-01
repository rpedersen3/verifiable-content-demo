"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/context/session";
import EntryExperience from "@/components/EntryExperience";
import HomeResolvedView from "@/components/onboarding/HomeResolvedView";
import AuthorizeCeremony from "@/components/onboarding/AuthorizeCeremony";
import { parseEnrollReq, loadPendingEnroll, type EnrollReq } from "@/lib/enroll";
import { isAllowedRelyingOrigin } from "@/lib/oidc-clients";

// Landing mode, resolved AFTER mount — reading window.location during render would diverge from
// SSR (hydration error #418). `loading` matches the server render until the client decides.
type Mode =
  | { kind: "loading" }
  | { kind: "logout" }
  | { kind: "enroll"; enroll: EnrollReq }
  | { kind: "normal" };

export default function LandingGate() {
  const { phase, justConnected, signOut } = useSession();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: "loading" });

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // Cross-origin SSO logout: a relying app's Disconnect redirects here (`?ac_logout=1&ac_return=…`)
    // so the home session is cleared too — otherwise localStorage keeps you recognized and the
    // relying app can never truly sign you out. Return only to a REGISTERED relying origin (CN-1).
    if (q.get("ac_logout") === "1") {
      setMode({ kind: "logout" });
      signOut();
      const ret = q.get("ac_return") || "";
      let dest = "/";
      try { if (ret && isAllowedRelyingOrigin(ret)) dest = ret; } catch { /* ignore */ }
      // Let signOut's fire-and-forget server logout start before we navigate away.
      setTimeout(() => window.location.replace(dest), 250);
      return;
    }
    // A relying-app authorize request (`/?client_id=…`), or the resume of one across the social
    // IdP round-trip (stashed, since the return strips the query).
    const e = parseEnrollReq() ?? loadPendingEnroll();
    setMode(e ? { kind: "enroll", enroll: e } : { kind: "normal" });
  }, [signOut]);

  useEffect(() => {
    if (mode.kind !== "normal") return; // logout/enroll modes own navigation
    // A RESTORED session (page reload) goes straight in. A connect THIS session pauses on
    // the welcome beat (justConnected) until the member taps "Enter your home".
    if (phase === "authed" && !justConnected) router.replace("/home");
  }, [mode, phase, justConnected, router]);

  if (mode.kind === "loading") return <div className="entry"><div className="muted">Opening your home…</div></div>;
  if (mode.kind === "logout") return <div className="entry"><div className="muted">Signing out…</div></div>;
  if (mode.kind === "enroll") return <AuthorizeCeremony enroll={mode.enroll} />;
  if (phase === "anon") return <EntryExperience />;
  if (phase === "authed" && justConnected) return <HomeResolvedView />;

  // restoring / about-to-redirect
  return (
    <div className="entry">
      <div className="muted">Opening your home…</div>
    </div>
  );
}
