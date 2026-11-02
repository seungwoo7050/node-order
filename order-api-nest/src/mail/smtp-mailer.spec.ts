import * as net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSmtpConfigFromEnv, SmtpMailer } from "./smtp-mailer.js";

describe("SmtpMailer", () => {
  let server: net.Server;
  let port: number;
  const receivedLines: string[] = [];

  beforeEach(async () => {
    receivedLines.length = 0;
    server = net.createServer((socket) => {
      socket.on("error", () => {});
      socket.setEncoding("utf-8");
      socket.write("220 smtp.test ESMTP Service Ready\r\n");

      let buffer = "";
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\r\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          receivedLines.push(line);
          if (line.startsWith("EHLO")) {
            socket.write("250-smtp.test\r\n250 AUTH LOGIN\r\n");
          } else if (line === "AUTH LOGIN") {
            socket.write("334 VXNlcm5hbWU6\r\n"); // "Username:" Base64
          } else if (line === Buffer.from("testuser").toString("base64")) {
            socket.write("334 UGFzc3dvcmQ6\r\n"); // "Password:" Base64
          } else if (line === Buffer.from("testpass").toString("base64")) {
            socket.write("235 2.7.0 Authentication successful\r\n");
          } else if (line.startsWith("MAIL FROM:")) {
            socket.write("250 2.1.0 OK\r\n");
          } else if (line.startsWith("RCPT TO:")) {
            socket.write("250 2.1.5 OK\r\n");
          } else if (line === "DATA") {
            socket.write("354 Start mail input; end with <CRLF>.<CRLF>\r\n");
          } else if (line === ".") {
            socket.write("250 2.0.0 OK: queued\r\n");
          } else if (line === "QUIT") {
            socket.write("221 2.0.0 Service closing transmission channel\r\n");
            socket.end();
          }
        }
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as net.AddressInfo;
        port = addr.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("SMTP 서버로 인증하고 메일을 성공적으로 발송한다", async () => {
    const mailer = new SmtpMailer();
    const config = {
      host: "127.0.0.1",
      port,
      user: "testuser",
      pass: "testpass",
      from: "shop@node-order.local",
      secure: false,
    };

    await mailer.send(
      {
        to: "customer@example.com",
        orderId: 101,
        template: "order_created",
        subject: "주문 확인",
      },
      1,
      config,
    );

    expect(receivedLines).toContain("EHLO localhost");
    expect(receivedLines).toContain("AUTH LOGIN");
    expect(receivedLines).toContain(Buffer.from("testuser").toString("base64"));
    expect(receivedLines).toContain(Buffer.from("testpass").toString("base64"));
    expect(receivedLines).toContain("MAIL FROM:<shop@node-order.local>");
    expect(receivedLines).toContain("RCPT TO:<customer@example.com>");
    expect(receivedLines).toContain("DATA");
    expect(receivedLines).toContain(".");
    expect(receivedLines).toContain("QUIT");
  });

  it("loadSmtpConfigFromEnv는 환경변수가 없으면 null을 반환한다", () => {
    const origHost = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    try {
      expect(loadSmtpConfigFromEnv()).toBeNull();
    } finally {
      if (origHost) process.env.SMTP_HOST = origHost;
    }
  });
});
