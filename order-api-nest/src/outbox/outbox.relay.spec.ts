import { createHmac } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import { mailFor } from "../mail/templates.js";
import { PRODUCT_CATALOG_SCHEMA_SPEC } from "../products/admin-bulk-import.controller.js";
import { OutboxWebhookController } from "./outbox-webhook.controller.js";
import { orderIdOf, verifyPgRelaySignature, type OutboxRelay } from "./outbox.relay.js";

describe("orderIdOf", () => {
  it("order.created는 주문 자체의 id", () => {
    expect(orderIdOf({ type: "order.created", payload: { id: 6, price: 450000 } })).toBe(6);
  });
  it("order.paid는 orderId", () => {
    expect(orderIdOf({ type: "order.paid", payload: { orderId: 6 } })).toBe(6);
  });
  it("상태 전이·반품 알림도 orderId", () => {
    expect(orderIdOf({ type: "order.shipped", payload: { orderId: 7, from: "preparing", to: "shipped" } })).toBe(7);
    expect(orderIdOf({ type: "return.approved", payload: { orderId: 8, returnId: 1 } })).toBe(8);
  });
});

describe("mailFor - 종류별 메일 템플릿", () => {
  it.each(["order.preparing", "order.shipped", "order.delivered", "order.canceled", "return.approved", "return.rejected"])("%s는 같은 이름의 템플릿", (type) => {
    expect(mailFor(type, 3).template).toBe(type);
    expect(mailFor(type, 3).subject).toContain("주문 #3");
  });
  it("발송 메일에 택배사와 송장번호, 반품 승인 메일에 환불액이 들어간다", () => {
    expect(mailFor("order.shipped", 3, { carrierName: "CJ대한통운", trackingNumber: "123456789012" }).subject).toBe("주문 #3 발송: CJ대한통운 123456789012");
    expect(mailFor("return.approved", 3, { kind: "refund", refundAmount: 24_000 }).subject).toBe("주문 #3 반품 승인 - 24,000원 환불");
  });
  it("모르는 종류는 generic", () => {
    expect(mailFor("something.else", 3)).toEqual({ template: "generic", subject: "주문 #3 알림" });
  });
});

describe("verifyPgRelaySignature & OutboxWebhookController", () => {
  const secret = "test-pgrelay-secret";
  const nowSec = 1_730_000_000;
  const payloadObj = { id: 12, type: "order.created", user_id: "kim", payload: { id: 99 }, created_at: new Date(nowSec * 1000) };
  const rawBody = JSON.stringify(payloadObj);
  const validSig = `v1=${createHmac("sha256", secret).update(`${nowSec}.${rawBody}`).digest("hex")}`;

  it("pgrelay 규격(v1=hex(hmac-sha256(secret, ts.payload))) 서명을 검증한다", () => {
    expect(verifyPgRelaySignature(secret, validSig, String(nowSec), rawBody, nowSec, 300)).toBe(true);
    expect(verifyPgRelaySignature(secret, validSig, String(nowSec + 600), rawBody, nowSec, 300)).toBe(false);
    expect(verifyPgRelaySignature(secret, "v1=0000", String(nowSec), rawBody, nowSec, 300)).toBe(false);
    expect(verifyPgRelaySignature("wrong-secret", validSig, String(nowSec), rawBody, nowSec, 300)).toBe(false);
  });

  it("OutboxWebhookController는 서명이 유효할 때만 dispatchLocal을 호출한다", async () => {
    const dispatched: unknown[] = [];
    const fakeRelay = {
      dispatchLocal: async (e: unknown) => {
        dispatched.push(e);
      },
    } as unknown as OutboxRelay;
    const ctrl = new OutboxWebhookController(fakeRelay);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `v1=${createHmac("sha256", "pgrelay-default-secret").update(`${ts}.${rawBody}`).digest("hex")}`;

    const res = await ctrl.receive(sig, ts, payloadObj);
    expect(res).toEqual({ ok: true, id: 12 });
    expect(dispatched).toHaveLength(1);

    await expect(ctrl.receive("v1=bad", ts, payloadObj)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("PRODUCT_CATALOG_SCHEMA_SPEC은 ingestguard SchemaSpec 필수 필드를 정의한다", () => {
    expect(PRODUCT_CATALOG_SCHEMA_SPEC.key_field).toBe("sku");
    expect(PRODUCT_CATALOG_SCHEMA_SPEC.fields.price.ge).toBe(0);
    expect(PRODUCT_CATALOG_SCHEMA_SPEC.fields.sku.required).toBe(true);
  });
});
