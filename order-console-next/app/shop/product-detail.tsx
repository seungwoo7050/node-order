import { notFound } from "next/navigation";
import { getProduct } from "@/lib/catalog";
import { BuyBox } from "./buy-box";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export async function ProductDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const product = await getProduct(id);
  if (!product) notFound();
  return (
    <article className="grid gap-6 sm:grid-cols-[240px_minmax(0,1fr)]" data-testid="product-detail">
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.imageUrl} alt={product.name} width={240} height={240} className="aspect-square w-full object-cover" />
      ) : (
        <span aria-hidden="true" className="grid aspect-square w-full place-items-center bg-surface font-serif text-4xl text-faint">{product.name.slice(0, 1)}</span>
      )}
      <div className="grid content-start gap-3">
        {product.categoryPath.length > 0 && <p className="label">{product.categoryPath.join(" / ")}</p>}
        <h1 id="product-title" className="title">{product.name}</h1>
        <p className="num">{won(product.price)}</p>
        {product.description && <p className="whitespace-pre-line text-sm text-muted">{product.description}</p>}
        <BuyBox id={product.id} name={product.name} price={product.price} />
      </div>
    </article>
  );
}
