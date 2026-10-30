// MCP 개인 접근 토큰을 터미널에서 발급한다(관리자 화면 /admin/mcp의 "토큰 발급"과 같다. 화면 없이 MCP 클라이언트를 붙일 때):
//   npm run mcp:token -- --user=kim [--scopes=read,write,pii] [--days=7] [--name=claude-code]
// 원문은 이때 한 번만 찍힌다(DB에는 해시만). 사용자는 관리자(admin) 또는 데모 관리자(read만)여야 한다.
// 이미 설정된 환경변수(DATABASE_URL)는 .env보다 앞선다
import { existsSync } from "node:fs";
import { AccessTokensService, MAX_EXPIRES_DAYS, SCOPES, type Scope } from "../src/mcp/access-tokens.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

if (existsSync(".env")) process.loadEnvFile();
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const userId = arg("user");
if (!userId) throw new Error("--user=<관리자 아이디>가 필요합니다");
const scopes = (arg("scopes") ?? "read").split(",").map((s) => s.trim()).filter(Boolean);
const bad = scopes.filter((s) => !(SCOPES as readonly string[]).includes(s));
if (bad.length) throw new Error(`모르는 범위: ${bad.join(", ")} (${SCOPES.join(", ")} 가운데)`);
const days = Number(arg("days") ?? 7);
if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRES_DAYS) throw new Error(`--days는 1~${MAX_EXPIRES_DAYS}일입니다`);

const prisma = new PrismaService();
try {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || (user.role !== "admin" && user.role !== "demo_admin")) throw new Error(`${userId}는 관리자가 아닙니다`);
  const issued = await new AccessTokensService(prisma).issue({ userId, role: user.role }, { name: arg("name") ?? "cli", scopes: scopes as Scope[], expiresInDays: days });
  console.error(`토큰 #${issued.id} 발급: 범위 ${issued.scopes.join(",")}, 만료 ${issued.expiresAt.toISOString()} (원문은 다시 볼 수 없다)`);
  console.log(issued.token);
} finally {
  await prisma.$disconnect();
}
