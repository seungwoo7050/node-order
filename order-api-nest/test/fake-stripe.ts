import { StripeGateway, type CheckoutSession } from "../src/payments/stripe.gateway.js";

export class FakeStripeGateway extends StripeGateway {
  override isConfigured(): boolean {
    return true;
  }

  override async createCheckoutSession(order: { id: number; price: number }, _attemptKey?: string): Promise<CheckoutSession> {
    const id = `cs_test_fake_${order.id}`;
    return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
  }
}