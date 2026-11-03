import type { Metadata } from "next";
import { Noto_Sans_KR, Noto_Serif_KR } from "next/font/google";
import { Providers } from './providers';
import { Nav } from './nav';
import { connection } from "next/server";
import { SwRegister } from './sw-resgister';
import { OnlineBanner } from "./online-banner";
import { StoreFooter } from "./store-footer";
import { StoreFooterWrapper } from "./store-footer-wrapper";
import { getStoreInfo } from "@/lib/store-cache";
import { Suspense } from "react";
import "./globals.css";

const body = Noto_Sans_KR({ variable: "--font-body", weight: ["300", "400", "500"], preload: false, display: "swap" });
const display = Noto_Serif_KR({ variable: "--font-display", weight: ["400"], preload: false, display: "swap" });

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  let title = "Store";
  try {
    const info = await getStoreInfo();
    if (info?.storeName) title = info.storeName;
  } catch {}
  return {
    title,
    description: "상품 주문·결제와 실시간 알림을 다루는 서비스",
  };
}

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
          <StoreFooterWrapper>
            <Suspense fallback={null}>
              <StoreFooter />
            </Suspense>
          </StoreFooterWrapper>
        </Providers>
      </body>
    </html>
  );
}
