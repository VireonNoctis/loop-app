use std::{env, net::SocketAddr};

use anyhow::{Context, ensure};
use http::HeaderValue;

#[derive(Clone)]
pub struct AppConfig {
    pub bind_addr: SocketAddr,
    pub database_url: String,
    pub db_max_connections: u32,
    pub run_migrations: bool,
    pub cors_allowed_origins: Vec<HeaderValue>,
    pub aws_region: String,
    pub s3_bucket: Option<String>,
    pub s3_endpoint_url: Option<String>,
    pub s3_force_path_style: bool,
    pub s3_presign_ttl_seconds: u64,
}

impl AppConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url = env::var("DATABASE_URL")
            .context("DATABASE_URL is required; see backend/.env.example")?;

        let bind_addr = env::var("APP_ADDR")
            .unwrap_or_else(|_| "0.0.0.0:8080".to_owned())
            .parse::<SocketAddr>()
            .context("APP_ADDR must be a valid socket address")?;

        let db_max_connections = env::var("DB_MAX_CONNECTIONS")
            .unwrap_or_else(|_| "10".to_owned())
            .parse::<u32>()
            .context("DB_MAX_CONNECTIONS must be a positive integer")?;
        ensure!(
            db_max_connections > 0,
            "DB_MAX_CONNECTIONS must be greater than zero"
        );

        let raw_origins = env::var("CORS_ALLOWED_ORIGINS").unwrap_or_else(|_| {
            "http://localhost:3000,https://loopapp.me,https://www.loopapp.me".to_owned()
        });

        let cors_allowed_origins = raw_origins
            .split(',')
            .map(str::trim)
            .filter(|origin| !origin.is_empty())
            .map(HeaderValue::from_str)
            .collect::<Result<Vec<_>, _>>()
            .context("CORS_ALLOWED_ORIGINS contains an invalid origin")?;
        ensure!(
            !cors_allowed_origins.is_empty(),
            "CORS_ALLOWED_ORIGINS must contain at least one origin"
        );

        let s3_presign_ttl_seconds = env::var("S3_PRESIGN_TTL_SECONDS")
            .unwrap_or_else(|_| "300".to_owned())
            .parse::<u64>()
            .context("S3_PRESIGN_TTL_SECONDS must be an integer")?;
        ensure!(
            (60..=900).contains(&s3_presign_ttl_seconds),
            "S3_PRESIGN_TTL_SECONDS must be between 60 and 900"
        );

        Ok(Self {
            bind_addr,
            database_url,
            db_max_connections,
            run_migrations: env::var("RUN_MIGRATIONS")
                .map(|value| value.eq_ignore_ascii_case("true"))
                .unwrap_or(false),
            cors_allowed_origins,
            aws_region: env::var("AWS_REGION").unwrap_or_else(|_| "eu-west-1".to_owned()),
            s3_bucket: env::var("S3_BUCKET")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            s3_endpoint_url: env::var("S3_ENDPOINT_URL")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            s3_force_path_style: env::var("S3_FORCE_PATH_STYLE")
                .map(|value| value.eq_ignore_ascii_case("true"))
                .unwrap_or(false),
            s3_presign_ttl_seconds,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_origins_include_local_and_production_hosts() {
        let raw = "http://localhost:3000,https://loopapp.me";
        let origins = raw
            .split(',')
            .map(str::trim)
            .map(HeaderValue::from_str)
            .collect::<Result<Vec<_>, _>>()
            .expect("valid origins");

        assert_eq!(origins.len(), 2);
        assert_eq!(origins[0], "http://localhost:3000");
        assert_eq!(origins[1], "https://loopapp.me");
    }
}
