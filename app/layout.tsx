import type { Metadata } from "next";
import { Barlow, Source_Sans_3 } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const display = Barlow({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600", "700"],
  variable: "--font-barlow",
});

const body = Source_Sans_3({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "600"],
  variable: "--font-source",
});

export const metadata: Metadata = {
  title: {
    default: "DámeDíly.cz",
    template: "%s · DámeDíly.cz",
  },
  description: "Autodíly s ruční kontrolou technika a písemnou zárukou.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="cs" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-screen antialiased">
        <div className="flex min-h-screen flex-col">
          <SiteHeader />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
