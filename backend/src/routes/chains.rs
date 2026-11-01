use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::Row;
use uuid::Uuid;

use crate::{
    auth::{AuthenticatedUser, OptionalAuthenticatedUser},
    state::AppState,
};

#[derive(Serialize)]
struct ApiErrorBody {
    error: &'static str,
    message: String,
}

struct ApiError {
    status: StatusCode,
    body: ApiErrorBody,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}

fn api_error(status: StatusCode, error: &'static str, message: impl Into<String>) -> ApiError {
    ApiError {
        status,
        body: ApiErrorBody {
            error,
            message: message.into(),
        },
    }
}

fn db_error(error: sqlx::Error, context: &'static str) -> ApiError {
    tracing::error!(%error, context, "Chains database operation failed");
    api_error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "chain_database_error",
        "Could not complete this Chain action.",
    )
}

#[derive(Deserialize)]
pub struct ListChainsQuery {
    limit: Option<i64>,
    offset: Option<i64>,
    kind: Option<String>,
    category: Option<String>,
    circle_id: Option<Uuid>,
    search: Option<String>,
    sort: Option<String>,
}

#[derive(Serialize)]
pub struct ChainSummary {
    id: Uuid,
    creator_id: Uuid,
    creator_username: String,
    creator_display_name: String,
    creator_avatar_url: Option<String>,
    circle_id: Option<Uuid>,
    title: String,
    description: String,
    prompt: String,
    kind: String,
    category: String,
    visibility: String,
    contribution_policy: String,
    status: String,
    cover_image_url: Option<String>,
    metadata: Value,
    contribution_count: i64,
    participant_count: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct ChainsResponse {
    chains: Vec<ChainSummary>,
    limit: i64,
    offset: i64,
}

#[derive(Deserialize)]
struct CreateChainInput {
    title: String,
    description: Option<String>,
    prompt: Option<String>,
    kind: Option<String>,
    category: Option<String>,
    visibility: Option<String>,
    contribution_policy: Option<String>,
    circle_id: Option<Uuid>,
    cover_image_url: Option<String>,
    metadata: Option<Value>,
}

#[derive(Serialize)]
struct ChainContribution {
    id: Uuid,
    chain_id: Uuid,
    author_id: Uuid,
    author_username: String,
    author_display_name: String,
    author_avatar_url: Option<String>,
    parent_contribution_id: Option<Uuid>,
    contribution_type: String,
    title: Option<String>,
    content: String,
    payload: Value,
    position: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct ChainDetailResponse {
    chain: ChainSummary,
    contributions: Vec<ChainContribution>,
    can_contribute: bool,
}

#[derive(Deserialize)]
struct CreateContributionInput {
    contribution_type: Option<String>,
    title: Option<String>,
    content: Option<String>,
    parent_contribution_id: Option<Uuid>,
    #[serde(default)]
    payload: Value,
}

#[derive(Serialize)]
struct CreatedContributionResponse {
    contribution: ChainContribution,
}

const CHAIN_KINDS: &[&str] = &[
    "story",
    "worldbuilding",
    "ranking",
    "playlist",
    "gallery",
    "challenge",
    "project",
    "recommendations",
    "open",
];

const CONTRIBUTION_TYPES: &[&str] = &[
    "text",
    "image",
    "video",
    "audio",
    "link",
    "list",
    "ranking",
    "poll",
    "document",
];

fn normalize_choice(value: Option<&str>, allowed: &[&str], default: &'static str) -> Option<String> {
    let normalized = value.unwrap_or(default).trim().to_lowercase();
    allowed.contains(&normalized.as_str()).then_some(normalized)
}

fn valid_visibility(value: Option<&str>) -> Option<String> {
    normalize_choice(value, &["public", "unlisted", "private", "circle"], "public")
}

fn valid_policy(value: Option<&str>) -> Option<String> {
    normalize_choice(value, &["open", "members", "circle_members"], "open")
}

fn valid_kind(value: Option<&str>) -> Option<String> {
    normalize_choice(value, CHAIN_KINDS, "open")
}

fn valid_contribution_type(value: Option<&str>) -> Option<String> {
    normalize_choice(value, CONTRIBUTION_TYPES, "text")
}

fn parse_summary(row: &sqlx::postgres::PgRow) -> Result<ChainSummary, ApiError> {
    Ok(ChainSummary {
        id: row.try_get("id").map_err(|e| db_error(e, "read chain id"))?,
        creator_id: row.try_get("creator_id").map_err(|e| db_error(e, "read creator id"))?,
        creator_username: row.try_get("creator_username").map_err(|e| db_error(e, "read creator username"))?,
        creator_display_name: row.try_get("creator_display_name").map_err(|e| db_error(e, "read creator name"))?,
        creator_avatar_url: row.try_get("creator_avatar_url").map_err(|e| db_error(e, "read creator avatar"))?,
        circle_id: row.try_get("circle_id").map_err(|e| db_error(e, "read Circle id"))?,
        title: row.try_get("title").map_err(|e| db_error(e, "read title"))?,
        description: row.try_get("description").map_err(|e| db_error(e, "read description"))?,
        prompt: row.try_get("prompt").map_err(|e| db_error(e, "read prompt"))?,
        kind: row.try_get("kind").map_err(|e| db_error(e, "read kind"))?,
        category: row.try_get("category").map_err(|e| db_error(e, "read category"))?,
        visibility: row.try_get("visibility").map_err(|e| db_error(e, "read visibility"))?,
        contribution_policy: row.try_get("contribution_policy").map_err(|e| db_error(e, "read contribution policy"))?,
        status: row.try_get("status").map_err(|e| db_error(e, "read status"))?,
        cover_image_url: row.try_get("cover_image_url").map_err(|e| db_error(e, "read cover"))?,
        metadata: row.try_get("metadata").map_err(|e| db_error(e, "read metadata"))?,
        contribution_count: row.try_get("contribution_count").map_err(|e| db_error(e, "read contribution count"))?,
        participant_count: row.try_get("participant_count").map_err(|e| db_error(e, "read participant count"))?,
        created_at: row.try_get("created_at").map_err(|e| db_error(e, "read created timestamp"))?,
        updated_at: row.try_get("updated_at").map_err(|e| db_error(e, "read updated timestamp"))?,
    })
}

const SUMMARY_SELECT: &str = r#"
    SELECT
        chain.id, chain.creator_id,
        creator.username AS creator_username,
        creator.display_name AS creator_display_name,
        creator.avatar_url AS creator_avatar_url,
        chain.circle_id, chain.title, chain.description, chain.prompt,
        chain.kind, chain.category, chain.visibility, chain.contribution_policy,
        chain.status, chain.cover_image_url, chain.metadata,
        chain.contribution_count, chain.participant_count,
        chain.created_at, chain.updated_at
    FROM chains AS chain
    JOIN profiles AS creator ON creator.id = chain.creator_id
"#;

pub async fn list(
    State(state): State<AppState>,
    user: OptionalAuthenticatedUser,
    Query(query): Query<ListChainsQuery>,
) -> Result<Json<ChainsResponse>, ApiError> {
    let limit = query.limit.unwrap_or(24).clamp(1, 50);
    let offset = query.offset.unwrap_or(0).clamp(0, 1_000_000);
    let kind = query.kind.as_deref().map(str::trim).filter(|value| !value.is_empty());
    let category = query.category.as_deref().map(str::trim).filter(|value| !value.is_empty());
    let search = query.search.as_deref().map(str::trim).filter(|value| !value.is_empty());
    if kind.is_some_and(|value| valid_kind(Some(value)).is_none()) {
        return Err(api_error(StatusCode::BAD_REQUEST, "invalid_chain_kind", "The selected Chain format is not supported."));
    }
    let sort = query.sort.as_deref().unwrap_or("recent");
    if !matches!(sort, "recent" | "active" | "contributions") {
        return Err(api_error(StatusCode::BAD_REQUEST, "invalid_chain_sort", "Sort must be recent, active or contributions."));
    }

    let sql = format!(
        "{SUMMARY_SELECT}
        WHERE chain.status IN ('active', 'completed')
          AND (
            (
              chain.visibility = 'public'
              AND (
                chain.circle_id IS NULL
                OR ($1::uuid IS NOT NULL AND (
                    EXISTS (
                        SELECT 1 FROM circles AS circle
                        WHERE circle.id = chain.circle_id AND circle.owner_id = $1
                    )
                    OR EXISTS (
                        SELECT 1 FROM circle_members AS circle_member
                        WHERE circle_member.circle_id = chain.circle_id
                          AND circle_member.user_id = $1
                          AND circle_member.status IN ('active', 'approved')
                    )
                ))
              )
            )
            OR (
              $1::uuid IS NOT NULL
              AND (
                chain.creator_id = $1
                OR EXISTS (
                    SELECT 1 FROM chain_members AS member
                    WHERE member.chain_id = chain.id AND member.user_id = $1
                )
              )
            )
          )
          AND ($2::text IS NULL OR chain.kind = $2)
          AND ($3::text IS NULL OR chain.category = $3)
          AND ($4::uuid IS NULL OR chain.circle_id = $4)
          AND ($5::text IS NULL OR chain.title ILIKE '%' || $5 || '%' OR chain.description ILIKE '%' || $5 || '%' OR chain.prompt ILIKE '%' || $5 || '%')
        ORDER BY
          CASE WHEN $6 = 'recent' THEN chain.created_at END DESC,
          CASE WHEN $6 = 'active' THEN chain.updated_at END DESC,
          CASE WHEN $6 = 'contributions' THEN chain.contribution_count END DESC,
          chain.updated_at DESC
        LIMIT $7 OFFSET $8"
    );

    let rows = sqlx::query(&sql)
        .bind(user.0.as_ref().map(|authenticated| authenticated.id))
        .bind(kind)
        .bind(category)
        .bind(query.circle_id)
        .bind(search)
        .bind(sort)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.database)
        .await
        .map_err(|error| db_error(error, "list chains"))?;

