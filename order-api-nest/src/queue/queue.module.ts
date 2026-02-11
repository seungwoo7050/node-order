import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module.js";
import { MailQueue } from "./mail.queue.js";

@Module({ imports: [MailModule], providers: [MailQueue], exports: [MailQueue] })
export class QueueModule {}