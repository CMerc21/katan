import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Katan",
  description: "A hex settlement-building game for 3 to 4 friends",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full bg-parchment text-ink antialiased">{children}</body>
    </html>
  );
}