    let chains = rows.iter().map(parse_summary).collect::<Result<Vec<_>, _>>()?;
    Ok(Json(ChainsResponse { chains, limit, offset }))
}

pub async fn create(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Json(input): Json<CreateChainInput>,
) -> Result<(StatusCode, Json<ChainSummary>), ApiError> {
    let title = input.title.trim();
    if title.is_empty() || title.chars().count() > 120 {
        return Err(api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_chain_title", "Chain titles must contain between 1 and 120 characters."));
    }

    let description = input.description.unwrap_or_default();
    let prompt = input.prompt.unwrap_or_default();
    if description.chars().count() > 2_000 || prompt.chars().count() > 1_200 {
        return Err(api_error(StatusCode::UNPROCESSABLE_ENTITY, "chain_text_too_long", "Descriptions are limited to 2,000 characters and prompts to 1,200."));
    }

    let kind = valid_kind(input.kind.as_deref()).ok_or_else(|| api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_chain_kind", "Choose a supported Chain format."))?;
    let visibility = valid_visibility(input.visibility.as_deref()).ok_or_else(|| api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_chain_visibility", "Visibility must be public, unlisted, private or circle."))?;
    let policy = valid_policy(input.contribution_policy.as_deref()).ok_or_else(|| api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_contribution_policy", "Contribution policy must be open, members or circle_members."))?;
    let category = input.category.unwrap_or_else(|| "general".to_owned()).trim().to_lowercase();
    if category.is_empty() || category.chars().count() > 40 {
        return Err(api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_chain_category", "Choose a category of 1 to 40 characters."));
    }
    if (visibility == "circle") != input.circle_id.is_some() {
        return Err(api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_circle_scope", "Circle visibility requires a Circle, and Circle-scoped Chains must use Circle visibility."));
    }
    if input.cover_image_url.as_deref().is_some_and(|value| !value.trim().is_empty() && !value.trim().starts_with("https://")) {
        return Err(api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_chain_cover", "Cover images must use HTTPS."));
    }
    let metadata = input.metadata.unwrap_or_else(|| serde_json::json!({}));
    if !metadata.is_object() || serde_json::to_vec(&metadata).map_or(true, |value| value.len() > 32 * 1024) {
        return Err(api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_chain_metadata", "Chain metadata must be an object no larger than 32 KiB."));
    }

    let mut transaction = state.database.begin().await.map_err(|error| db_error(error, "begin Chain creation"))?;
    if let Some(circle_id) = input.circle_id {
        let can_create_in_circle = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM circles AS circle
                WHERE circle.id = $1 AND (
                    circle.owner_id = $2
                    OR EXISTS (
                        SELECT 1 FROM circle_members AS member
                        WHERE member.circle_id = circle.id
                          AND member.user_id = $2
                          AND member.status IN ('active', 'approved')
                    )
                )
            )
            "#,
        )
        .bind(circle_id)
        .bind(user.id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| db_error(error, "authorize Circle Chain creation"))?;
        if !can_create_in_circle {
            return Err(api_error(StatusCode::FORBIDDEN, "circle_membership_required", "Join this Circle before creating a Chain inside it."));
        }
    }

    let inserted = sqlx::query(
        r#"
        INSERT INTO chains (
            creator_id, circle_id, title, description, prompt, kind, category,
            visibility, contribution_policy, cover_image_url, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id, creator_id, circle_id, title, description, prompt, kind, category,
                  visibility, contribution_policy, status, cover_image_url, metadata,
                  contribution_count, participant_count, created_at, updated_at
        "#,
    )
    .bind(user.id)
    .bind(input.circle_id)
    .bind(title)
    .bind(description.trim())
    .bind(prompt.trim())
    .bind(kind)
    .bind(category)
    .bind(visibility)
    .bind(policy)
    .bind(input.cover_image_url)
    .bind(metadata)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "insert Chain"))?;

    let chain_id: Uuid = inserted.try_get("id").map_err(|e| db_error(e, "read new Chain id"))?;
    sqlx::query("INSERT INTO chain_members (chain_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT (chain_id, user_id) DO NOTHING")
        .bind(chain_id)
        .bind(user.id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| db_error(error, "add Chain owner"))?;

    transaction.commit().await.map_err(|error| db_error(error, "commit Chain creation"))?;

    let summary = ChainSummary {
        id: chain_id,
        creator_id: user.id,
        creator_username: user.username,
        creator_display_name: user.display_name,
        creator_avatar_url: user.avatar_url,
        circle_id: inserted.try_get("circle_id").map_err(|e| db_error(e, "read Circle id"))?,
        title: inserted.try_get("title").map_err(|e| db_error(e, "read title"))?,
        description: inserted.try_get("description").map_err(|e| db_error(e, "read description"))?,
        prompt: inserted.try_get("prompt").map_err(|e| db_error(e, "read prompt"))?,
        kind: inserted.try_get("kind").map_err(|e| db_error(e, "read kind"))?,
        category: inserted.try_get("category").map_err(|e| db_error(e, "read category"))?,
        visibility: inserted.try_get("visibility").map_err(|e| db_error(e, "read visibility"))?,
        contribution_policy: inserted.try_get("contribution_policy").map_err(|e| db_error(e, "read contribution policy"))?,
        status: inserted.try_get("status").map_err(|e| db_error(e, "read status"))?,
        cover_image_url: inserted.try_get("cover_image_url").map_err(|e| db_error(e, "read cover"))?,
        metadata: inserted.try_get("metadata").map_err(|e| db_error(e, "read metadata"))?,
        contribution_count: inserted.try_get("contribution_count").map_err(|e| db_error(e, "read contribution count"))?,
        participant_count: inserted.try_get("participant_count").map_err(|e| db_error(e, "read participant count"))?,
        created_at: inserted.try_get("created_at").map_err(|e| db_error(e, "read creation timestamp"))?,
        updated_at: inserted.try_get("updated_at").map_err(|e| db_error(e, "read update timestamp"))?,
    };

    Ok((StatusCode::CREATED, Json(summary)))
}

pub async fn get(
    State(state): State<AppState>,
    user: OptionalAuthenticatedUser,
    Path(chain_id): Path<Uuid>,
) -> Result<Json<ChainDetailResponse>, ApiError> {
    let viewer_id = user.0.as_ref().map(|authenticated| authenticated.id);
    let sql = format!(
        "{SUMMARY_SELECT}
        WHERE chain.id = $1
          AND (
            (
              chain.visibility IN ('public', 'unlisted')
              AND (
                chain.circle_id IS NULL
                OR ($2::uuid IS NOT NULL AND (
                    EXISTS (
                        SELECT 1 FROM circles AS circle
                        WHERE circle.id = chain.circle_id AND circle.owner_id = $2
                    )
                    OR EXISTS (
                        SELECT 1 FROM circle_members AS member
                        WHERE member.circle_id = chain.circle_id
                          AND member.user_id = $2
                          AND member.status IN ('active', 'approved')
                    )
                ))
              )
            )
            OR (
              $2::uuid IS NOT NULL
              AND (
                chain.creator_id = $2
                OR EXISTS (
                    SELECT 1 FROM chain_members AS member
                    WHERE member.chain_id = chain.id AND member.user_id = $2
                )
              )
            )
          )"
    );
    let row = sqlx::query(&sql)
        .bind(chain_id)
        .bind(viewer_id)
        .fetch_optional(&state.database)
        .await
        .map_err(|error| db_error(error, "load Chain"))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "chain_not_found", "This Chain is unavailable."))?;
    let chain = parse_summary(&row)?;

    let can_contribute = if let Some(viewer_id) = viewer_id {
        sqlx::query_scalar::<_, bool>(
            r#"
            SELECT
                chain.creator_id = $2
                OR EXISTS (
                    SELECT 1 FROM chain_members AS member
                    WHERE member.chain_id = chain.id AND member.user_id = $2
                )
                OR (
                    chain.contribution_policy = 'open'
                    AND (
                        chain.circle_id IS NULL
                        OR EXISTS (
                            SELECT 1 FROM circles AS circle
                            WHERE circle.id = chain.circle_id AND circle.owner_id = $2
                        )
                        OR EXISTS (
                            SELECT 1 FROM circle_members AS member
                            WHERE member.circle_id = chain.circle_id
                              AND member.user_id = $2
                              AND member.status IN ('active', 'approved')
                        )
                    )
                )
                OR (
                    chain.contribution_policy = 'circle_members'
                    AND (
                        EXISTS (
                            SELECT 1 FROM circles AS circle
                            WHERE circle.id = chain.circle_id AND circle.owner_id = $2
                        )
                        OR EXISTS (
                            SELECT 1 FROM circle_members AS member
                            WHERE member.circle_id = chain.circle_id
                              AND member.user_id = $2
                              AND member.status IN ('active', 'approved')
                        )
                    )
                )
            FROM chains AS chain
            WHERE chain.id = $1
            "#,
        )
        .bind(chain_id)
        .bind(viewer_id)
        .fetch_one(&state.database)
        .await
        .map_err(|error| db_error(error, "check Chain contribution permission"))?
    } else {
        false
    };

    let rows = sqlx::query(
        r#"
        SELECT
            contribution.id, contribution.chain_id, contribution.author_id,
            profile.username AS author_username,
            profile.display_name AS author_display_name,
            profile.avatar_url AS author_avatar_url,
            contribution.parent_contribution_id, contribution.contribution_type,
            contribution.title, contribution.content, contribution.payload,
            contribution.position, contribution.created_at, contribution.updated_at
        FROM chain_contributions AS contribution
        JOIN profiles AS profile ON profile.id = contribution.author_id
        WHERE contribution.chain_id = $1 AND contribution.status = 'published'
        ORDER BY contribution.position ASC
        LIMIT 100
        "#,
    )
    .bind(chain_id)
    .fetch_all(&state.database)
    .await
    .map_err(|error| db_error(error, "load Chain contributions"))?;

    let contributions = rows
        .into_iter()
        .map(|row| {
            Ok(ChainContribution {
                id: row.try_get("id").map_err(|e| db_error(e, "read contribution id"))?,
                chain_id: row.try_get("chain_id").map_err(|e| db_error(e, "read contribution Chain id"))?,
                author_id: row.try_get("author_id").map_err(|e| db_error(e, "read contribution author"))?,
                author_username: row.try_get("author_username").map_err(|e| db_error(e, "read contribution username"))?,
                author_display_name: row.try_get("author_display_name").map_err(|e| db_error(e, "read contribution name"))?,
                author_avatar_url: row.try_get("author_avatar_url").map_err(|e| db_error(e, "read contribution avatar"))?,
                parent_contribution_id: row.try_get("parent_contribution_id").map_err(|e| db_error(e, "read contribution parent"))?,
                contribution_type: row.try_get("contribution_type").map_err(|e| db_error(e, "read contribution type"))?,
                title: row.try_get("title").map_err(|e| db_error(e, "read contribution title"))?,
                content: row.try_get("content").map_err(|e| db_error(e, "read contribution content"))?,
                payload: row.try_get("payload").map_err(|e| db_error(e, "read contribution payload"))?,
                position: row.try_get("position").map_err(|e| db_error(e, "read contribution position"))?,
                created_at: row.try_get("created_at").map_err(|e| db_error(e, "read contribution timestamp"))?,
                updated_at: row.try_get("updated_at").map_err(|e| db_error(e, "read contribution update timestamp"))?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(ChainDetailResponse { chain, contributions, can_contribute }))
}

pub async fn contribute(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(chain_id): Path<Uuid>,
    Json(input): Json<CreateContributionInput>,
) -> Result<(StatusCode, Json<CreatedContributionResponse>), ApiError> {
    let contribution_type = valid_contribution_type(input.contribution_type.as_deref())
        .ok_or_else(|| api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_contribution_type", "This contribution format is not supported."))?;
    let title = input.title.unwrap_or_default();
    let content = input.content.unwrap_or_default();
    if title.chars().count() > 120 || content.chars().count() > 8_000 {
        return Err(api_error(StatusCode::UNPROCESSABLE_ENTITY, "contribution_too_long", "Contribution titles are limited to 120 characters and content to 8,000."));
    }
    if title.trim().is_empty() && content.trim().is_empty() && input.payload == Value::Null {
        return Err(api_error(StatusCode::UNPROCESSABLE_ENTITY, "empty_contribution", "Add text or structured content before contributing."));
    }
    if serde_json::to_vec(&input.payload).map_or(true, |value| value.len() > 64 * 1024) {
        return Err(api_error(StatusCode::UNPROCESSABLE_ENTITY, "contribution_payload_too_large", "Structured contribution data cannot exceed 64 KiB."));
    }

    let mut transaction = state.database.begin().await.map_err(|error| db_error(error, "begin Chain contribution"))?;
    let chain = sqlx::query(
        "SELECT creator_id, circle_id, contribution_policy, visibility, status FROM chains WHERE id = $1 FOR UPDATE",
    )
    .bind(chain_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "lock Chain"))?
    .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "chain_not_found", "This Chain is unavailable."))?;

    let creator_id: Uuid = chain.try_get("creator_id").map_err(|e| db_error(e, "read Chain creator"))?;
    let circle_id: Option<Uuid> = chain.try_get("circle_id").map_err(|e| db_error(e, "read Chain Circle"))?;
    let policy: String = chain.try_get("contribution_policy").map_err(|e| db_error(e, "read contribution policy"))?;
    let visibility: String = chain.try_get("visibility").map_err(|e| db_error(e, "read Chain visibility"))?;
    let status: String = chain.try_get("status").map_err(|e| db_error(e, "read Chain status"))?;
    if status != "active" {
        return Err(api_error(StatusCode::CONFLICT, "chain_not_active", "This Chain is not accepting new contributions."));
    }

    let is_chain_member = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM chain_members WHERE chain_id = $1 AND user_id = $2)",
    )
    .bind(chain_id)
    .bind(user.id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "check Chain membership"))?;

    let is_circle_member = if let Some(circle_id) = circle_id {
        sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM circles AS circle
                WHERE circle.id = $1 AND (
                    circle.owner_id = $2 OR EXISTS (
                        SELECT 1 FROM circle_members AS member
                        WHERE member.circle_id = circle.id
                          AND member.user_id = $2
                          AND member.status IN ('active', 'approved')
                    )
                )
            )
            "#,
        )
        .bind(circle_id)
        .bind(user.id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| db_error(error, "check Circle membership"))?
    } else {
        false
    };

