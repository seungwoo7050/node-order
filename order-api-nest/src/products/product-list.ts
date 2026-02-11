import type { PrismaService } from "../prisma/prisma.service.js";
import type { StorageService } from "../storage/storage.service.js";
import { toPage } from "../pagination/cursor.js";

export async function listProducts(prisma: PrismaService, storage: StorageService, page: { limit: number; cursor?: number | null }) {
  const rows = await prisma.product.findMany({
    where: page.cursor ? { id: { gt: page.cursor } } : {},
    orderBy: { id: "asc" },
    take: page.limit + 1,
  });
  const { items, nextCursor } = toPage(rows, page.limit, (last) => last.id);
  const withUrls = await Promise.all(
    items.map(async ({ imageKey, ...p }) => ({
      ...p,
      imageUrl: imageKey ? await storage.createDownloadUrl(imageKey, 600) : null,
    })),
  );
  return { items: withUrls, nextCursor };
}
