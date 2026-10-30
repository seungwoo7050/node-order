import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync, inflateSync } from "node:zlib";

// 가짜 오류 수집 서버(Sentry 호환 envelope 엔드포인트). 실제 Sentry·GlitchTip에 보내지 않고 SDK가 보낸 것을 받아 본다.
// envelope(https://develop.sentry.dev/sdk/data-model/envelopes/): 첫 줄이 envelope 헤더(JSON), 그다음 항목마다
// 항목 헤더 한 줄(JSON, type·length) + 내용. length가 있으면 그 바이트만큼, 없으면 다음 줄바꿈까지가 내용이다.
// 받는 주소: POST /api/<project_id>/envelope/ (SDK가 gzip으로 보낼 수 있다). 외부 의존성 없이 콘솔 e2e도 같이 쓴다
export type EnvelopeItem = { header: Record<string, unknown>; payload: unknown; raw: string };
export type Envelope = { header: Record<string, unknown>; items: EnvelopeItem[]; raw: string; path: string };

export function parseEnvelope(body: Buffer): Omit<Envelope, "path"> {
  let pos = 0;
  const line = () => {
    const end = body.indexOf(0x0a, pos);
    const stop = end === -1 ? body.length : end;
    const text = body.subarray(pos, stop).toString("utf8");
    pos = stop + 1;
    return text;
  };
  const header = JSON.parse(line()) as Record<string, unknown>;
  const items: EnvelopeItem[] = [];
  while (pos < body.length) {
    const headerLine = line();
    if (!headerLine.trim()) continue;
    const itemHeader = JSON.parse(headerLine) as Record<string, unknown>;
    let raw: string;
    if (typeof itemHeader.length === "number") {
      raw = body.subarray(pos, pos + itemHeader.length).toString("utf8");
      pos += itemHeader.length + 1;
    } else {
      raw = line();
    }
    let payload: unknown = raw;
    try {
      payload = JSON.parse(raw);
    } catch {
      // 첨부 같은 JSON이 아닌 내용은 글 그대로
    }
    items.push({ header: itemHeader, payload, raw });
  }
  return { header, items, raw: body.toString("utf8") };
}

export class FakeSentry {
  readonly envelopes: Envelope[] = [];
  private server?: Server;
  port = 0;

  async start(port = 0): Promise<this> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        if (req.method !== "POST" || !/^\/api\/[^/]+\/envelope\/?/.test(req.url ?? "")) {
          res.writeHead(404).end();
          return;
        }
        let body = Buffer.concat(chunks);
        const encoding = req.headers["content-encoding"];
        if (encoding === "gzip") body = gunzipSync(body);
        else if (encoding === "deflate") body = inflateSync(body);
        try {
          this.envelopes.push({ ...parseEnvelope(body), path: req.url ?? "" });
          res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
        } catch {
          res.writeHead(400).end();
        }
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(port, "127.0.0.1", resolve));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  // 공개 키와 프로젝트 id는 아무 값이나 된다(가짜 서버는 검사하지 않는다)
  dsn(project = "1"): string {
    return `http://fakepublickey@127.0.0.1:${this.port}/${project}`;
  }

  // type이 event인 항목(오류 이벤트)
  events(): Record<string, unknown>[] {
    return this.envelopes.flatMap((e) => e.items.filter((i) => i.header.type === "event").map((i) => i.payload as Record<string, unknown>));
  }

  async waitForEvent(match: (event: Record<string, unknown>) => boolean, timeoutMs = 5000): Promise<Record<string, unknown>> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const found = this.events().find(match);
      if (found) return found;
      if (Date.now() > until) throw new Error(`가짜 수집 서버에 맞는 이벤트가 오지 않았다(받은 envelope ${this.envelopes.length}개)`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
