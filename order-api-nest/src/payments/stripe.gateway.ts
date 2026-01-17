import { Injectable } from "@nestjs/common";
import Stripe from "stripe";

export type CheckoutSession = { id: string; url: string };

@Injectable()
export class StripeGateway {
  private client?: Stripe;

  private get stripe(): Stripe {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY 환경변수가 없습니다");
    return (this.client ??= new Stripe(key));
  }

  async createCheckoutSession(order: { id: number; price: number }, attemptKey?: string): Promise<CheckoutSession> {
    const frontend = process.env.FRONTEND_URL!;
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [{ quantity: 1, price_data: { currency: "krw", unit_amount: order.price, product_data: { name: `주문 #${order.id}` } } }],
        client_reference_id: String(order.id),
        metadata: { orderId: String(order.id) },
        success_url: `${frontend}/me/orders/${order.id}?checkout=success`,
        cancel_url: `${frontend}/shop?checkout=canceled&order=${order.id}`,
      },
      attemptKey ? { idempotencyKey: `checkout-${attemptKey}` } : undefined,
    );
    return { id: session.id, url: session.url! };
  }

  constructWebhookEvent(rawBody: Buffer, signature: string | undefined): Stripe.Event {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET 환경변수가 없습니다");
    return Stripe.webhooks.constructEvent(rawBody, signature ?? "", secret);
  }
}