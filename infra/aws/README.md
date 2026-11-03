# LOOP infrastructure choices

The default direction is self-hosted, open-source infrastructure. The Terraform in this directory remains an optional AWS path only; it is disabled by default and must not be enabled without explicit budget approval.

This Terraform module is deliberately **disabled by default**. It does not create an AWS account, provision anything, configure billing or deploy the Rust API.

## Free development

Use the local stack for day-to-day development:

- PostgreSQL 17 in Docker.
- SeaweedFS as the local S3-compatible object store (Apache-2.0).
- Rust API in Docker.
- SQLx migrations run against that local database.

This is a no-cloud-bill development path. The software is open source, but it still consumes the developer's own machine, disk, power and network.

## Recommended self-hosted production direction

- PostgreSQL for relational data.
- SeaweedFS for S3-compatible object storage.
- Docker Compose for a small, single-host deployment; move to a replicated SeaweedFS setup when operational requirements justify it.
- Coolify as an optional open-source deployment control plane for Next.js, Rust and Docker services on infrastructure you supply.

This avoids AWS service charges and vendor lock-in for these components, but it is not literally cost-free: a production host, domains, network egress, backups, monitoring and operations still need to be paid for or supplied by the operator. Coolify is orchestration software, not a hosting provider.

## Optional AWS data plane

When the account owner approves a budget, the module can create:

- A private, encrypted, single-AZ PostgreSQL RDS instance.
- A private S3 bucket with public access blocked, bucket-owner-enforced ownership, encryption, versioning, incomplete multipart cleanup and a narrow CORS policy.
- An IAM task role for the Rust API with prefix-scoped object access.
- A database security group that accepts PostgreSQL only from the supplied Rust API security group.

It reuses an existing VPC and private subnets. It intentionally does not create NAT Gateways, a public database, a load balancer or compute instances.

## Before enabling

1. Review the current AWS Pricing Calculator for the selected region, RDS class, storage, backups, S3 storage and outbound transfer.
2. Set an AWS Budget and billing alerts in the account console. Alerts do not stop charges.
3. Supply private subnet IDs in separate Availability Zones and the security group attached to the Rust API.
4. Supply the database password through TF_VAR_db_password or a secure CI secret. Do not put credentials in terraform.tfvars.
5. Copy terraform.tfvars.example, set enable_billable_resources = true only after the budget is approved.
6. Run terraform init, terraform plan, inspect the plan and obtain owner approval before terraform apply.
7. Configure DATABASE_URL, AWS_REGION, S3_BUCKET and the attached IAM role in the Rust runtime. The database must remain private.

The RDS resource is protected against accidental destruction and deletion protection is enabled. A deliberate decommission requires a reviewed backup and snapshot plan.

## Cost reality

AWS credits and new-account offers are time-limited. RDS compute, storage, backup retention, S3 storage, requests, data transfer, logs and the compute host for the Rust API can cost money. There is no honest way to promise a production social network with media uploads and realtime traffic will run on AWS forever at zero cost.

Keep enable_billable_resources = false until a real budget has been approved. No AWS resources were provisioned by adding this module.
