import { Injectable, Logger } from "@nestjs/common";
import * as net from "node:net";
import * as tls from "node:tls";
import type { SentMail } from "./fake-mailer.js";

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from?: string;
  secure?: boolean;
}

export function loadSmtpConfigFromEnv(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  return {
    host,
    port,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM ?? "noreply@node-order.local",
    secure,
  };
}

@Injectable()
export class SmtpMailer {
  private readonly logger = new Logger(SmtpMailer.name);

  async send(mail: SentMail, attempt = 1, overrideConfig?: SmtpConfig): Promise<void> {
    const config = overrideConfig ?? loadSmtpConfigFromEnv();
    if (!config) {
      throw new Error("SMTP_HOST 환경변수가 설정되지 않았습니다");
    }

    await this.deliverViaSmtp(config, mail);
    this.logger.log(`SMTP 메일 발송 성공: ${mail.to} - [${mail.template}] ${mail.subject} (시도 ${attempt})`);
  }

  protected deliverViaSmtp(config: SmtpConfig, mail: SentMail): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = config.secure
        ? tls.connect({ host: config.host, port: config.port, timeout: 10000 })
        : net.connect({ host: config.host, port: config.port, timeout: 10000 });

      let stage = 0;
      let buffer = "";

      const cleanup = () => {
        socket.removeAllListeners();
        socket.destroy();
      };

      socket.on("error", (err) => {
        cleanup();
        reject(err);
      });

      socket.on("timeout", () => {
        cleanup();
        reject(new Error("SMTP 연결 시간 초과"));
      });

      socket.setEncoding("utf-8");

      socket.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\r\n");
        if (lines.length <= 1) return;
        const lastLine = lines[lines.length - 2];
        const code = Number(lastLine.slice(0, 3));

        if (code >= 400) {
          cleanup();
          reject(new Error(`SMTP 오류 응답: ${lastLine}`));
          return;
        }

        // 다중 라인 응답(250-...)이면 아직 끝이 아님
        if (lastLine.charAt(3) === "-") return;

        buffer = "";

        try {
          if (stage === 0) {
            // 220 환영 메시지 수신 후 EHLO 전송
            stage = 1;
            socket.write(`EHLO localhost\r\n`);
          } else if (stage === 1) {
            // EHLO 응답 후 AUTH 또는 MAIL FROM
            if (config.user && config.pass) {
              stage = 2;
              socket.write(`AUTH LOGIN\r\n`);
            } else {
              stage = 5;
              socket.write(`MAIL FROM:<${config.from}>\r\n`);
            }
          } else if (stage === 2) {
            // AUTH LOGIN 응답(334) 후 사용자명(Base64) 전송
            stage = 3;
            socket.write(`${Buffer.from(config.user!).toString("base64")}\r\n`);
          } else if (stage === 3) {
            // 334 후 비밀번호(Base64) 전송
            stage = 4;
            socket.write(`${Buffer.from(config.pass!).toString("base64")}\r\n`);
          } else if (stage === 4) {
            // 인증 성공(235) 후 MAIL FROM
            stage = 5;
            socket.write(`MAIL FROM:<${config.from}>\r\n`);
          } else if (stage === 5) {
            // MAIL FROM 250 후 RCPT TO
            stage = 6;
            socket.write(`RCPT TO:<${mail.to}>\r\n`);
          } else if (stage === 6) {
            // RCPT TO 250 후 DATA
            stage = 7;
            socket.write(`DATA\r\n`);
          } else if (stage === 7) {
            // DATA 354 후 헤더 및 본문 전송
            stage = 8;
            const message = [
              `From: ${config.from}`,
              `To: ${mail.to}`,
              `Subject: =?UTF-8?B?${Buffer.from(mail.subject).toString("base64")}?=`,
              `Content-Type: text/plain; charset=UTF-8`,
              "",
              `주문 #${mail.orderId} 관련 알림입니다.`,
              `[${mail.template}] ${mail.subject}`,
              "",
              ".\r\n",
            ].join("\r\n");
            socket.write(message);
          } else if (stage === 8) {
            // 본문 250 접수 완료 후 QUIT
            stage = 9;
            socket.write(`QUIT\r\n`);
          } else if (stage === 9) {
            // 221 응답 수신 후 정상 종료
            cleanup();
            resolve();
          }
        } catch (e) {
          cleanup();
          reject(e);
        }
      });
    });
  }
}
