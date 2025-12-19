import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 5001);

createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (req.method === "POST" && req.url === "/alerts") {
      const payload = JSON.parse(body);
      for (const a of payload.alerts) {
        const time = new Date().toTimeString().slice(0, 8);
        const icon = a.status === "firing" ? "🔥" : "✅";
        console.log(`${time} ${icon} [${a.status}] ${a.labels.alertname} (${a.labels.severity}) - ${a.annotations.summary}: ${a.annotations.description}`);
      }
    }
    res.writeHead(200).end();
  });
}).listen(PORT, () => console.log(`경보 수신기: http://localhost:${PORT}/alerts`));