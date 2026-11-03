output "postgres_endpoint" {
  description = "Private RDS endpoint. Only reachable from the Rust API security group."
  value       = try(aws_db_instance.postgres[0].address, null)
}

output "postgres_port" {
  value = try(aws_db_instance.postgres[0].port, null)
}

output "media_bucket_name" {
  value = try(aws_s3_bucket.media[0].bucket, null)
}

output "api_storage_role_arn" {
  description = "Attach this role to the Rust API task; never place AWS credentials in the browser."
  value       = try(aws_iam_role.api_storage[0].arn, null)
}
