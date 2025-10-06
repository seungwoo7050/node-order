import { Queue } from "bullmq";
import { Redis } from "ioredis";

process.loadEnvFile();
const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue("mail", { connection });
console.log(await queue.getJobCounts("waiting", "active", "delayed", "completed", "failed"));
await queue.close();
await connection.quit();