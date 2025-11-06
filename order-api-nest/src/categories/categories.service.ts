import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

export type CategoryNode = { id: number; name: string; children: CategoryNode[] };

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async treeNaive(): Promise<CategoryNode[]> {
    const load = async (parentId: number | null): Promise<CategoryNode[]> => {
      const rows = await this.prisma.category.findMany({ where: { parentId }, orderBy: { id: "asc" } });
      return Promise.all(rows.map(async (r) => ({ id: r.id, name: r.name, children: await load(r.id) })));
    };
    return load(null);
  }

  async tree(): Promise<CategoryNode[]> {
    const rows = await this.prisma.category.findMany({ orderBy: { id: "asc" } });
    const byId = new Map<number, CategoryNode>(rows.map((r) => [r.id, { id: r.id, name: r.name, children: [] }]));
    const roots: CategoryNode[] = [];
    for (const r of rows) {
      const node = byId.get(r.id)!;
      if (r.parentId === null) roots.push(node);
      else byId.get(r.parentId)?.children.push(node);
    }
    return roots;
  }

  async productsInSubtree(id: number) {
    await this.ensureExists(id);
    return this.prisma.$queryRaw<{ id: number; name: string; price: number; category: string }[]>`
      WITH RECURSIVE subtree AS (
        SELECT id FROM categories WHERE id = ${id}          -- 시작점
        UNION ALL
        SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id   -- 바로 아래 자식들을 계속 붙인다
      ) CYCLE id SET is_cycle USING visited   -- 이미 지나온 id를 다시 만나면 거기서 멈춘다(7단계)
      SELECT p.id, p.name, p.price, c.name AS category
      FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.category_id IN (SELECT id FROM subtree WHERE NOT is_cycle)
      ORDER BY p.id`;
  }

  async path(id: number) {
    await this.ensureExists(id);
    return this.prisma.$queryRaw<{ id: number; name: string; depth: number }[]>`
      WITH RECURSIVE ancestors AS (
        SELECT id, name, parent_id, 0 AS depth FROM categories WHERE id = ${id}
        UNION ALL
        SELECT c.id, c.name, c.parent_id, a.depth + 1 FROM categories c JOIN ancestors a ON c.id = a.parent_id
      ) CYCLE id SET is_cycle USING visited
      SELECT id, name, depth FROM ancestors WHERE NOT is_cycle ORDER BY depth DESC`;
  }

  async move(id: number, newParentId: number | null) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(726002)`;
      const node = await tx.category.findUnique({ where: { id } });
      if (!node) throw new NotFoundException(`category ${id} not found`);
      if (newParentId !== null) {
        if (newParentId === id) throw new BadRequestException("자기 자신 아래로 옮길 수 없습니다");
        const [{ cycle }] = await tx.$queryRaw<{ cycle: boolean }[]>`
          WITH RECURSIVE ancestors AS (
            SELECT id, parent_id FROM categories WHERE id = ${newParentId}
            UNION ALL
            SELECT c.id, c.parent_id FROM categories c JOIN ancestors a ON c.id = a.parent_id
          ) CYCLE id SET is_cycle USING visited
          SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = ${id}) AS cycle`;
        if (cycle) throw new BadRequestException("자기 후손 아래로 옮길 수 없습니다(순환 발생)");
      }
      return tx.category.update({ where: { id }, data: { parentId: newParentId }, select: { id: true, name: true, parentId: true } });
    });
  }

  private async ensureExists(id: number) {
    const found = await this.prisma.category.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException(`category ${id} not found`);
  }
}