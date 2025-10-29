import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class FakeMailer {
  private readonly logger = new Logger(FakeMailer.name);
  private readonly delayMs = Number(process.env.MAIL_DELAY_MS ?? 300);
  private readonly failRate = Number(process.env.MAIL_FAIL_RATE ?? 0);

  async send(to: string, subject: string, attempt = 1): Promise<void> {
    await new Promise((r) => setTimeout(r, this.delayMs));
    if (Math.random() < this.failRate) throw new Error(`메일 서버 일시 오류(${to})`);
    this.logger.log(`메일 발송: ${to} — ${subject} (시도 ${attempt})`);
  }
}