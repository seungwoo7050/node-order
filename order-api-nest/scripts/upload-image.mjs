import { readFile } from "node:fs/promises";

process.loadEnvFile();
const API = "http://localhost:4000";
const [file, productId = "1", contentType = "image/png"] = process.argv.slice(2);
const body = await readFile(file);

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "kim", password: process.env.DEMO_PASSWORD }),
});
const { accessToken } = await login.json();
const auth = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

// ① 우리 서버에게: 이 타입, 이 크기의 파일을 올려도 되는가?
const res1 = await fetch(`${API}/products/${productId}/image/upload-url`, {
  method: "POST", headers: auth, body: JSON.stringify({ contentType, size: body.length }),
});
const step1 = await res1.json();
console.log("① upload-url →", res1.status, res1.ok ? { key: step1.key, expiresIn: step1.expiresIn } : step1.message);
if (!res1.ok) process.exit(1);

// ② 저장소에게 직접: 우리 서버는 이 파일의 바이트를 한 번도 거치지 않는다
const res2 = await fetch(step1.uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body });
console.log("② 저장소 PUT →", res2.status, res2.ok ? "" : (await res2.text()).match(/<Code>(.*?)<\/Code>/)?.[1]);

// ③ 우리 서버에게: 다 올렸으니 확인하고 상품에 연결해 달라
const res3 = await fetch(`${API}/products/${productId}/image/confirm`, {
  method: "POST", headers: auth, body: JSON.stringify({ key: step1.key }),
});
const step3 = await res3.json();
console.log("③ confirm →", res3.status, res3.ok ? step3.key : step3.message);