import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { QueueModule } from "../queue/queue.module.js";
import { OutboxWebhookController } from "./outbox-webhook.controller.js";
import { OutboxRelay } from "./outbox.relay.js";

@Module({
  imports: [NotificationsModule, QueueModule],
  controllers: [OutboxWebhookController],
  providers: [OutboxRelay],
  exports: [OutboxRelay],
})
export class OutboxModule {}
