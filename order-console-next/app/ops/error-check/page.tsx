import { notFound } from "next/navigation";
import { connection } from "next/server";

// 오류 추적 연결 확인용 서버 컴포넌트(31). OPS_ERROR_CHECK=1일 때만 일부러 오류를 던진다(그 밖에는 404).
// 웹 e2e가 가짜 수집 서버로, 사람이 실제 DSN을 붙인 뒤 한 번 열어 이벤트가 오는지 볼 때 쓴다
export default async function ErrorCheckPage() {
  await connection();
  if (process.env.OPS_ERROR_CHECK !== "1") notFound();
  throw new Error("오류 추적 확인: 서버 컴포넌트에서 던진 오류 (연락처 010-2345-6789, kim.customer@example.com)");
}
