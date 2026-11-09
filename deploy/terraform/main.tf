resource "aws_vpc" "main" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${var.project_name}-vpc"
  }
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.20.1.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project_name}-public-a"
  }
}

resource "aws_subnet" "private_db_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.20.11.0/24"
  availability_zone = "${var.aws_region}a"

  tags = {
    Name = "${var.project_name}-private-db-a"
  }
}

resource "aws_subnet" "private_db_c" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.20.12.0/24"
  availability_zone = "${var.aws_region}c"

  tags = {
    Name = "${var.project_name}-private-db-c"
  }
}

resource "aws_security_group" "app_server" {
  name        = "${var.project_name}-app-sg"
  description = "Allow HTTPS/HTTP traffic to Caddy reverse proxy"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP to Caddy"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS to Caddy"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "rds_postgres" {
  name        = "${var.project_name}-rds-sg"
  description = "Allow PostgreSQL 5432 exclusively from app_server SG (never 0.0.0.0/0)"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from app_server only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app_server.id]
  }
}

resource "aws_db_subnet_group" "postgres" {
  name       = "${var.project_name}-db-subnet-group"
  subnet_ids = [aws_subnet.private_db_a.id, aws_subnet.private_db_c.id]
}

resource "aws_db_instance" "postgres" {
  identifier              = "${var.project_name}-postgres"
  engine                  = "postgres"
  engine_version          = "17.2"
  instance_class          = var.db_instance_class
  allocated_storage       = 20
  storage_type            = "gp3"
  storage_encrypted       = true
  db_name                 = "order_api"
  username                = "order_admin"
  manage_master_user_password = true
  db_subnet_group_name    = aws_db_subnet_group.postgres.name
  vpc_security_group_ids  = [aws_security_group.rds_postgres.id]
  publicly_accessible     = false
  backup_retention_period = 7
  deletion_protection     = true
  skip_final_snapshot     = false
  final_snapshot_identifier = "${var.project_name}-postgres-final"
}

resource "aws_s3_bucket" "backups" {
  bucket = "${var.project_name}-db-backups-apne2"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups_sse" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "backups_private" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_instance" "app" {
  ami                    = "ami-0c9c942bd7bf113a2"
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public_a.id
  vpc_security_group_ids = [aws_security_group.app_server.id]

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name = "${var.project_name}-single-host-bluegreen"
  }
}

resource "aws_budgets_budget" "monthly_cost" {
  name              = "${var.project_name}-monthly-budget"
  budget_type       = "COST"
  limit_amount      = var.monthly_budget_usd
  limit_unit        = "USD"
  time_unit         = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}
