export const orderSelect = { id: true, totalAmount: true, paid: true, canceledAt: true, createdAt: true } as const;

export function withPrice<T extends { totalAmount: number }>({ totalAmount, ...rest }: T): Omit<T, "totalAmount"> & { price: number } {
  return { ...rest, price: totalAmount };
}

export const orderDetailSelect = {
  ...orderSelect,
  items: { select: { quantity: true, unitPrice: true, product: { select: { id: true, name: true } } }, orderBy: { productId: "asc" } },
} as const;
