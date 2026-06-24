"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/context/session";
import EntryExperience from "@/components/EntryExperience";

export default function LandingGate() {
  const { phase } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (phase === "authed") router.replace("/home");
  }, [phase, router]);

  if (phase === "anon") return <EntryExperience />;

  // restoring / about-to-redirect
  return (
    <div className="entry">
      <div className="muted">Opening your home…</div>
    </div>
  );
}
