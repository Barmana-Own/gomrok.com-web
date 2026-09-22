import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const vazirmatn = localFont({
  src: "./fonts/Vazirmatn-wght.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: true,
  variable: "--font-vazirmatn",
  fallback: ["IRANSansX", "Tahoma", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  title: "گمرک | سامانه هوشمند مدیریت تشریفات گمرکی",
  description:
    "سامانه‌ای هوشمند برای مدیریت تشریفات گمرکی، کنترل جریان کالا، ارزیابی ریسک و تسریع ترخیص با دید لحظه‌ای و داده‌های یکپارچه.",
  icons: {
    icon: "/icon.jpg",
    shortcut: "/icon.jpg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" className={vazirmatn.variable}>
      <head>
        <link
          rel="preload"
          as="image"
          href="https://terminal-industries.com/static/frames/home/desktop/webp/hero_anim_desktop_60_0.webp"
          fetchPriority="high"
          media="(min-width: 801px)"
        />
        <link
          rel="preload"
          as="image"
          href="https://terminal-industries.com/static/frames/home/mobile/webp/hero_anim_mobile_60_0.webp"
          fetchPriority="high"
          media="(max-width: 800px)"
        />
        <link
          rel="preload"
          as="video"
          href="https://a.storyblok.com/f/337048/x/f0f51ea10f/vid_3-1_prerender_1.mp4"
          type="video/mp4"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
