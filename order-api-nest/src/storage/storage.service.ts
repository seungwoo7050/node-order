import {
  CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, ListObjectsV2Command,
  PutBucketCorsCommand, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  readonly bucket = process.env.S3_BUCKET!;
  private readonly s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });

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
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: size }),
      { expiresIn, signableHeaders: new Set(["content-type"]) },
    );
  }

  createDownloadUrl(key: string, expiresIn: number): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
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

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}