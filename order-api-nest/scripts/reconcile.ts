// PG 대사를 손으로 돌린다: npm run payments:reconcile -- --date=YYYY-MM-DD   (날짜를 빼면 어제, Asia/Seoul)
// 리더 작업(매일 04:00)과 같은 코드를 부른다. 결과 미상 환불 확정 → provider별 대사 → 불일치 upsert.
// 같은 날을 여러 번 돌려도 불일치 집합이 같다. provider 하나라도 실패하면 종료 코드 1(나머지 provider는 대사한다)
// 이미 설정된 환경변수(DATABASE_URL, TOSS_SECRET_KEY 등)는 .env보다 앞선다
import { existsSync } from "node:fs";
import { PaymentGateways } from "../src/payments/payment-gateways.js";
import { RefundsService } from "../src/payments/refunds.service.js";
import { StripeGateway } from "../src/payments/stripe.gateway.js";
import { TossGateway } from "../src/payments/toss.gateway.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { ReconciliationService, kstDate } from "../src/reconciliation/reconciliation.service.js";

if (existsSync(".env")) process.loadEnvFile();
const arg = process.argv.find((a) => a.startsWith("--date="));
const date = arg?.split("=")[1] ?? kstDate(new Date(), 1);

const prisma = new PrismaService();
const gateways = new PaymentGateways(new StripeGateway(), new TossGateway());
try {
  const result = await new ReconciliationService(prisma, gateways, new RefundsService(prisma, gateways)).run(date);
  if (result.refunds) console.log(`환불 확정: 확인 ${result.refunds.checked}건, succeeded ${result.refunds.succeeded}, failed ${result.refunds.failed}, 보류 ${result.refunds.pending}`);
  if (result.runs.length === 0) console.log("켜진 PG가 없어 대사할 것이 없다");
  for (const r of result.runs) {
    console.log(r.error ? `대사 ${date} ${r.provider}: 실패 - ${r.error} (run #${r.runId})` : `대사 ${date} ${r.provider}: PG ${r.pgCount}건, 우리 ${r.dbCount}건, 불일치 ${r.issueCount}건 (run #${r.runId})`);
  }
  if (result.failed) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
