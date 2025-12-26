import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from './providers';
import { Nav } from './nav';
import { connection } from "next/server";
import { SwRegister } from './sw-resgister';
import { OnlineBanner } from "./online-banner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const instant = false;

export const metadata: Metadata = {
  title: "주문 콘솔",
  description: "상품 주문·결제와 실시간 알림을 다루는 학습용 서비스",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          <Nav />
          <SwRegister />
          <OnlineBanner />
          {children}
        </Providers>
      </body>
    </html>
  );
}
