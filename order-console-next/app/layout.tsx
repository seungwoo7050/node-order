import type { Metadata } from "next";
import { Noto_Sans_KR, Noto_Serif_KR } from "next/font/google";
import { Providers } from './providers';
import { Nav } from './nav';
import { connection } from "next/server";
import { SwRegister } from './sw-resgister';
import { OnlineBanner } from "./online-banner";
import "./globals.css";

const body = Noto_Sans_KR({ variable: "--font-body", weight: ["300", "400", "500"], preload: false, display: "swap" });
const display = Noto_Serif_KR({ variable: "--font-display", weight: ["400"], preload: false, display: "swap" });

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
      className={`${body.variable} ${display.variable} h-full antialiased`}
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
