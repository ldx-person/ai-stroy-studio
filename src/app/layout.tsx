import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { QueryProvider } from "@/lib/query-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "小说创作助手 - AI智能写作伙伴",
  description: "专业的小说写作工具，支持AI续写、智能标题生成，让创作更轻松",
  keywords: ["小说创作", "AI写作", "写作工具", "网络小说", "创作助手"],
  authors: [{ name: "Z.ai Team" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "小说创作助手",
    description: "AI智能写作伙伴，让创作更轻松",
    url: "https://chat.z.ai",
    siteName: "小说创作助手",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "小说创作助手",
    description: "AI智能写作伙伴，让创作更轻松",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <QueryProvider>
          {children}
          <Toaster />
        </QueryProvider>
      </body>
    </html>
  );
}
