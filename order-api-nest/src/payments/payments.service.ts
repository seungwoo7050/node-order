import { Injectable, Logger } from "@nestjs/common";
import type Stripe from "stripe";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { cancelUnpaidOrder } from "./cancel-unpaid-order.js";

export type WebhookResult = "processed" | "duplicate" | "ignored";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handle(event: Stripe.Event): Promise<WebhookResult> {
    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.expired") return "ignored";
    const session = event.data.object;

    try {
      const result = await this.prisma.asAdmin(async (tx): Promise<WebhookResult> => {
        const order = await tx.order.findUnique({ where: { stripeSessionId: session.id }, select: { id: true, userId: true } });
        if (!order) return "ignored";

        await tx.stripeEvent.create({ data: { id: event.id, type: event.type } });

        if (event.type === "checkout.session.completed") {
          if (session.payment_status !== "paid") return "ignored";
          const { count } = await tx.order.updateMany({ where: { id: order.id, paid: false, canceledAt: null }, data: { paid: true } });
          if (count === 1) await tx.outboxEvent.create({ data: { type: "order.paid", userId: order.userId, payload: { orderId: order.id } } });
        } else {
          await cancelUnpaidOrder(tx, order.id);
        }
        this.logger.log(`웹훅 처리: ${event.id} ${event.type} → 주문 #${order.id}`);
        return "processed";
      });
      return result;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        this.logger.log(`이미 처리한 웹훅: ${event.id} (${event.type})`);
        return "duplicate";
      }
      throw err;
    }
  }
}