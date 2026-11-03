resource "aws_security_group" "postgres" {
  count       = local.resources_enabled ? 1 : 0
  name        = "${var.project_name}-postgres"
  description = "PostgreSQL access from the LOOP Rust API only."
  vpc_id      = var.vpc_id

  ingress {
    description     = "Rust API workload"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.api_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_subnet_group" "postgres" {
  count       = local.resources_enabled ? 1 : 0
  name        = "${var.project_name}-postgres-private"
  description = "Private subnets for LOOP PostgreSQL."
  subnet_ids  = var.private_subnet_ids
}

resource "aws_db_instance" "postgres" {
  count = local.resources_enabled ? 1 : 0

  identifier        = "${var.project_name}-postgres"
  engine            = "postgres"
  instance_class    = var.db_instance_class
  allocated_storage = var.db_allocated_storage_gb
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = "loop"
  username = "loop_app"
  password = var.db_password
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.postgres[0].name
  vpc_security_group_ids = [aws_security_group.postgres[0].id]
  publicly_accessible    = false

  multi_az                  = false
  backup_retention_period   = 1
  auto_minor_version_upgrade = true
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.project_name}-postgres-final"

  apply_immediately = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket" "media" {
  count  = local.resources_enabled ? 1 : 0
  bucket = var.bucket_name
}

resource "aws_s3_bucket_public_access_block" "media" {
  count                   = local.resources_enabled ? 1 : 0
  bucket                  = aws_s3_bucket.media[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "media" {
  count  = local.resources_enabled ? 1 : 0
  bucket = aws_s3_bucket.media[0].id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  count  = local.resources_enabled ? 1 : 0
  bucket = aws_s3_bucket.media[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "media" {
  count  = local.resources_enabled ? 1 : 0
  bucket = aws_s3_bucket.media[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  count  = local.resources_enabled ? 1 : 0
  bucket = aws_s3_bucket.media[0].id

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "media" {
  count  = local.resources_enabled ? 1 : 0
  bucket = aws_s3_bucket.media[0].id

  cors_rule {
    allowed_headers = ["content-type", "x-amz-*"]
    allowed_methods = ["GET", "HEAD", "PUT"]
    allowed_origins = var.allowed_web_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 300
  }
}

resource "aws_iam_role" "api_storage" {
  count = local.resources_enabled ? 1 : 0
  name  = "${var.project_name}-api-object-storage"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "api_storage" {
  count = local.resources_enabled ? 1 : 0
  name  = "${var.project_name}-media-prefix-access"
  role  = aws_iam_role.api_storage[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ListOwnedMediaPrefixes"
        Effect = "Allow"
        Action = ["s3:ListBucket", "s3:ListBucketMultipartUploads"]
        Resource = aws_s3_bucket.media[0].arn
        Condition = {
          StringLike = {
            "s3:prefix" = ["users/*", "loops/*", "circles/*", "profiles/*", "temporary/*"]
          }
        }
      },
      {
        Sid    = "ReadWriteOwnedMedia"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:AbortMultipartUpload",
          "s3:ListMultipartUploadParts"
        ]
        Resource = [
          "${aws_s3_bucket.media[0].arn}/users/*",
          "${aws_s3_bucket.media[0].arn}/loops/*",
          "${aws_s3_bucket.media[0].arn}/circles/*",
          "${aws_s3_bucket.media[0].arn}/profiles/*",
          "${aws_s3_bucket.media[0].arn}/temporary/*"
        ]
      }
    ]
  })
}
