use std::time::Duration;

use anyhow::Context;
use aws_config::{BehaviorVersion, Region};
use aws_sdk_s3::{Client, presigning::PresigningConfig};

use crate::config::AppConfig;

/// Private object-storage adapter. The API will expose presigned upload and
/// download operations only after authenticated resource authorization exists.
#[derive(Clone)]
pub struct S3Store {
    client: Client,
    bucket: String,
    presign_ttl: Duration,
}

impl S3Store {
    pub async fn from_config(config: &AppConfig) -> anyhow::Result<Option<Self>> {
        let Some(bucket) = config.s3_bucket.as_ref() else {
            tracing::info!("S3_BUCKET is unset; object storage is disabled");
            return Ok(None);
        };

        let shared = aws_config::defaults(BehaviorVersion::latest())
            .region(Region::new(config.aws_region.clone()))
            .load()
            .await;

        let mut builder = aws_sdk_s3::config::Builder::from(&shared);
        if let Some(endpoint) = config.s3_endpoint_url.as_deref() {
            builder = builder.endpoint_url(endpoint);
        }
        if config.s3_force_path_style || config.s3_endpoint_url.is_some() {
            builder = builder.force_path_style(true);
        }

        let client = Client::from_conf(builder.build());
        tracing::info!(region = %config.aws_region, "S3 object storage configured");

        Ok(Some(Self {
            client,
            bucket: bucket.clone(),
            presign_ttl: Duration::from_secs(config.s3_presign_ttl_seconds),
        }))
    }

    pub fn is_configured(&self) -> bool {
        !self.bucket.trim().is_empty()
    }

    /// Create a short-lived PUT URL for a generated object key.
    ///
    /// Callers must authorize the user, validate the content type and size,
    /// generate the key server-side and persist an upload intent before
    /// invoking this method. Never accept arbitrary client-supplied keys.
    #[allow(dead_code)]
    pub async fn presign_put(
        &self,
        object_key: &str,
        content_type: &str,
    ) -> anyhow::Result<String> {
        let signing =
            PresigningConfig::expires_in(self.presign_ttl).context("invalid S3 presign expiry")?;

        let request = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(object_key)
            .content_type(content_type)
            .presigned(signing)
            .await
            .context("could not create S3 upload signature")?;

        Ok(request.uri().to_string())
    }
}
