import { API_URL, fetchWithAuth } from "./api-client";

export type SseEvent = { event: string; data: string };

// text/event-stream 조각을 이벤트로 나눈다. 조각 경계가 이벤트 중간에 걸려도 다음 조각과 이어 붙인다
export function createSseParser(onEvent: (e: SseEvent) => void): (chunk: string) => void {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.replace(/\r\n/g, "\n");
    let at: number;
    while ((at = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length > 0) onEvent({ event, data: data.join("\n") });
    }
  };
}

export type DraftResult = { ok: true } | { ok: false; message: string };

const message = (raw: string, fallback: string) => {
  try {
    return (JSON.parse(raw) as { message?: string }).message ?? fallback;
  } catch {
    return fallback;
  }
};

// POST /admin/products/:id/description-draft를 열어 받은 글 조각을 onText로 차례로 넘긴다.
// 저장은 하지 않는다(화면의 저장 버튼만 저장한다). signal을 abort하면 연결을 끊고, API가 공급자 호출을 끊는다
export async function streamDescriptionDraft(
  productId: number,
  keywords: string,
  { signal, onText }: { signal: AbortSignal; onText: (text: string) => void },
): Promise<DraftResult> {
  const res = await fetchWithAuth(`${API_URL}/admin/products/${productId}/description-draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ keywords }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    return { ok: false, message: message(body, `초안을 만들 수 없습니다 (${res.status})`) };
  }

  let result: DraftResult | null = null;
  const parse = createSseParser((e) => {
    if (e.event === "delta") onText((JSON.parse(e.data) as { text: string }).text);
    else if (e.event === "done") result = { ok: true };
    else if (e.event === "error") result = { ok: false, message: message(e.data, "초안을 만드는 중에 멈췄습니다.") };
  });
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parse(value);
  }
  return result ?? { ok: false, message: "초안을 받는 중에 연결이 끊겼습니다." };
}
