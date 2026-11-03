import type { Metadata } from "next";
import {
  Cormorant_Garamond,
  Gothic_A1,
  IBM_Plex_Mono,
  IBM_Plex_Sans_KR,
  Instrument_Serif,
  Inter,
  Noto_Sans_KR,
  Noto_Serif_KR,
  Plus_Jakarta_Sans,
  Space_Grotesk,
} from "next/font/google";
import { connection } from "next/server";
import { Suspense } from "react";
import { getStoreInfo } from "@/lib/store-cache";
import { Nav } from "./nav";
import { OnlineBanner } from "./online-banner";
import { Providers } from "./providers";
import { StoreFooter } from "./store-footer";
import { StoreFooterWrapper } from "./store-footer-wrapper";
import { SwRegister } from "./sw-resgister";
import "./globals.css";

const body = Noto_Sans_KR({
  variable: "--font-body",
  weight: ["300", "400", "500", "700"],
  preload: false,
  display: "swap",
});
const display = Noto_Serif_KR({
  variable: "--font-display",
  weight: ["400", "600"],
  preload: false,
  display: "swap",
});
const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  preload: false,
  display: "swap",
});
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  preload: false,
  display: "swap",
});
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  preload: false,
  display: "swap",
});
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  preload: false,
  display: "swap",
});
const gothicA1 = Gothic_A1({
  variable: "--font-gothic-a1",
  weight: ["300", "400", "500", "600"],
  preload: false,
  display: "swap",
});
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  preload: false,
  display: "swap",
});
const ibmSansKr = IBM_Plex_Sans_KR({
  variable: "--font-ibm-sans-kr",
  weight: ["300", "400", "500", "600"],
  preload: false,
  display: "swap",
});
const ibmMono = IBM_Plex_Mono({
  variable: "--font-ibm-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  preload: false,
  display: "swap",
});

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

const fontVariables = [
  body.variable,
  display.variable,
  cormorant.variable,
  jakarta.variable,
  instrumentSerif.variable,
  inter.variable,
  gothicA1.variable,
  spaceGrotesk.variable,
  ibmSansKr.variable,
  ibmMono.variable,
].join(" ");

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <html lang="ko" className={`${fontVariables} h-full antialiased`}>
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
