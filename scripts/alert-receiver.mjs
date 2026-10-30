import { createServer } from "node:http";

// 가짜 경보 수신기(실제 Slack·Discord·dead man's switch에 보내지 않고 받은 것을 찍는다).
//   POST /alerts  Alertmanager webhook_configs 형식(개발 compose의 옛 경로)
//   POST /slack   Slack 호환 웹훅(slack_configs가 보내는 attachments). 운영의 ALERT_WEBHOOK_URL 자리
//   POST|GET /ping  dead man's switch(healthchecks 호환 핑). 운영의 DEADMAN_URL 자리
// 한 줄에 하나씩 찍는다. deploy/rehearsal-alerts.sh가 이 출력을 보고 경보 도착을 판정한다
const PORT = Number(process.env.PORT ?? 5001);
const time = () => new Date().toTimeString().slice(0, 8);

createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try {
      const path = (req.url ?? "").split("?")[0];
      if (req.method === "POST" && path === "/alerts") {
        for (const a of JSON.parse(body).alerts) {
          console.log(`${time()} ALERT [${a.status}] ${a.labels.alertname} (${a.labels.severity}) - ${a.annotations.summary}: ${a.annotations.description}`);
        }
      } else if (req.method === "POST" && path === "/slack") {
        const payload = JSON.parse(body);
        for (const att of payload.attachments ?? [{ title: "", text: payload.text }]) {
          console.log(`${time()} SLACK ${att.title} | ${String(att.text ?? "").replace(/\s*\n\s*/g, " | ")}`);
        }
      } else if (path === "/ping") {
        const alerts = body ? (JSON.parse(body).alerts ?? []).map((a) => a.labels.alertname).join(",") : "";
        console.log(`${time()} PING ${alerts}`);
      } else {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200).end("ok");
    } catch (err) {
      console.log(`${time()} BAD ${req.method} ${req.url}: ${err.message}`);
      res.writeHead(400).end();
    }
  });
}).listen(PORT, () => console.log(`경보 수신기: http://localhost:${PORT}/slack, /ping, /alerts`));
