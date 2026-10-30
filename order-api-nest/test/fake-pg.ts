import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

// PG 시뮬레이터(scripts/stripe-sim.mjs, scripts/toss-sim.mjs)를 빈 포트에 띄우는 테스트 대역.
// 테스트 앱 주소(apiUrl)를 받아 시뮬레이터가 그쪽으로 웹훅을 보낸다
export type Simulator = {
  url: string;
  calls(): Promise<Record<string, number>>;
  fault(op: string, kind: string, extra?: { delayMs?: number; times?: number; retryAfter?: number }): Promise<void>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  reset(): Promise<void>;
  stop(): Promise<void>;
};

export async function startSimulator(kind: "stripe" | "toss", apiUrl: string): Promise<Simulator> {
  const script = fileURLToPath(new URL(`../scripts/${kind}-sim.mjs`, import.meta.url));
  const child: ChildProcess = spawn(process.execPath, [script], {
    env: { ...process.env, SIM_PORT: "0", SIM_API_URL: apiUrl, SIM_WEBHOOK_DELAY_MS: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const port = await new Promise<number>((resolve, reject) => {
    let out = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const m = out.match(/listening (\d+)/);
      if (m) resolve(Number(m[1]));
    });
    child.once("exit", (code) => reject(new Error(`${kind} 시뮬레이터가 꺼졌다(${code}): ${out}`)));
  });
  child.stdout!.resume();
  const url = `http://localhost:${port}`;
  const post = async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${url}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    return (await res.json()) as T;
  };
  return {
    url,
    post,
    calls: async () => (await (await fetch(`${url}/__sim/calls`)).json()) as Record<string, number>,
    fault: async (op, faultKind, extra = {}) => void (await post("/__sim/faults", { op, kind: faultKind, ...extra })),
    reset: async () => void (await post("/__sim/reset")),
    stop: () => new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", () => resolve());
      child.kill();
    }),
  };
}
