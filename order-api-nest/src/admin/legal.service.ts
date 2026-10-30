import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, type LegalDocument, type LegalKind } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";

export const LEGAL_KINDS: readonly LegalKind[] = ["terms", "privacy", "refund"];
export const isLegalKind = (v: string): v is LegalKind => (LEGAL_KINDS as readonly string[]).includes(v);
export function legalKind(kind: string): LegalKind {
  if (!isLegalKind(kind)) throw new BadRequestException("문서 종류는 terms, privacy, refund 가운데 하나입니다");
  return kind;
}

export type LegalVersionSummary = { version: number; title: string; effectiveAt: Date; createdAt: Date };
export type LegalView = Omit<LegalDocument, "id"> & { current: boolean; versions: LegalVersionSummary[] };

const summary = { version: true, title: true, effectiveAt: true, createdAt: true } as const;

// 약관·개인정보처리방침·청약철회 안내. 고치면 새 버전 행을 만들고 지난 버전은 지우지 않는다(변경 이력 공개)
// 지금 버전 = 시행일이 지난 버전 가운데 가장 큰 것(시행 예정 버전은 목록에만 보인다)
@Injectable()
export class LegalService {
  private readonly logger = new Logger(LegalService.name);

  constructor(private readonly prisma: PrismaService) {}

  async current(kind: LegalKind, now = new Date()): Promise<LegalDocument> {
    const doc = (await this.prisma.legalDocument.findFirst({ where: { kind, effectiveAt: { lte: now } }, orderBy: { version: "desc" } }))
      ?? (await this.prisma.legalDocument.findFirst({ where: { kind }, orderBy: { version: "asc" } }));
    if (!doc) throw new NotFoundException(`${kind} 문서가 없습니다`);
    return doc;
  }

  async view(kind: LegalKind, version?: number): Promise<LegalView> {
    const current = await this.current(kind);
    const doc = version === undefined ? current : await this.prisma.legalDocument.findUnique({ where: { kind_version: { kind, version } } });
    if (!doc) throw new NotFoundException(`${kind} ${version}판이 없습니다`);
    const versions = await this.prisma.legalDocument.findMany({ where: { kind }, select: summary, orderBy: { version: "desc" } });
    const { id: _id, ...rest } = doc;
    return { ...rest, current: doc.version === current.version, versions };
  }

  // 새 버전. 시행일을 비우면 지금부터. 같은 종류를 동시에 두 번 저장하면 (kind, version) unique가 하나를 막는다(409)
  async publish(kind: LegalKind, input: { title: string; body: string; effectiveAt?: Date }): Promise<LegalView> {
    const effectiveAt = input.effectiveAt ?? new Date();
    if (Number.isNaN(effectiveAt.getTime())) throw new BadRequestException("시행일이 올바르지 않습니다");
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const last = await tx.legalDocument.findFirst({ where: { kind }, orderBy: { version: "desc" }, select: { version: true } });
        return tx.legalDocument.create({ data: { kind, version: (last?.version ?? 0) + 1, title: input.title, body: input.body, effectiveAt } });
      });
      this.logger.log(`법적 고지 새 버전: ${kind} ${created.version}판 (시행 ${created.effectiveAt.toISOString()})`);
      return this.view(kind, created.version);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("같은 문서를 동시에 저장했습니다. 다시 불러와 주세요");
      }
      throw err;
    }
  }
}
