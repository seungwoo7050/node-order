import { Module } from "@nestjs/common";
import { FakeMailer } from "./fake-mailer.js";

@Module({ providers: [FakeMailer], exports: [FakeMailer] })
export class MailModule {}