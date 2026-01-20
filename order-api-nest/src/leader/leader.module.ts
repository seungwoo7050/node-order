import { Module } from "@nestjs/common";
import { LeaderElection } from "./leader-election.js";
import { OrphanImageCleanupJob } from "./orphan-image-cleanup.job.js";
import { TokenCleanupJob } from "./token-cleanup.job.js";

@Module({ providers: [LeaderElection, TokenCleanupJob, OrphanImageCleanupJob] })
export class LeaderModule {}