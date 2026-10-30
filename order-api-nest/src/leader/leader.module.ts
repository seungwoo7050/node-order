import { Module } from "@nestjs/common";
import { FulfillmentModule } from "../fulfillment/fulfillment.module.js";
import { SearchModule } from "../search/search.module.js";
import { FulfillmentJob } from "./fulfillment.job.js";
import { LeaderElection } from "./leader-election.js";
import { OrphanImageCleanupJob } from "./orphan-image-cleanup.job.js";
import { TokenCleanupJob } from "./token-cleanup.job.js";
import { DemoUserCleanupJob } from "./demo-user-cleanup.job.js";
import { SearchIndexJob } from "./search-index.job.js";
import { ReconciliationModule } from "../reconciliation/reconciliation.module.js";
import { ReconciliationJob } from "./reconciliation.job.js";
import { BusinessMetricsJob } from "./business-metrics.job.js";

@Module({ imports: [SearchModule, FulfillmentModule, ReconciliationModule], providers: [LeaderElection, TokenCleanupJob, OrphanImageCleanupJob, DemoUserCleanupJob, SearchIndexJob, FulfillmentJob, ReconciliationJob, BusinessMetricsJob] })
export class LeaderModule {}
