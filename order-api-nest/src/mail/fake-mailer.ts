import { Injectable, Logger, Optional } from "@nestjs/common";
import { SmtpMailer } from "./smtp-mailer.js";

export type SentMail = { to: string; orderId: number; template: string; subject: string };

@Injectable()
export class FakeMailer {
  private readonly logger = new Logger(FakeMailer.name);
  private readonly delayMs = Number(process.env.MAIL_DELAY_MS ?? 300);
  private readonly failRate = Number(process.env.MAIL_FAIL_RATE ?? 0);
  // 보낸 메일(최근 1,000통). 테스트가 템플릿별로 몇 통 갔는지 센다
  readonly sent: SentMail[] = [];

  constructor(@Optional() private readonly smtpMailer?: SmtpMailer) {}

  async send(mail: SentMail, attempt = 1): Promise<void> {
    if (process.env.SMTP_HOST) {
      const mailer = this.smtpMailer ?? new SmtpMailer();
      await mailer.send(mail, attempt);
      this.sent.push(mail);
      if (this.sent.length > 1000) this.sent.shift();
      return;
    }
    await new Promise((r) => setTimeout(r, this.delayMs));
    if (Math.random() < this.failRate) throw new Error(`메일 서버 일시 오류(${mail.to})`);
    this.sent.push(mail);
    if (this.sent.length > 1000) this.sent.shift();
    this.logger.log(`메일 발송: ${mail.to} - [${mail.template}] ${mail.subject} (시도 ${attempt})`);
  }
}
