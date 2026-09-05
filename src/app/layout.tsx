import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "График на работното време — БДЖ",
  description:
    "Съставяне, изчисляване и правна проверка на графици за работното време по Наредба № 50. Работи офлайн.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "График", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#e08600",
};

/** Прилага запазената тема преди първото рисуване, за да няма премигване. */
const THEME_BOOT = `try{var t=localStorage.getItem("grafik-theme");document.documentElement.dataset.theme=(t==="dark"||t==="light")?t:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bg" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
