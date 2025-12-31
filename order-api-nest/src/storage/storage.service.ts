import {
  CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, ListObjectsV2Command,
  PutBucketCorsCommand, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";

function makeClient(endpoint: string | undefined) {
  return new S3Client({
    endpoint: endpoint || undefined,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: process.env.S3_ACCESS_KEY
      ? { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY! }
      : undefined,
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  readonly bucket = process.env.S3_BUCKET!;
  private readonly s3 = makeClient(process.env.S3_ENDPOINT);
  private readonly presigner = makeClient(process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT);

  async onModuleInit() {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`버킷 생성: ${this.bucket}`);
    }
    await this.s3.send(new PutBucketCorsCommand({
      Bucket: this.bucket,
      CORSConfiguration: {
        CORSRules: [{
          AllowedOrigins: [process.env.FRONTEND_URL!],
          AllowedMethods: ["PUT", "GET"],
          AllowedHeaders: ["content-type"],
          MaxAgeSeconds: 600,
        }],
      },
    }));
  }

  createUploadUrl(key: string, contentType: string, size: number, expiresIn: number): Promise<string> {
    return getSignedUrl(
      this.presigner,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: size }),
      { expiresIn, signableHeaders: new Set(["content-type"]) },
    );
  }

  createDownloadUrl(key: string, expiresIn: number): Promise<string> {
    return getSignedUrl(this.presigner, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    try {
      const res = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0, contentType: res.ContentType ?? "" };
    } catch (err) {
      if ((err as { name?: string }).name === "NotFound") return null;
      throw err;
    }
  }

  async readFirstBytes(key: string, length: number): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${length - 1}` }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async list(prefix: string): Promise<{ key: string; lastModified: Date }[]> {
    const result: { key: string; lastModified: Date }[] = [];
    let token: string | undefined;
    do {
      const res = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of res.Contents ?? []) result.push({ key: o.Key!, lastModified: o.LastModified! });
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return result;
  }

  async ping(): Promise<void> {
    await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
  
  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}