"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { PRODUCTS_TAG, productTag } from "@/lib/catalog";

export type ActionResult = { status: number; message: string };
export type ProductInput = { name: string; price: number; description: string };

async function failure(res: Response): Promise<ActionResult> {
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  return { status: res.status, message: Array.isArray(body.message) ? body.message.join(", ") : (body.message ?? res.statusText) };
}

export async function confirmProductImage(token: string, id: number, key: string): Promise<ActionResult | null> {
  const res = await fetch(`${process.env.API_URL}/products/${id}/image/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) return failure(res);
  updateTag(PRODUCTS_TAG);
  updateTag(productTag(id));
  return null;
}

export async function saveProduct(token: string, id: number, input: ProductInput): Promise<ActionResult> {
  const res = await fetch(`${process.env.API_URL}/products/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  if (!res.ok) return failure(res);
  updateTag(PRODUCTS_TAG);
  updateTag(productTag(id));
  redirect("/admin/products");
}
