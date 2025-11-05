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
}