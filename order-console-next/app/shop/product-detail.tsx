import { notFound } from "next/navigation";
import { getProduct } from "@/lib/catalog";
import { StorefrontDetail } from "@/designs/registry";

export async function ProductDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const product = await getProduct(id);
  if (!product) notFound();

  return <StorefrontDetail id={id} initialProduct={product} />;
}
