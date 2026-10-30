export const orderSelect = { id: true, totalAmount: true, shippingFee: true, paid: true, canceledAt: true, status: true, createdAt: true } as const;

export function withPrice<T extends { totalAmount: number }>({ totalAmount, ...rest }: T): Omit<T, "totalAmount"> & { price: number } {
  return { ...rest, price: totalAmount };
}
