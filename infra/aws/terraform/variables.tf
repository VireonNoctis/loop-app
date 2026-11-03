variable "region" {
  description = "AWS region for LOOP data resources."
  type        = string
  default     = "eu-west-1"
}

variable "project_name" {
  type    = string
  default = "loop"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "enable_billable_resources" {
  description = "Explicit cost gate. RDS and S3 are not permanently free; keep false until the account owner approves a budget."
  type        = bool
  default     = false
}

variable "vpc_id" {
  description = "Existing VPC ID. The module does not create NAT Gateways or a VPC."
  type        = string
  default     = null
}

variable "private_subnet_ids" {
  description = "At least two private subnet IDs in different availability zones for the RDS subnet group."
  type        = list(string)
  default     = []
}

variable "api_security_group_id" {
  description = "Security group attached to the Rust API workload; only this group can reach PostgreSQL."
  type        = string
  default     = null
}

variable "db_password" {
  description = "Database password supplied through TF_VAR_db_password or a secure CI secret. Never commit it."
  type        = string
  sensitive   = true
  default     = null
}

variable "bucket_name" {
  description = "Globally unique private media bucket name."
  type        = string
  default     = null
}

variable "allowed_web_origins" {
  description = "Exact browser origins allowed to upload/download through presigned S3 URLs."
  type        = list(string)
  default     = ["https://loopapp.me", "https://www.loopapp.me"]
}

variable "db_instance_class" {
  description = "Small single-AZ class for a low-traffic proof of concept; verify regional availability and pricing before enabling."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage_gb" {
  description = "Initial encrypted gp3 storage allocation. Storage, I/O, backup and compute can all incur charges."
  type        = number
  default     = 20

  validation {
    condition     = var.db_allocated_storage_gb >= 20 && var.db_allocated_storage_gb <= 100
    error_message = "Keep initial RDS storage between 20 and 100 GiB."
  }
}

locals {
  resources_enabled = var.enable_billable_resources
}

check "required_inputs_when_enabled" {
  assert {
    condition = !local.resources_enabled || (
      var.vpc_id != null &&
      length(var.private_subnet_ids) >= 2 &&
      var.api_security_group_id != null &&
      var.db_password != null &&
      var.bucket_name != null
    )
    error_message = "When enable_billable_resources=true, supply VPC, two private subnets, API security group, DB password and globally unique bucket name."
  }
}
