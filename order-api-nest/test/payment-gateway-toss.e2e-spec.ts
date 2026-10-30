import { client } from "./payment-app.js";
import { paymentGatewayContract } from "./payment-gateway.contract.js";

// 토스: 위젯에서 인증하면 콘솔이 성공 리다이렉트의 paymentKey·orderId·amount로 승인 API를 부른다
paymentGatewayContract({
  provider: "toss",
  simulatorEnv: "TOSS_SIMULATOR_URL",
  refundOp: "cancel",
  async approve({ sim, baseUrl, userToken, providerOrderId, amount }) {
    const { paymentKey } = await sim.post<{ paymentKey: string }>("/__sim/authorize", { orderId: providerOrderId, amount });
    const res = await client(baseUrl, userToken).post("/payments/toss/confirm", { paymentKey, orderId: providerOrderId, amount });
    expect(res.status).toBe(200);
  },
});
