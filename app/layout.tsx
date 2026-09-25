import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Watch Party",
  description: "Watch home videos together, in sync, with a video call alongside.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
