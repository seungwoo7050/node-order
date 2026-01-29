import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import pg from "pg";

process.loadEnvFile();
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
});
const { Contents = [] } = await s3.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: process.argv[2] ?? "products/" }));

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows } = await db.query("SELECT id, image_key FROM products WHERE image_key IS NOT NULL");
await db.end();
const used = new Map(rows.map((r) => [r.image_key, r.id]));

console.table(Contents.map((o) => ({
  key: o.Key,
  size: o.Size,
  "올라간 지(초)": Math.round((Date.now() - o.LastModified.getTime()) / 1000),
  "가리키는 상품": used.get(o.Key) ?? "(없음 - 고아)",
})));