    let is_creator = creator_id == user.id;
    let circle_scope_allowed = circle_id.is_none() || is_circle_member;
    let publicly_accessible = matches!(visibility.as_str(), "public" | "unlisted") && circle_scope_allowed;
    let may_access = is_creator || is_chain_member || publicly_accessible;
    if !may_access {
        return Err(api_error(StatusCode::FORBIDDEN, "chain_access_denied", "You do not have access to this Chain."));
    }

    let may_contribute = is_creator
        || is_chain_member
        || (policy == "open" && (publicly_accessible || is_circle_member))
        || (policy == "circle_members" && is_circle_member);
    if !may_contribute {
        return Err(api_error(StatusCode::FORBIDDEN, "chain_contribution_restricted", "This Chain only accepts contributions from its members."));
    }

    if let Some(parent_id) = input.parent_contribution_id {
        let parent_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM chain_contributions WHERE id = $1 AND chain_id = $2 AND status = 'published')",
        )
        .bind(parent_id)
        .bind(chain_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| db_error(error, "validate contribution parent"))?;
        if !parent_exists {
            return Err(api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_contribution_parent", "The parent contribution must belong to this Chain and be published."));
        }
    }

    let position: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position), 0) + 1 FROM chain_contributions WHERE chain_id = $1",
    )
    .bind(chain_id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "allocate contribution position"))?;

    let payload = if input.payload.is_null() { serde_json::json!({}) } else { input.payload };
    let row = sqlx::query(
        r#"
        INSERT INTO chain_contributions (
            chain_id, author_id, parent_contribution_id, contribution_type,
            title, content, payload, position
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, chain_id, author_id, parent_contribution_id, contribution_type,
                  title, content, payload, position, created_at, updated_at
        "#,
    )
    .bind(chain_id)
    .bind(user.id)
    .bind(input.parent_contribution_id)
    .bind(contribution_type)
    .bind(if title.trim().is_empty() { None } else { Some(title.trim()) })
    .bind(content.trim())
    .bind(payload)
    .bind(position)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "insert Chain contribution"))?;

    sqlx::query(
        "INSERT INTO chain_members (chain_id, user_id, role) VALUES ($1, $2, 'contributor') ON CONFLICT (chain_id, user_id) DO NOTHING",
    )
    .bind(chain_id)
    .bind(user.id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "record Chain contributor"))?;

    sqlx::query(
        r#"
        UPDATE chains
        SET contribution_count = (
                SELECT COUNT(*) FROM chain_contributions
                WHERE chain_id = $1 AND status = 'published'
            ),
            participant_count = (
                SELECT COUNT(*) FROM chain_members WHERE chain_id = $1
            ),
            updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(chain_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "update Chain counters"))?;

    transaction.commit().await.map_err(|error| db_error(error, "commit Chain contribution"))?;

    let contribution = ChainContribution {
        id: row.try_get("id").map_err(|e| db_error(e, "read new contribution id"))?,
        chain_id: row.try_get("chain_id").map_err(|e| db_error(e, "read new contribution Chain id"))?,
        author_id: row.try_get("author_id").map_err(|e| db_error(e, "read new contribution author"))?,
        author_username: user.username,
        author_display_name: user.display_name,
        author_avatar_url: user.avatar_url,
        parent_contribution_id: row.try_get("parent_contribution_id").map_err(|e| db_error(e, "read contribution parent"))?,
        contribution_type: row.try_get("contribution_type").map_err(|e| db_error(e, "read contribution type"))?,
        title: row.try_get("title").map_err(|e| db_error(e, "read contribution title"))?,
        content: row.try_get("content").map_err(|e| db_error(e, "read contribution content"))?,
        payload: row.try_get("payload").map_err(|e| db_error(e, "read contribution payload"))?,
        position: row.try_get("position").map_err(|e| db_error(e, "read contribution position"))?,
        created_at: row.try_get("created_at").map_err(|e| db_error(e, "read contribution creation time"))?,
        updated_at: row.try_get("updated_at").map_err(|e| db_error(e, "read contribution update time"))?,
    };

    Ok((StatusCode::CREATED, Json(CreatedContributionResponse { contribution })))
}

