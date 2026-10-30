import { paymentGatewayContract } from "./payment-gateway.contract.js";

// Stripe: 결제창에서 결제를 끝내면 시뮬레이터가 서명한 checkout.session.completed 웹훅을 API로 보낸다
paymentGatewayContract({
  provider: "stripe",
  simulatorEnv: "STRIPE_SIMULATOR_URL",
  refundOp: "refund",
  async approve({ sim, providerOrderId }) {
    const res = await fetch(`${sim.url}/c/pay/${providerOrderId}/complete`, { method: "POST", redirect: "manual" });
    expect(res.status).toBe(303);
  },
});
