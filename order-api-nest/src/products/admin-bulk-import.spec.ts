import { BadGatewayException } from "@nestjs/common";
import { AdminPolicyRagController } from "./admin-bulk-import.controller.js";

describe("AdminPolicyRagController (citeguard Qdrant Hybrid RAG 연동)", () => {
  const originalFetch = global.fetch;
  const originalCiteguardUrl = process.env.CITEGUARD_URL;
  const originalPulseboxUrl = process.env.PULSEBOX_URL;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalCiteguardUrl === undefined) {
      delete process.env.CITEGUARD_URL;
    } else {
      process.env.CITEGUARD_URL = originalCiteguardUrl;
    }
    if (originalPulseboxUrl === undefined) {
      delete process.env.PULSEBOX_URL;
    } else {
      process.env.PULSEBOX_URL = originalPulseboxUrl;
    }
  });

  it("syncPolicy는 citeguard /v1/documents/sync로 SHA-256 청크 증분 동기화 요청을 위임한다", async () => {
    process.env.CITEGUARD_URL = "http://citeguard.internal:8003";
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return new Response(
        JSON.stringify({
          source_key: "policy:return-7days",
          version_hash: "a1b2c3d4",
          total_chunks: 2,
          inserted_chunks: 2,
          unchanged_chunks: 0,
          deleted_chunks: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const ctrl = new AdminPolicyRagController();
    const result = await ctrl.syncPolicy({
      sourceKey: "policy:return-7days",
      title: "교환 및 반품 안내 (전자상거래법 제17조)",
      rawText: "배송 완료 후 7일 이내 반품 신청이 가능하며 단순 변심 시 왕복 배송비 6,000원이 공제됩니다.",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://citeguard.internal:8003/v1/documents/sync");
    expect(calls[0].body).toMatchObject({
      source_key: "policy:return-7days",
      title: "교환 및 반품 안내 (전자상거래법 제17조)",
      source_uri: "node-order://policies/policy:return-7days",
      chunk_size: 320,
      chunk_overlap: 48,
    });
    expect(result.inserted_chunks).toBe(2);
  });

  it("askPolicy는 citeguard /v1/ask로 Hybrid RRF + Faithfulness Gate 질의를 전달하고, 장애 시 pulsebox에 보고한다", async () => {
    process.env.CITEGUARD_URL = "http://citeguard.internal:8003";
    process.env.PULSEBOX_URL = "http://pulsebox.internal:8000";

    const ctrl = new AdminPolicyRagController();
    global.fetch = (async () => {
      return new Response(
        JSON.stringify({
          status: "answered",
          answer: "단순 변심 반품은 배송 완료 후 7일 이내 가능하며 왕복 배송비 6,000원이 차감됩니다.",
          faithfulness_score: 0.94,
          citations: [{ chunk_id: "c1", source_key: "policy:return-7days", rrf_score: 0.032 }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const okRes = await ctrl.askPolicy({ question: "단순 변심 반품 기한과 배송비는?" });
    expect(okRes.status).toBe("answered");
    expect(okRes.faithfulness_score).toBe(0.94);

    const pulseboxCalls: string[] = [];
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("pulsebox.internal")) {
        pulseboxCalls.push(url);
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      throw new Error("ECONNREFUSED citeguard:8003");
    }) as typeof fetch;

    await expect(ctrl.askPolicy({ question: "환불 규정" })).rejects.toBeInstanceOf(BadGatewayException);
    expect(pulseboxCalls).toEqual(["http://pulsebox.internal:8000/v1/events"]);
  });
});
