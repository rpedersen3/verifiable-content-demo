import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "@/context/session";

export const metadata: Metadata = {
  title: "Impact — your agent home",
  description:
    "A faith-based home where people and organizations connect and steward their agents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
