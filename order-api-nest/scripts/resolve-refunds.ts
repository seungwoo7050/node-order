// 결과를 모르는 환불(requested)을 PG 재조회로 확정한다: npm run payments:resolve-refunds [-- --older-than=<초>]
// 기본은 5분보다 오래된 requested만 본다(지금 PG를 부르는 중인 환불을 건드리지 않게). 여러 번 돌려도 같다.
// 이미 설정된 환경변수(DATABASE_URL, TOSS_SECRET_KEY 등)는 .env보다 앞선다
import { existsSync } from "node:fs";
import { PaymentGateways } from "../src/payments/payment-gateways.js";
import { resolveStaleRefunds } from "../src/payments/refund-resolver.js";
import { RefundsService } from "../src/payments/refunds.service.js";
import { StripeGateway } from "../src/payments/stripe.gateway.js";
import { TossGateway } from "../src/payments/toss.gateway.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

if (existsSync(".env")) process.loadEnvFile();
const arg = process.argv.find((a) => a.startsWith("--older-than="));
const olderThanSeconds = Number(arg?.split("=")[1] ?? 300);
if (!Number.isFinite(olderThanSeconds) || olderThanSeconds < 0) throw new Error(`--older-than는 0 이상의 초입니다: ${arg}`);

const prisma = new PrismaService();
const gateways = new PaymentGateways(new StripeGateway(), new TossGateway());
try {
  const result = await resolveStaleRefunds({ prisma, gateways, refunds: new RefundsService(prisma, gateways) }, { olderThanMs: olderThanSeconds * 1000 });
  console.log(`환불 확정: 확인 ${result.checked}건, succeeded ${result.succeeded}, failed ${result.failed}, 보류 ${result.pending} (${olderThanSeconds}초보다 오래된 requested)`);
  if (result.pending > 0) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
