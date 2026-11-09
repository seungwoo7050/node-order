variable "project_name" {
  description = "Project identifier used for resource naming and tagging"
  type        = string
  default     = "node-order"
}

variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "ap-northeast-2"
}

variable "instance_type" {
  description = "EC2 instance type within zero/low fixed-cost budget"
  type        = string
  default     = "t3.micro"
}

variable "db_instance_class" {
  description = "RDS PostgreSQL instance class within low-cost budget"
  type        = string
  default     = "db.t4g.micro"
}

variable "monthly_budget_usd" {
  description = "Monthly AWS cost budget threshold in USD"
  type        = string
  default     = "20"
}

variable "alert_email" {
  description = "Email address for AWS Budget alerts"
  type        = string
  default     = "seungwoo7050@gmail.com"
}
