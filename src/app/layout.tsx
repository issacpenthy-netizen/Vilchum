import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "VilChum — Every bottle counts", description: "Turn recycling into something that adds up." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="km"><body>{children}</body></html>;
}
