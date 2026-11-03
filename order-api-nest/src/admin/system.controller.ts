import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "../auth/admin.guard.js";
import { AdminViewGuard } from "../auth/admin-view.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RuntimeSecretsService } from "./runtime-secrets.service.js";
import { PaymentGateways } from "../payments/payment-gateways.js";
import { LLM_PROVIDER, type LlmProvider } from "../llm/llm-provider.js";
import { Optional, Inject } from "@nestjs/common";
import { IsBoolean, IsObject, IsOptional, IsString } from "class-validator";

export class SaveSecretDto {
  @IsOptional()
  @IsString()
  key?: string;

  @IsOptional()
  @IsString()
  value?: string;

  @IsOptional()
  @IsObject()
  secrets?: Record<string, string>;
}

export class UpdateControlsDto {
  @IsOptional()
  @IsBoolean()
  pausePaidApis?: boolean;

  @IsOptional()
  @IsBoolean()
  maintenanceMode?: boolean;
}

@ApiTags("admin")
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard("jwt"))
export class SystemController {
  constructor(
    private readonly secrets: RuntimeSecretsService,
    private readonly prisma: PrismaService,
    @Optional() @Inject(PaymentGateways) private readonly gateways: PaymentGateways | null = null,
    @Optional() @Inject(LLM_PROVIDER) private readonly llm: LlmProvider | null = null,
  ) {}

  @Get(["admin/system", "admin/integrations"])
  @UseGuards(AdminViewGuard)
  async getSystemOverview() {
    const [
      secrets,
      controls,
      usersCount,
      productsCount,
      variantsCount,
      categoriesCount,
      ordersCount,
      paymentsCount,
      refundsCount,
      returnsCount,
      shipmentsCount,
      outboxCount,
      secretsCount,
    ] = await Promise.all([
      this.secrets.getSecretsStatus(),
      this.secrets.getControls(),
      this.prisma.user.count(),
      this.prisma.product.count({ where: { deletedAt: null } }),
      this.prisma.productVariant.count(),
      this.prisma.category.count(),
      this.prisma.order.count(),
      this.prisma.payment.count(),
      this.prisma.refund.count(),
      this.prisma.return.count(),
      this.prisma.shipment.count(),
      this.prisma.outboxEvent.count(),
      this.prisma.integrationSecret.count(),
    ]);

    const isPaused = controls.pausePaidApis;
    const stripeConfigured = Boolean(this.secrets.getSecret("STRIPE_SECRET_KEY"));
    const tossConfigured = Boolean(
      this.secrets.getSecret("TOSS_CLIENT_KEY") && this.secrets.getSecret("TOSS_SECRET_KEY"),
    );
    const llmConfigured = Boolean(
      this.secrets.getSecret("LLM_API_KEY") || this.secrets.getSecret("OPENAI_API_KEY"),
    );
    const jusoConfigured = Boolean(this.secrets.getSecret("JUSO_API_KEY"));
    const smtpConfigured = Boolean(this.secrets.getSecret("SMTP_HOST"));
    const sentryConfigured = Boolean(this.secrets.getSecret("SENTRY_DSN"));

    const infrastructure = [
      {
        id: "api",
        name: "NestJS 코어 API",
        status: "connected",
        billingType: "free_self_hosted",
        description: "주문·결제·재고 처리 핵심 애플리케이션 서버",
      },
      {
        id: "postgres",
        name: "PostgreSQL 16",
        status: "connected",
        billingType: "free_self_hosted",
        description: "ACID 보장 관계형 데이터베이스 및 전체 엔티티 정본",
      },
      {
        id: "redis",
        name: "Redis 7",
        status: "connected",
        billingType: "free_self_hosted",
        description: "세션 및 카탈로그 캐시, 단일 비행(Single-flight) 최적화",
      },
      {
        id: "storage",
        name: "S3 / MinIO",
        status: "connected",
        billingType: "free_self_hosted",
        description: "상품 사진 및 정적 자산 보관 오브젝트 스토리지",
      },
      {
        id: "stripe",
        name: "Stripe Payment",
        status: stripeConfigured ? (isPaused ? "paused" : "connected") : "standby",
        billingType: "pay_per_use",
        description: "글로벌 신용카드 결제 게이트웨이",
      },
      {
        id: "toss",
        name: "토스페이먼츠",
        status: tossConfigured ? (isPaused ? "paused" : "connected") : "standby",
        billingType: "pay_per_use",
        description: "국내 신용카드 및 간편결제 게이트웨이",
      },
      {
        id: "llm",
        name: "생성형 AI (LLM)",
        status: llmConfigured ? (isPaused ? "paused" : "connected") : "standby",
        billingType: "pay_per_use",
        description: "Anthropic / OpenAI 기반 상품 설명 초안 자동 생성",
      },
      {
        id: "juso",
        name: "도로명주소 API",
        status: jusoConfigured ? (isPaused ? "paused" : "connected") : "standby",
        billingType: "free_self_hosted",
        description: "행정안전부 공공 도로명주소 검색 API",
      },
      {
        id: "smtp",
        name: "SMTP 메일 발송기",
        status: smtpConfigured ? (isPaused ? "paused" : "connected") : "standby",
        billingType: "free_self_hosted",
        description: "주문 생성·배송 송장 알림 이메일 전송",
      },
      {
        id: "sentry",
        name: "Sentry 에러 로깅",
        status: sentryConfigured ? (isPaused ? "paused" : "connected") : "standby",
        billingType: "optional_paid",
        description: "실시간 예외 및 런타임 성능 모니터링",
      },
    ];

    const runbook = {
      commands: [
        {
          command: "cd /opt/node-order && ./rollback.sh",
          title: "무중단 이전 배포 슬롯 즉시 롤백 (AWS EC2 SSH)",
          description:
            "배포 직후 헬스체크 실패나 결제 이상 징후 발견 시 Caddy 업스트림을 직전 검증된 슬롯(Blue/Green)으로 즉시 전환합니다.",
        },
        {
          command: "cd /opt/node-order && ./ops/backup.sh && ./ops/restore-check.sh",
          title: "운영 데이터베이스 수동 백업 및 복원 대조 (AWS EC2 SSH)",
          description:
            "정기 백업(매일 03:30 KST) 외에 수동 pg_dump 스냅샷을 S3 버킷(backups/)에 업로드하고 임시 DB에 복원하여 행 수 무결성을 대조합니다.",
        },
        {
          command: "cd /opt/node-order && ./ops/reset-demo.sh",
          title: "데모 카탈로그·주문 기준 데이터 재적용 (AWS EC2 SSH)",
          description:
            "정기 초기화(매일 04:00 KST, 당일 백업 성공 확인 후 실행) 외에 시연 데이터를 초기 기준 상태로 즉시 복원합니다.",
        },
        {
          command: "bash deploy/aws/90-destroy.sh",
          title: "클라우드 인프라 전체 반납 (관리자 로컬 PC — AWS CLI)",
          description:
            "서비스 영구 종료 시 관리자 로컬 PC에서 EC2·RDS·S3·탄력적 IP·보안그룹을 일괄 회수하여 클라우드 유휴 비용을 완전히 제거합니다.",
        },
      ],
      strategy:
        "1차 비상 대응은 상단 웹 콘솔 스위치(유료 외부 API 일시정지·상점 점검 503 모드)로 재배포 없이 즉시 제어하며, 배포 롤백·데이터 백업 등 인프라 조치가 필요한 경우 아래 표준 운영 스크립트를 실행합니다.",
    };

    return {
      secrets,
      controls,
      dbCounts: {
        users: usersCount,
        products: productsCount,
        productVariants: variantsCount,
        categories: categoriesCount,
        orders: ordersCount,
        payments: paymentsCount,
        refunds: refundsCount,
        returns: returnsCount,
        shipments: shipmentsCount,
        outboxEvents: outboxCount,
        integrationSecrets: secretsCount,
      },
      infrastructure,
      runbook,
    };
  }

