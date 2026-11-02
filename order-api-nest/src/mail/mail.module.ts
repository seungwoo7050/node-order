import { Module } from "@nestjs/common";
import { FakeMailer } from "./fake-mailer.js";
import { SmtpMailer } from "./smtp-mailer.js";

@Module({ providers: [SmtpMailer, FakeMailer], exports: [SmtpMailer, FakeMailer] })
export class MailModule {}