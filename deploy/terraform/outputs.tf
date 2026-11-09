output "vpc_id" {
  description = "Provisioned VPC ID"
  value       = aws_vpc.main.id
}

output "app_public_ip" {
  description = "Public IP of the Blue-Green Caddy/Docker host"
  value       = aws_instance.app.public_ip
}

output "rds_endpoint" {
  description = "Private endpoint of the encrypted RDS PostgreSQL instance"
  value       = aws_db_instance.postgres.endpoint
}

output "backup_bucket_name" {
  description = "Encrypted S3 bucket for daily pg_dump backups"
  value       = aws_s3_bucket.backups.bucket
}
