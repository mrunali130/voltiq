import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VoltIQ",
  description: "Smart 4-Channel IoT Energy Meter",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="application-name" content="VoltIQ" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="VoltIQ" />
        <meta name="theme-color" content="#0070f3" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/icon.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/icon.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icon.png" />
        <link rel="apple-touch-icon" sizes="167x167" href="/icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icon.png" />
      </head>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}