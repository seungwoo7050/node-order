import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { OutboxRelay } from "./outbox.relay.js";

@Module({ imports: [NotificationsModule], providers: [OutboxRelay] })
export class OutboxModule {}