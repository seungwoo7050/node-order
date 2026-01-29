import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { QueueModule } from "../queue/queue.module.js";
import { OutboxRelay } from "./outbox.relay.js";

@Module({ imports: [NotificationsModule, QueueModule], providers: [OutboxRelay] })
export class OutboxModule {}