#[cfg(test)]
mod tests {
    use super::{valid_contribution_type, valid_kind, valid_policy, valid_visibility};

    #[test]
    fn supports_collaborative_chain_formats() {
        for kind in ["story", "worldbuilding", "ranking", "playlist", "gallery", "challenge", "project", "recommendations", "open"] {
            assert_eq!(valid_kind(Some(kind)).as_deref(), Some(kind));
        }
        assert!(valid_kind(Some("short_video_feed")).is_none());
    }

    #[test]
    fn defaults_chain_format_and_visibility_safely() {
        assert_eq!(valid_kind(None).as_deref(), Some("open"));
        assert_eq!(valid_visibility(None).as_deref(), Some("public"));
        assert_eq!(valid_policy(None).as_deref(), Some("open"));
    }

    #[test]
    fn rejects_unknown_visibility_and_contribution_policies() {
        assert!(valid_visibility(Some("world-readable")).is_none());
        assert!(valid_policy(Some("anyone-and-everyone")).is_none());
    }

    #[test]
    fn validates_rich_contribution_types() {
        assert_eq!(valid_contribution_type(Some("image")).as_deref(), Some("image"));
        assert_eq!(valid_contribution_type(Some("poll")).as_deref(), Some("poll"));
        assert!(valid_contribution_type(Some("executable")).is_none());
    }
}
