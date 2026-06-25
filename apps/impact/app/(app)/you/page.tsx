"use client";

// `/you` is superseded by Profile management (Account dropdown → Profile). Redirect.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function YouRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/profile"); }, [router]);
  return null;
}
