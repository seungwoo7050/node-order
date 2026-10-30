import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const storage = process.env.NEXT_PUBLIC_STORAGE_URL ?? "http://localhost:9000";
  // 토스페이먼츠 결제위젯: SDK 스크립트(js), 위젯·결제창 iframe과 SDK의 API 호출(*.tosspayments.com)
  // SDK는 코드에서 붙이므로 'strict-dynamic'이 허용한다. 주소는 'strict-dynamic'을 모르는 옛 브라우저를 위해 둔다
  const tossScript = "https://js.tosspayments.com";
  const toss = "https://*.tosspayments.com";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${tossScript}${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' blob: data: ${storage}`,
    "font-src 'self'",
    `connect-src 'self' ${api} ${storage} ${toss}`,
    `frame-src ${toss}`,
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  // 상품 모달의 가로채기 경로(@modal/(.)[id])는 /shop/:id 모양을 모두 가로챈다(next-url 헤더가 조건).
  // /shop/search는 상품이 아니므로 그 헤더를 지워 /shop에서 넘어와도 결과 페이지를 그대로 그린다.
  // 미리 가져오기 요청은 이 proxy를 거치지 않으므로 /shop/search로 가는 Link는 prefetch={false}로 둔다
  if (request.nextUrl.pathname === "/shop/search") requestHeaders.delete("next-url");
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};