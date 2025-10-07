import { Module } from "@nestjs/common";
import { LeaderElection } from "./leader-election.js";
import { TokenCleanupJob } from "./token-cleanup.job.js";

@Module({ providers: [LeaderElection, TokenCleanupJob] })
export class LeaderModule {}