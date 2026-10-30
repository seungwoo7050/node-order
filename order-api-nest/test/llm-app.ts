import { ValidationPipe } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { LLM_PROVIDER } from "../src/llm/llm-provider.js";
import { PrismaExceptionFilter } from "../src/prisma/prisma-exception.filter.js";
import type { FakeLlm } from "./fake-llm.js";

// 설명 초안 e2e가 같이 쓰는 앱 준비와 SSE 읽기. provider를 주면 LLM_PROVIDER를 대역으로 갈아 끼운다
// (한 파일에서 앱을 두 번 만들면 prom-client 지표가 겹쳐 등록되므로 키 없음/대역은 파일을 나눈다)
export async function startApp(provider: FakeLlm | null) {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (provider) builder.overrideProvider(LLM_PROVIDER).useValue(provider);
  const app = (await builder.compile()).createNestApplication({ rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
  await app.listen(0);
  return { app, baseUrl: (await app.getUrl()).replace("[::1]", "localhost") };
}

export type SseEvent = { event: string; data: Record<string, unknown> };

// SSE 응답을 이벤트 단위로 읽는다. onEvent가 false를 돌려주면 그 자리에서 읽기를 멈추고 연결을 끊는다
export async function readSse(res: Response, onEvent: (e: SseEvent) => boolean | void = () => {}): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return events;
    buffer += value;
    let at: number;
    while ((at = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      const event = /^event: (.*)$/m.exec(frame)?.[1] ?? "message";
      const data = JSON.parse(/^data: (.*)$/m.exec(frame)?.[1] ?? "{}") as Record<string, unknown>;
      events.push({ event, data });
      if (onEvent({ event, data }) === false) {
        await reader.cancel();
        return events;
      }
    }
  }
}

export const waitFor = async (check: () => boolean, ms = 3000) => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("기다리던 상태가 오지 않았다");
    await new Promise((r) => setTimeout(r, 20));
  }
};

