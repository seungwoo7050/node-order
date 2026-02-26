export const orderSelect = { id: true, price: true, paid: true, canceledAt: true, createdAt: true } as const;

export const orderDetailSelect = {
  ...orderSelect,
  items: { select: { quantity: true, unitPrice: true, product: { select: { id: true, name: true } } }, orderBy: { productId: "asc" } },
} as const;
