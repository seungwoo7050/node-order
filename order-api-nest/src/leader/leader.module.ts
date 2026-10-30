import { Module } from "@nestjs/common";
import { SearchModule } from "../search/search.module.js";
import { LeaderElection } from "./leader-election.js";
import { OrphanImageCleanupJob } from "./orphan-image-cleanup.job.js";
import { TokenCleanupJob } from "./token-cleanup.job.js";
import { DemoUserCleanupJob } from "./demo-user-cleanup.job.js";
import { SearchIndexJob } from "./search-index.job.js";

@Module({ imports: [SearchModule], providers: [LeaderElection, TokenCleanupJob, OrphanImageCleanupJob, DemoUserCleanupJob, SearchIndexJob] })
export class LeaderModule {}