  private async handleSaveSecret(dto: SaveSecretDto) {
    if (dto.secrets && typeof dto.secrets === "object") {
      const results = [];
      for (const [key, value] of Object.entries(dto.secrets)) {
        if (value && typeof value === "string") {
          results.push(await this.secrets.setSecret(key, value));
        }
      }
      return { saved: results };
    }

    if (dto.key && dto.value) {
      return this.secrets.setSecret(dto.key, dto.value);
    }

    return { ok: false, message: "key and value required" };
  }

  @Post("admin/system/secrets")
  @UseGuards(AdminGuard)
  saveSecretPostSys(@Body() dto: SaveSecretDto) {
    return this.handleSaveSecret(dto);
  }

  @Post("admin/integrations/secrets")
  @UseGuards(AdminGuard)
  saveSecretPostInt(@Body() dto: SaveSecretDto) {
    return this.handleSaveSecret(dto);
  }

  @Put("admin/system/secrets")
  @UseGuards(AdminGuard)
  saveSecretPutSys(@Body() dto: SaveSecretDto) {
    return this.handleSaveSecret(dto);
  }

  @Put("admin/integrations/secrets")
  @UseGuards(AdminGuard)
  saveSecretPutInt(@Body() dto: SaveSecretDto) {
    return this.handleSaveSecret(dto);
  }

  @Delete("admin/system/secrets/:key")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async deleteSecretSys(@Param("key") key: string) {
    await this.secrets.deleteSecret(key);
    return { ok: true };
  }

  @Delete("admin/integrations/secrets/:key")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async deleteSecretInt(@Param("key") key: string) {
    await this.secrets.deleteSecret(key);
    return { ok: true };
  }

  @Post("admin/system/secrets/:key/test")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  testSecretSys(@Param("key") key: string) {
    return this.secrets.testSecret(key);
  }

  @Post("admin/integrations/secrets/:key/test")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  testSecretInt(@Param("key") key: string) {
    return this.secrets.testSecret(key);
  }

  @Patch("admin/system/controls")
  @UseGuards(AdminGuard)
  updateControlsPatchSys(@Body() dto: UpdateControlsDto) {
    return this.secrets.setControls(dto);
  }

  @Patch("admin/integrations/controls")
  @UseGuards(AdminGuard)
  updateControlsPatchInt(@Body() dto: UpdateControlsDto) {
    return this.secrets.setControls(dto);
  }

  @Put("admin/system/controls")
  @UseGuards(AdminGuard)
  updateControlsPutSys(@Body() dto: UpdateControlsDto) {
    return this.secrets.setControls(dto);
  }

  @Put("admin/integrations/controls")
  @UseGuards(AdminGuard)
  updateControlsPutInt(@Body() dto: UpdateControlsDto) {
    return this.secrets.setControls(dto);
  }
}
