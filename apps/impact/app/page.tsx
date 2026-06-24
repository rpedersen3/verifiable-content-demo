"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/context/session";
import EntryExperience from "@/components/EntryExperience";
import HomeResolvedView from "@/components/onboarding/HomeResolvedView";

export default function LandingGate() {
  const { phase, justConnected } = useSession();
  const router = useRouter();

  useEffect(() => {
    // A RESTORED session (page reload) goes straight in. A connect THIS session pauses on
    // the welcome beat (justConnected) until the member taps "Enter your home".
    if (phase === "authed" && !justConnected) router.replace("/home");
  }, [phase, justConnected, router]);

  if (phase === "anon") return <EntryExperience />;
  if (phase === "authed" && justConnected) return <HomeResolvedView />;

  // restoring / about-to-redirect
  return (
    <div className="entry">
      <div className="muted">Opening your home…</div>
    </div>
  );
}
