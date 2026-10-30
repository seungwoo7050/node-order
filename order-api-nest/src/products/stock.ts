import { ConflictException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service.js";

// 재고 조정(관리자 REST와 MCP adjust_stock이 같이 쓴다). 0 아래로 내려가는 조정은 한 문장으로 막는다(동시 주문과 겹쳐도 음수가 안 된다)
export async function adjustStock(prisma: PrismaService, id: number, delta: number): Promise<{ id: number; stock: number }> {
  const rows = await prisma.$queryRaw<{ id: number; stock: number }[]>`
    UPDATE products SET stock = stock + ${delta}
    WHERE id = ${id} AND stock + ${delta} >= 0
    RETURNING id, stock`;
  if (rows[0]) return rows[0];
  const product = await prisma.product.findUnique({ where: { id }, select: { stock: true } });
  if (!product) throw new NotFoundException(`product ${id} not found`);
  throw new ConflictException(`재고가 ${product.stock}개라 ${-delta}개를 뺄 수 없습니다`);
}
