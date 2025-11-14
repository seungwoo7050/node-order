import { Queue } from "bullmq";
import { Redis } from "ioredis";

process.loadEnvFile();
const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue("mail", { connection });
const before = await queue.getFailedCount();
await queue.retryJobs({ state: "failed" });
console.log(`failed에 있던 job ${before}개를 다시 대기열로 보냈습니다`);
await queue.close();
await connection.quit();