"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/context/session";
import EntryExperience from "@/components/EntryExperience";
import HomeResolvedView from "@/components/onboarding/HomeResolvedView";
import AuthorizeCeremony from "@/components/onboarding/AuthorizeCeremony";
import { parseEnrollReq, loadPendingEnroll } from "@/lib/enroll";

export default function LandingGate() {
  const { phase, justConnected } = useSession();
  const router = useRouter();

  // A relying-app authorize request (`/?client_id=…`), or the resume of one across the social
  // IdP round-trip (stashed, since the return strips the query). When present, this owns the
  // page — do NOT redirect into the home.
  const enroll = useMemo(() => parseEnrollReq() ?? loadPendingEnroll(), []);

  useEffect(() => {
    if (enroll) return; // authorize mode owns navigation
    // A RESTORED session (page reload) goes straight in. A connect THIS session pauses on
    // the welcome beat (justConnected) until the member taps "Enter your home".
    if (phase === "authed" && !justConnected) router.replace("/home");
  }, [enroll, phase, justConnected, router]);

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
