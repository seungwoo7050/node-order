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
      )
      SELECT p.id, p.name, p.price, c.name AS category
      FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.category_id IN (SELECT id FROM subtree)
      ORDER BY p.id`;
  }

  async path(id: number) {
    await this.ensureExists(id);
    return this.prisma.$queryRaw<{ id: number; name: string; depth: number }[]>`
      WITH RECURSIVE ancestors AS (
        SELECT id, name, parent_id, 0 AS depth FROM categories WHERE id = ${id}
        UNION ALL
        SELECT c.id, c.name, c.parent_id, a.depth + 1 FROM categories c JOIN ancestors a ON c.id = a.parent_id
      )
      SELECT id, name, depth FROM ancestors ORDER BY depth DESC`;
  }

  private async ensureExists(id: number) {
    const found = await this.prisma.category.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException(`category ${id} not found`);
  }
}