"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/context/session";
import EntryExperience from "@/components/EntryExperience";
import HomeResolvedView from "@/components/onboarding/HomeResolvedView";
import AuthorizeCeremony from "@/components/onboarding/AuthorizeCeremony";
import { parseEnrollReq, loadPendingEnroll, type EnrollReq } from "@/lib/enroll";

export default function LandingGate() {
  const { phase, justConnected } = useSession();
  const router = useRouter();

  // A relying-app authorize request (`/?client_id=…`), or the resume of one across the social
  // IdP round-trip (stashed, since the return strips the query). Determined AFTER mount — reading
  // window.location during render would diverge from SSR (hydration error #418). `undefined` = not
  // yet determined (matches the server render); `null` = not an authorize request.
  const [enroll, setEnroll] = useState<EnrollReq | null | undefined>(undefined);
  useEffect(() => { setEnroll(parseEnrollReq() ?? loadPendingEnroll()); }, []);

  useEffect(() => {
    if (enroll === undefined) return; // wait until the authorize check has run
    if (enroll) return; // authorize mode owns navigation — do NOT redirect into the home
    // A RESTORED session (page reload) goes straight in. A connect THIS session pauses on
    // the welcome beat (justConnected) until the member taps "Enter your home".
    if (phase === "authed" && !justConnected) router.replace("/home");
  }, [enroll, phase, justConnected, router]);

  if (enroll === undefined) return <div className="entry"><div className="muted">Opening your home…</div></div>;
  if (enroll) return <AuthorizeCeremony enroll={enroll} />;
  if (phase === "anon") return <EntryExperience />;
  if (phase === "authed" && justConnected) return <HomeResolvedView />;

  // restoring / about-to-redirect
  return (
    <div className="entry">
      <div className="muted">Opening your home…</div>
    </div>
  );
}
