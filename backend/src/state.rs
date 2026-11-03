use sqlx::PgPool;

use crate::storage::S3Store;

#[derive(Clone)]
pub struct AppState {
    pub database: PgPool,
    pub storage: Option<S3Store>,
}
