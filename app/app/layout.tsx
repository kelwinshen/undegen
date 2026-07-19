import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./components/providers";
import PixelBlastWrapper from "./components/PixelBlastWrapper";
import Navbar from "./components/Navbar";
import BottomNavbar from "./components/BottomNavbar";
import StickyChat from "./components/StickyChat";
import PixelTransition from "./components/PixelTransition";
import Footer from "./components/Footer";

export const metadata: Metadata = {
  title: "Undegen | Risk-free Betting Platform",
  description:
    "Win big or lose nothing. The daily football prediction syndicate.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Montserrat:wght@100..900&display=swap"
          rel="stylesheet"
        />
      </head>
      <Providers>
        <body suppressHydrationWarning className="antialiased">
          <PixelTransition />
          <div className="fixed inset-0 -z-10 w-full h-full">
            <PixelBlastWrapper />
          </div>
          <Navbar />
          {children}
          <StickyChat />
          <Footer />
          <BottomNavbar />
        </body>
      </Providers>
    </html>
  );
}
