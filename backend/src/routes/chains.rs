use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::Row;
use url::Url;
use uuid::Uuid;

use crate::{
    auth::{AuthenticatedUser, OptionalAuthenticatedUser},
    notification_events,
    state::AppState,
};

#[derive(Serialize)]
struct ApiErrorBody {
    error: &'static str,
    message: String,
}

pub struct ApiError {
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

fn is_valid_https_url(value: &str) -> bool {
    Url::parse(value).is_ok_and(|url| url.scheme() == "https")
}

#[derive(Deserialize)]
pub struct ListChainsQuery {
    limit: Option<i64>,
    offset: Option<i64>,
    kind: Option<String>,
    category: Option<String>,
    circle_id: Option<Uuid>,
    creator_id: Option<Uuid>,
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
    source_chain_id: Option<Uuid>,
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
pub struct ChainsResponse {
    chains: Vec<ChainSummary>,
    limit: i64,
    offset: i64,
    has_more: bool,
}

#[derive(Deserialize)]
pub struct CreateChainInput {
    title: String,
    description: Option<String>,
    prompt: Option<String>,
    kind: Option<String>,
    category: Option<String>,
    visibility: Option<String>,
    contribution_policy: Option<String>,
    circle_id: Option<Uuid>,
    source_drop_id: Option<Uuid>,
    cover_image_url: Option<String>,
    metadata: Option<Value>,
}

#[derive(Serialize)]
pub struct ChainContribution {
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
pub struct ChainMemberSummary {
    user_id: Uuid,
    username: String,
    display_name: String,
    avatar_url: Option<String>,
    role: String,
    joined_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct ChainDetailResponse {
    chain: ChainSummary,
    contributions: Vec<ChainContribution>,
    can_contribute: bool,
    can_manage: bool,
    members: Vec<ChainMemberSummary>,
    contributions_limit: i64,
    contributions_offset: i64,
    contributions_has_more: bool,
}

#[derive(Deserialize)]
pub struct ContributionPageQuery {
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Deserialize)]
pub struct CreateContributionInput {
    contribution_type: Option<String>,
    title: Option<String>,
    content: Option<String>,
    parent_contribution_id: Option<Uuid>,
    #[serde(default)]
    payload: Value,
}

#[derive(Serialize)]
pub struct CreatedContributionResponse {
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
    "text", "image", "video", "audio", "link", "list", "ranking", "poll", "document",
];

fn normalize_choice(
    value: Option<&str>,
    allowed: &[&str],
    default: &'static str,
) -> Option<String> {
    let normalized = value.unwrap_or(default).trim().to_lowercase();
    allowed.contains(&normalized.as_str()).then_some(normalized)
}

fn valid_visibility(value: Option<&str>) -> Option<String> {
    normalize_choice(
        value,
        &["public", "unlisted", "private", "circle"],
        "public",
    )
}

fn valid_policy(value: Option<&str>) -> Option<String> {
    normalize_choice(value, &["open", "members", "circle_members"], "open")
}

fn valid_kind(value: Option<&str>) -> Option<String> {
    normalize_choice(value, CHAIN_KINDS, "open")
}

fn valid_chain_status(value: &str) -> Option<String> {
    normalize_choice(
        Some(value),
        &["active", "paused", "completed", "archived"],
        "active",
    )
}

/// Chain completion and archival are terminal; paused Chains may resume.
fn can_transition_chain_status(current: &str, next: &str) -> bool {
    match current {
        "active" => matches!(next, "active" | "paused" | "completed" | "archived"),
        "paused" => matches!(next, "paused" | "active" | "completed" | "archived"),
        "completed" => matches!(next, "completed" | "archived"),
        "archived" => next == "archived",
        _ => false,
    }
}

fn valid_contribution_type(value: Option<&str>) -> Option<String> {
    normalize_choice(value, CONTRIBUTION_TYPES, "text")
}

fn parse_summary(row: &sqlx::postgres::PgRow) -> Result<ChainSummary, ApiError> {
    Ok(ChainSummary {
        id: row
            .try_get("id")
            .map_err(|e| db_error(e, "read chain id"))?,
        creator_id: row
            .try_get("creator_id")
            .map_err(|e| db_error(e, "read creator id"))?,
        creator_username: row
            .try_get("creator_username")
            .map_err(|e| db_error(e, "read creator username"))?,
        creator_display_name: row
            .try_get("creator_display_name")
            .map_err(|e| db_error(e, "read creator name"))?,
        creator_avatar_url: row
            .try_get("creator_avatar_url")
            .map_err(|e| db_error(e, "read creator avatar"))?,
        circle_id: row
            .try_get("circle_id")
            .map_err(|e| db_error(e, "read Circle id"))?,
        source_chain_id: row
            .try_get("source_chain_id")
            .map_err(|e| db_error(e, "read source Chain id"))?,
        title: row
            .try_get("title")
            .map_err(|e| db_error(e, "read title"))?,
        description: row
            .try_get("description")
            .map_err(|e| db_error(e, "read description"))?,
        prompt: row
            .try_get("prompt")
            .map_err(|e| db_error(e, "read prompt"))?,
        kind: row.try_get("kind").map_err(|e| db_error(e, "read kind"))?,
        category: row
            .try_get("category")
            .map_err(|e| db_error(e, "read category"))?,
        visibility: row
            .try_get("visibility")
            .map_err(|e| db_error(e, "read visibility"))?,
        contribution_policy: row
            .try_get("contribution_policy")
            .map_err(|e| db_error(e, "read contribution policy"))?,
        status: row
            .try_get("status")
            .map_err(|e| db_error(e, "read status"))?,
        cover_image_url: row
            .try_get("cover_image_url")
            .map_err(|e| db_error(e, "read cover"))?,
        metadata: row
            .try_get("metadata")
            .map_err(|e| db_error(e, "read metadata"))?,
        contribution_count: row
            .try_get("contribution_count")
            .map_err(|e| db_error(e, "read contribution count"))?,
        participant_count: row
            .try_get("participant_count")
            .map_err(|e| db_error(e, "read participant count"))?,
        created_at: row
            .try_get("created_at")
            .map_err(|e| db_error(e, "read created timestamp"))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|e| db_error(e, "read updated timestamp"))?,
    })
}

const SUMMARY_SELECT: &str = r#"
    SELECT
        chain.id, chain.creator_id,
        creator.username AS creator_username,
        creator.display_name AS creator_display_name,
        creator.avatar_url AS creator_avatar_url,
        chain.circle_id, chain.source_chain_id, chain.title, chain.description, chain.prompt,
        chain.kind, chain.category, chain.visibility, chain.contribution_policy,
        chain.status, chain.cover_image_url, chain.metadata,
        chain.contribution_count, chain.participant_count,
        chain.created_at, chain.updated_at
    FROM chains AS chain
    JOIN profiles AS creator ON creator.id = chain.creator_id
"#;

fn can_access_chain(
    visibility: &str,
    has_circle: bool,
    is_creator: bool,
    is_chain_member: bool,
    is_circle_member: bool,
) -> bool {
    if visibility == "circle" {
        return has_circle && is_circle_member;
    }
    if is_creator || is_chain_member {
        return true;
    }
    matches!(visibility, "public" | "unlisted") && (!has_circle || is_circle_member)
}

pub(crate) fn can_contribute_to_chain(
    policy: &str,
    visibility: &str,
    has_circle: bool,
    is_creator: bool,
    chain_member_role: Option<&str>,
    is_circle_member: bool,
) -> bool {
    if visibility == "circle" && (!has_circle || !is_circle_member) {
        return false;
    }
    let is_contributing_member = matches!(
        chain_member_role,
        Some("owner" | "collaborator" | "contributor")
    );
    if is_creator {
        return true;
    }
    // An explicit viewer assignment is read-only, even when the Chain's
    // general policy is open to the public or Circle members.
    if chain_member_role == Some("viewer") {
        return false;
    }
    if is_contributing_member {
        return true;
    }
    match policy {
        "members" => false,
        "circle_members" => has_circle && is_circle_member,
        "open" => matches!(visibility, "public" | "unlisted") && (!has_circle || is_circle_member),
        _ => false,
    }
}

pub async fn list(
    State(state): State<AppState>,
    user: OptionalAuthenticatedUser,
    Query(query): Query<ListChainsQuery>,
) -> Result<Json<ChainsResponse>, ApiError> {
    let limit = query.limit.unwrap_or(24).clamp(1, 50);
    let offset = query.offset.unwrap_or(0).clamp(0, 1_000_000);
    let kind = query
        .kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let category = query
        .category
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let search = query
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if kind.is_some_and(|value| valid_kind(Some(value)).is_none()) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "invalid_chain_kind",
            "The selected Chain format is not supported.",
        ));
    }
    let sort = query.sort.as_deref().unwrap_or("recent");
    if !matches!(sort, "recent" | "active" | "contributions") {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "invalid_chain_sort",
            "Sort must be recent, active or contributions.",
        ));
    }

    let sql = format!(
        "{SUMMARY_SELECT}
        WHERE chain.status IN ('active', 'completed')
          AND (
            (
              chain.visibility IN ('public', 'circle')
              AND (
                chain.circle_id IS NULL
                OR ($1::uuid IS NOT NULL AND EXISTS (
                    SELECT 1 FROM circle_members AS circle_member
                    WHERE circle_member.circle_id = chain.circle_id
                      AND circle_member.user_id = $1
                      AND circle_member.status IN ('active', 'approved')
                ))
              )
            )
            OR (
              $1::uuid IS NOT NULL
              AND (
                chain.visibility <> 'circle'
                OR EXISTS (
                    SELECT 1 FROM circle_members AS circle_member
                    WHERE circle_member.circle_id = chain.circle_id
                      AND circle_member.user_id = $1
                      AND circle_member.status IN ('active', 'approved')
                )
                OR EXISTS (
                    SELECT 1 FROM circles AS circle
                    WHERE circle.id = chain.circle_id AND circle.owner_id = $1
                )
              )
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
          AND ($5::uuid IS NULL OR chain.creator_id = $5)
          AND ($6::text IS NULL OR chain.title ILIKE '%' || $6 || '%' OR chain.description ILIKE '%' || $6 || '%' OR chain.prompt ILIKE '%' || $6 || '%')
        ORDER BY
          CASE WHEN $7 = 'recent' THEN chain.created_at END DESC,
          CASE WHEN $7 = 'active' THEN chain.updated_at END DESC,
          CASE WHEN $7 = 'contributions' THEN chain.contribution_count END DESC,
          chain.updated_at DESC
        LIMIT $8 OFFSET $9"
    );

    let rows = sqlx::query(&sql)
        .bind(user.0.as_ref().map(|authenticated| authenticated.id))
        .bind(kind)
        .bind(category)
        .bind(query.circle_id)
        .bind(query.creator_id)
        .bind(search)
        .bind(sort)
        .bind(limit + 1)
        .bind(offset)
        .fetch_all(&state.database)
        .await
        .map_err(|error| db_error(error, "list chains"))?;

    let has_more = rows.len() > limit as usize;
    let mut rows = rows;
    rows.truncate(limit as usize);
    let chains = rows
        .iter()
        .map(parse_summary)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(ChainsResponse {
        chains,
        limit,
        offset,
        has_more,
    }))
}

fn insert_circle_challenge_origin(
    metadata: &mut Value,
    drop_id: Uuid,
    circle_id: Uuid,
    title: String,
) -> Result<(), ApiError> {
    let object = metadata.as_object_mut().ok_or_else(|| {
        api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_chain_metadata",
            "Chain metadata must be an object.",
        )
    })?;

    if object.contains_key("origin") {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "reserved_chain_origin",
            "Chain origin metadata is generated by the server.",
        ));
    }

    object.insert(
        "origin".to_owned(),
        json!({
            "type": "circle_challenge",
            "id": drop_id,
            "circle_id": circle_id,
            "title": title,
        }),
    );
    Ok(())
}

pub async fn create(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Json(input): Json<CreateChainInput>,
) -> Result<(StatusCode, Json<ChainSummary>), ApiError> {
    let title = input.title.trim();
    if title.is_empty() || title.chars().count() > 120 {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_chain_title",
            "Chain titles must contain between 1 and 120 characters.",
        ));
    }

    let description = input.description.unwrap_or_default();
    let prompt = input.prompt.unwrap_or_default();
    if description.chars().count() > 2_000 || prompt.chars().count() > 1_200 {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "chain_text_too_long",
            "Descriptions are limited to 2,000 characters and prompts to 1,200.",
        ));
    }

    let kind = valid_kind(input.kind.as_deref()).ok_or_else(|| {
        api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_chain_kind",
            "Choose a supported Chain format.",
        )
    })?;
    let visibility = valid_visibility(input.visibility.as_deref()).ok_or_else(|| {
        api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_chain_visibility",
            "Visibility must be public, unlisted, private or circle.",
        )
    })?;
    let policy = valid_policy(input.contribution_policy.as_deref()).ok_or_else(|| {
        api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_contribution_policy",
            "Contribution policy must be open, members or circle_members.",
        )
    })?;
    let category = input
        .category
        .unwrap_or_else(|| "general".to_owned())
        .trim()
        .to_lowercase();
    if category.is_empty() || category.chars().count() > 40 {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_chain_category",
            "Choose a category of 1 to 40 characters.",
        ));
    }
    if (visibility == "circle") != input.circle_id.is_some() {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_circle_scope",
            "Circle visibility requires a Circle, and Circle-scoped Chains must use Circle visibility.",
        ));
    }
    if input
        .cover_image_url
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty() && !is_valid_https_url(value.trim()))
    {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_chain_cover",
            "Cover images must use HTTPS.",
        ));
    }
    let mut metadata = input.metadata.unwrap_or_else(|| serde_json::json!({}));
    if !metadata.is_object()
        || serde_json::to_vec(&metadata).map_or(true, |value| value.len() > 32 * 1024)
    {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_chain_metadata",
            "Chain metadata must be an object no larger than 32 KiB.",
        ));
    }

    if metadata.get("origin").is_some() {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "reserved_chain_origin",
            "Chain origin metadata is generated by the server.",
        ));
    }

    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|error| db_error(error, "begin Chain creation"))?;
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
            return Err(api_error(
                StatusCode::FORBIDDEN,
                "circle_membership_required",
                "Join this Circle before creating a Chain inside it.",
            ));
        }
    }

    if let Some(source_drop_id) = input.source_drop_id {
        let circle_id = input.circle_id.ok_or_else(|| {
            api_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "drop_origin_requires_circle",
                "A Chain started from a Circle Drop must remain inside that Circle.",
            )
        })?;

        let source_title = sqlx::query_scalar::<_, String>(
            "SELECT title FROM circle_challenges WHERE id = $1 AND circle_id = $2",
        )
        .bind(source_drop_id)
        .bind(circle_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| db_error(error, "verify source Circle Drop"))?
        .ok_or_else(|| {
            api_error(
                StatusCode::NOT_FOUND,
                "source_drop_not_found",
                "This Circle Drop is no longer available.",
            )
        })?;

        insert_circle_challenge_origin(&mut metadata, source_drop_id, circle_id, source_title)?;
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

    let chain_id: Uuid = inserted
        .try_get("id")
        .map_err(|e| db_error(e, "read new Chain id"))?;
    sqlx::query("INSERT INTO chain_members (chain_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT (chain_id, user_id) DO NOTHING")
        .bind(chain_id)
        .bind(user.id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| db_error(error, "add Chain owner"))?;

    transaction
        .commit()
        .await
        .map_err(|error| db_error(error, "commit Chain creation"))?;

    let summary = ChainSummary {
        id: chain_id,
        creator_id: user.id,
        creator_username: user.username,
        creator_display_name: user.display_name,
        creator_avatar_url: user.avatar_url,
        circle_id: inserted
            .try_get("circle_id")
            .map_err(|e| db_error(e, "read Circle id"))?,
        source_chain_id: None,
        title: inserted
            .try_get("title")
            .map_err(|e| db_error(e, "read title"))?,
        description: inserted
            .try_get("description")
            .map_err(|e| db_error(e, "read description"))?,
        prompt: inserted
            .try_get("prompt")
            .map_err(|e| db_error(e, "read prompt"))?,
        kind: inserted
            .try_get("kind")
            .map_err(|e| db_error(e, "read kind"))?,
        category: inserted
            .try_get("category")
            .map_err(|e| db_error(e, "read category"))?,
        visibility: inserted
            .try_get("visibility")
            .map_err(|e| db_error(e, "read visibility"))?,
        contribution_policy: inserted
            .try_get("contribution_policy")
            .map_err(|e| db_error(e, "read contribution policy"))?,
        status: inserted
            .try_get("status")
            .map_err(|e| db_error(e, "read status"))?,
        cover_image_url: inserted
            .try_get("cover_image_url")
            .map_err(|e| db_error(e, "read cover"))?,
        metadata: inserted
            .try_get("metadata")
            .map_err(|e| db_error(e, "read metadata"))?,
        contribution_count: inserted
            .try_get("contribution_count")
            .map_err(|e| db_error(e, "read contribution count"))?,
        participant_count: inserted
            .try_get("participant_count")
            .map_err(|e| db_error(e, "read participant count"))?,
        created_at: inserted
            .try_get("created_at")
            .map_err(|e| db_error(e, "read creation timestamp"))?,
        updated_at: inserted
            .try_get("updated_at")
            .map_err(|e| db_error(e, "read update timestamp"))?,
    };

    Ok((StatusCode::CREATED, Json(summary)))
}

pub async fn get(
    State(state): State<AppState>,
    user: OptionalAuthenticatedUser,
    Path(chain_id): Path<Uuid>,
    Query(page): Query<ContributionPageQuery>,
) -> Result<Json<ChainDetailResponse>, ApiError> {
    let contribution_limit = page.limit.unwrap_or(40).clamp(1, 100);
    let contribution_offset = page.offset.unwrap_or(0).clamp(0, 1_000_000);
    let viewer_id = user.0.as_ref().map(|authenticated| authenticated.id);
    let sql = format!(
        "{SUMMARY_SELECT}
        WHERE chain.id = $1
          AND (
            (
              chain.visibility IN ('public', 'unlisted', 'circle')
              AND (
                chain.circle_id IS NULL
                OR ($2::uuid IS NOT NULL AND EXISTS (
                    SELECT 1 FROM circle_members AS member
                    WHERE member.circle_id = chain.circle_id
                      AND member.user_id = $2
                      AND member.status IN ('active', 'approved')
                ))
              )
            )
            OR (
              $2::uuid IS NOT NULL
              AND (
                chain.visibility <> 'circle'
                OR EXISTS (
                    SELECT 1 FROM circle_members AS circle_member
                    WHERE circle_member.circle_id = chain.circle_id
                      AND circle_member.user_id = $2
                      AND circle_member.status IN ('active', 'approved')
                )
                OR EXISTS (
                    SELECT 1 FROM circles AS circle
                    WHERE circle.id = chain.circle_id AND circle.owner_id = $2
                )
              )
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
        .ok_or_else(|| {
            api_error(
                StatusCode::NOT_FOUND,
                "chain_not_found",
                "This Chain is unavailable.",
            )
        })?;
    let chain = parse_summary(&row)?;

    let can_contribute = if let Some(viewer_id) = viewer_id {
        sqlx::query_scalar::<_, bool>(
            r#"
            SELECT
                chain.status = 'active'
                AND (
                    chain.visibility <> 'circle'
                    OR EXISTS (
                        SELECT 1 FROM circle_members AS member
                        WHERE member.circle_id = chain.circle_id
                          AND member.user_id = $2
                          AND member.status IN ('active', 'approved')
                    )
                    OR EXISTS (
                        SELECT 1 FROM circles AS circle
                        WHERE circle.id = chain.circle_id AND circle.owner_id = $2
                    )
                )
                AND (
                    chain.creator_id = $2
                    OR (
                        NOT EXISTS (
                            SELECT 1 FROM chain_members AS viewer
                            WHERE viewer.chain_id = chain.id
                              AND viewer.user_id = $2
                              AND viewer.role = 'viewer'
                        )
                        AND (
                            EXISTS (
                                SELECT 1 FROM chain_members AS member
                                WHERE member.chain_id = chain.id
                                  AND member.user_id = $2
                                  AND member.role IN ('owner', 'collaborator', 'contributor')
                            )
                            OR (
                                chain.contribution_policy = 'open'
                                AND (
                                    chain.circle_id IS NULL
                                    OR EXISTS (
                                        SELECT 1 FROM circle_members AS member
                                        WHERE member.circle_id = chain.circle_id
                                          AND member.user_id = $2
                                          AND member.status IN ('active', 'approved')
                                    )
                                    OR EXISTS (
                                        SELECT 1 FROM circles AS circle
                                        WHERE circle.id = chain.circle_id AND circle.owner_id = $2
                                    )
                                )
                            )
                            OR (
                                chain.contribution_policy = 'circle_members'
                                AND (
                                    EXISTS (
                                        SELECT 1 FROM circle_members AS member
                                        WHERE member.circle_id = chain.circle_id
                                          AND member.user_id = $2
                                          AND member.status IN ('active', 'approved')
                                    )
                                    OR EXISTS (
                                        SELECT 1 FROM circles AS circle
                                        WHERE circle.id = chain.circle_id AND circle.owner_id = $2
                                    )
                                )
                            )
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

    let can_manage = if let Some(viewer_id) = viewer_id {
        sqlx::query_scalar::<_, bool>(
            r#"
            SELECT chain.creator_id = $2 OR EXISTS (
                SELECT 1 FROM chain_members AS member
                WHERE member.chain_id = chain.id
                  AND member.user_id = $2
                  AND member.role = 'owner'
            )
            FROM chains AS chain
            WHERE chain.id = $1
            "#,
        )
        .bind(chain_id)
        .bind(viewer_id)
        .fetch_one(&state.database)
        .await
        .map_err(|error| db_error(error, "check Chain management permission"))?
    } else {
        false
    };

    let members = if can_manage {
        let rows = sqlx::query(
            r#"
            SELECT member.user_id, profile.username,
                   COALESCE(profile.display_name, profile.username) AS display_name,
                   profile.avatar_url, member.role, member.joined_at
            FROM chain_members AS member
            JOIN profiles AS profile ON profile.id = member.user_id
            WHERE member.chain_id = $1
            ORDER BY
                CASE member.role
                    WHEN 'owner' THEN 0
                    WHEN 'collaborator' THEN 1
                    WHEN 'contributor' THEN 2
                    ELSE 3
                END,
                member.joined_at ASC
            "#,
        )
        .bind(chain_id)
        .fetch_all(&state.database)
        .await
        .map_err(|error| db_error(error, "load Chain collaborators"))?;

        rows.into_iter()
            .map(|row| {
                Ok(ChainMemberSummary {
                    user_id: row
                        .try_get("user_id")
                        .map_err(|error| db_error(error, "read Chain member id"))?,
                    username: row
                        .try_get("username")
                        .map_err(|error| db_error(error, "read Chain member username"))?,
                    display_name: row
                        .try_get("display_name")
                        .map_err(|error| db_error(error, "read Chain member display name"))?,
                    avatar_url: row
                        .try_get("avatar_url")
                        .map_err(|error| db_error(error, "read Chain member avatar"))?,
                    role: row
                        .try_get("role")
                        .map_err(|error| db_error(error, "read Chain member role"))?,
                    joined_at: row
                        .try_get("joined_at")
                        .map_err(|error| db_error(error, "read Chain member join date"))?,
                })
            })
            .collect::<Result<Vec<_>, ApiError>>()?
    } else {
        Vec::new()
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
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(chain_id)
    .bind(contribution_limit + 1)
    .bind(contribution_offset)
    .fetch_all(&state.database)
    .await
    .map_err(|error| db_error(error, "load Chain contributions"))?;

    let contributions_has_more = rows.len() > contribution_limit as usize;
    let mut rows = rows;
    rows.truncate(contribution_limit as usize);
    let contributions = rows
        .into_iter()
        .map(|row| {
            Ok(ChainContribution {
                id: row
                    .try_get("id")
                    .map_err(|e| db_error(e, "read contribution id"))?,
                chain_id: row
                    .try_get("chain_id")
                    .map_err(|e| db_error(e, "read contribution Chain id"))?,
                author_id: row
                    .try_get("author_id")
                    .map_err(|e| db_error(e, "read contribution author"))?,
                author_username: row
                    .try_get("author_username")
                    .map_err(|e| db_error(e, "read contribution username"))?,
                author_display_name: row
                    .try_get("author_display_name")
                    .map_err(|e| db_error(e, "read contribution name"))?,
                author_avatar_url: row
                    .try_get("author_avatar_url")
                    .map_err(|e| db_error(e, "read contribution avatar"))?,
                parent_contribution_id: row
                    .try_get("parent_contribution_id")
                    .map_err(|e| db_error(e, "read contribution parent"))?,
                contribution_type: row
                    .try_get("contribution_type")
                    .map_err(|e| db_error(e, "read contribution type"))?,
                title: row
                    .try_get("title")
                    .map_err(|e| db_error(e, "read contribution title"))?,
                content: row
                    .try_get("content")
                    .map_err(|e| db_error(e, "read contribution content"))?,
                payload: row
                    .try_get("payload")
                    .map_err(|e| db_error(e, "read contribution payload"))?,
                position: row
                    .try_get("position")
                    .map_err(|e| db_error(e, "read contribution position"))?,
                created_at: row
                    .try_get("created_at")
                    .map_err(|e| db_error(e, "read contribution timestamp"))?,
                updated_at: row
                    .try_get("updated_at")
                    .map_err(|e| db_error(e, "read contribution update timestamp"))?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(ChainDetailResponse {
        chain,
        contributions,
        can_contribute,
        can_manage,
        members,
        contributions_limit: contribution_limit,
        contributions_offset: contribution_offset,
        contributions_has_more,
    }))
}

#[derive(Deserialize)]
pub struct UpdateChainInput {
    title: Option<String>,
    description: Option<String>,
    prompt: Option<String>,
    category: Option<String>,
    visibility: Option<String>,
    contribution_policy: Option<String>,
    status: Option<String>,
}

/// Update Chain details or its contribution lifecycle. Only the Chain owner
/// may change the shared object's identity, visibility or lifecycle.
pub async fn update(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(chain_id): Path<Uuid>,
    Json(input): Json<UpdateChainInput>,
) -> Result<Json<ChainSummary>, ApiError> {
    if input.title.is_none()
        && input.description.is_none()
        && input.prompt.is_none()
        && input.category.is_none()
        && input.visibility.is_none()
        && input.contribution_policy.is_none()
        && input.status.is_none()
    {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "empty_chain_update",
            "Provide at least one Chain change.",
        ));
    }

    let title = input
        .title
        .map(|value| {
            let value = value.trim().to_owned();
            if value.is_empty() || value.chars().count() > 120 {
                Err(api_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_chain_title",
                    "Chain titles must contain between 1 and 120 characters.",
                ))
            } else {
                Ok(value)
            }
        })
        .transpose()?;
    let description = input
        .description
        .map(|value| {
            if value.chars().count() > 2_000 {
                Err(api_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "chain_text_too_long",
                    "Descriptions are limited to 2,000 characters.",
                ))
            } else {
                Ok(value.trim().to_owned())
            }
        })
        .transpose()?;
    let prompt = input
        .prompt
        .map(|value| {
            if value.chars().count() > 1_200 {
                Err(api_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "chain_text_too_long",
                    "Opening prompts are limited to 1,200 characters.",
                ))
            } else {
                Ok(value.trim().to_owned())
            }
        })
        .transpose()?;
    let category = input
        .category
        .map(|value| {
            let value = value.trim().to_lowercase();
            if value.is_empty() || value.chars().count() > 40 {
                Err(api_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_chain_category",
                    "Choose a category of 1 to 40 characters.",
                ))
            } else {
                Ok(value)
            }
        })
        .transpose()?;
    let visibility = input
        .visibility
        .map(|value| {
            valid_visibility(Some(&value)).ok_or_else(|| {
                api_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_chain_visibility",
                    "Visibility must be public, unlisted, private or circle.",
                )
            })
        })
        .transpose()?;
    let contribution_policy = input
        .contribution_policy
        .map(|value| {
            valid_policy(Some(&value)).ok_or_else(|| {
                api_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_contribution_policy",
                    "Contribution policy must be open, members or circle_members.",
                )
            })
        })
        .transpose()?;
    let status = input
        .status
        .map(|value| {
            valid_chain_status(&value).ok_or_else(|| {
                api_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_chain_status",
                    "Status must be active, paused, completed or archived.",
                )
            })
        })
        .transpose()?;

    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|error| db_error(error, "begin Chain update"))?;
    let current =
        sqlx::query("SELECT creator_id, circle_id, status FROM chains WHERE id = $1 FOR UPDATE")
            .bind(chain_id)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|error| db_error(error, "load Chain for update"))?
            .ok_or_else(|| {
                api_error(
                    StatusCode::NOT_FOUND,
                    "chain_not_found",
                    "This Chain is unavailable.",
                )
            })?;

    let creator_id: Uuid = current
        .try_get("creator_id")
        .map_err(|error| db_error(error, "read Chain creator"))?;
    let circle_id: Option<Uuid> = current
        .try_get("circle_id")
        .map_err(|error| db_error(error, "read Chain Circle"))?;
    let current_status: String = current
        .try_get("status")
        .map_err(|error| db_error(error, "read Chain status"))?;
    if status
        .as_deref()
        .is_some_and(|next| !can_transition_chain_status(&current_status, next))
    {
        return Err(api_error(
            StatusCode::CONFLICT,
            "invalid_chain_status_transition",
            "A completed or archived Chain cannot be reopened.",
        ));
    }
    let is_owner = creator_id == user.id
        || sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM chain_members WHERE chain_id = $1 AND user_id = $2 AND role = 'owner')",
        )
        .bind(chain_id)
        .bind(user.id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| db_error(error, "verify Chain owner"))?;

    if !is_owner {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "chain_owner_required",
            "Only the Chain owner can edit its details or lifecycle.",
        ));
    }

    if circle_id.is_some() && visibility.as_deref().is_some_and(|value| value != "circle") {
        return Err(api_error(
            StatusCode::CONFLICT,
            "circle_chain_scope_locked",
            "A Circle Chain must remain scoped to its Circle.",
        ));
    }
    if circle_id.is_none() && visibility.as_deref() == Some("circle") {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "circle_required",
            "Choose a Circle before making a Chain Circle-only.",
        ));
    }

    if let Some(circle_id) = circle_id {
        let remains_member = sqlx::query_scalar::<_, bool>(
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
        .map_err(|error| db_error(error, "verify Chain Circle membership"))?;
        if !remains_member {
            return Err(api_error(
                StatusCode::FORBIDDEN,
                "circle_membership_required",
                "Rejoin this Circle before managing its Chain.",
            ));
        }
    }

    sqlx::query(
        r#"
        UPDATE chains
        SET title = COALESCE($2, title),
            description = COALESCE($3, description),
            prompt = COALESCE($4, prompt),
            category = COALESCE($5, category),
            visibility = COALESCE($6, visibility),
            contribution_policy = COALESCE($7, contribution_policy),
            status = COALESCE($8, status),
            updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(chain_id)
    .bind(title)
    .bind(description)
    .bind(prompt)
    .bind(category)
    .bind(visibility)
    .bind(contribution_policy)
    .bind(status)
    .execute(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "update Chain"))?;

    transaction
        .commit()
        .await
        .map_err(|error| db_error(error, "commit Chain update"))?;

    let row = sqlx::query(&format!("{SUMMARY_SELECT} WHERE chain.id = $1"))
        .bind(chain_id)
        .fetch_one(&state.database)
        .await
        .map_err(|error| db_error(error, "reload updated Chain"))?;

    Ok(Json(parse_summary(&row)?))
}

fn valid_chain_member_role(value: &str) -> Option<&'static str> {
    match value.trim().to_lowercase().as_str() {
        "collaborator" => Some("collaborator"),
        "contributor" => Some("contributor"),
        "viewer" => Some("viewer"),
        "owner" => Some("owner"),
        _ => None,
    }
}

#[derive(Deserialize)]
pub struct SetChainMemberInput {
    role: String,
}

#[derive(Serialize)]
pub struct ChainMemberMutationResponse {
    chain_id: Uuid,
    user_id: Uuid,
    role: String,
}

/// Add or change a Chain collaborator. The creator and assigned Chain owners
/// are the only people who can manage membership; Circle membership is also
/// required for Circle-scoped Chains.
pub async fn set_member(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path((chain_id, member_user_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<SetChainMemberInput>,
) -> Result<Json<ChainMemberMutationResponse>, ApiError> {
    let role = valid_chain_member_role(&input.role).ok_or_else(|| {
        api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_chain_member_role",
            "Chain member roles must be owner, collaborator, contributor or viewer.",
        )
    })?;

    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|error| db_error(error, "begin Chain member update"))?;
    let chain = sqlx::query("SELECT creator_id, circle_id FROM chains WHERE id = $1 FOR UPDATE")
        .bind(chain_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| db_error(error, "load Chain for member update"))?
        .ok_or_else(|| {
            api_error(
                StatusCode::NOT_FOUND,
                "chain_not_found",
                "This Chain is unavailable.",
            )
        })?;
    let creator_id: Uuid = chain
        .try_get("creator_id")
        .map_err(|error| db_error(error, "read Chain creator"))?;
    let circle_id: Option<Uuid> = chain
        .try_get("circle_id")
        .map_err(|error| db_error(error, "read Chain Circle"))?;
    let actor_role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM chain_members WHERE chain_id = $1 AND user_id = $2",
    )
    .bind(chain_id)
    .bind(user.id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "verify Chain manager"))?;
    let is_creator = creator_id == user.id;
    if role == "owner" && !is_creator {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "chain_owner_assignment_restricted",
            "Only the original creator can assign another Chain owner.",
        ));
    }
    if !is_creator && actor_role.as_deref() != Some("owner") {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "chain_manager_required",
            "Only the Chain creator or an assigned Chain owner can manage members.",
        ));
    }

    if let Some(circle_id) = circle_id {
        let actor_is_circle_member = sqlx::query_scalar::<_, bool>(
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
        .map_err(|error| db_error(error, "verify manager Circle membership"))?;
        if !actor_is_circle_member {
            return Err(api_error(
                StatusCode::FORBIDDEN,
                "circle_membership_required",
                "Rejoin the Circle before managing its Chain.",
            ));
        }

        let target_is_circle_member = sqlx::query_scalar::<_, bool>(
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
        .bind(member_user_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| db_error(error, "verify target Circle membership"))?;
        if !target_is_circle_member {
            return Err(api_error(
                StatusCode::FORBIDDEN,
                "target_circle_membership_required",
                "Only current Circle members can be added to a Circle-scoped Chain.",
            ));
        }
    }

    if member_user_id == creator_id {
        return Err(api_error(
            StatusCode::CONFLICT,
            "chain_creator_role_locked",
            "The Chain creator's ownership cannot be changed here.",
        ));
    }

    let target_exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM profiles WHERE id = $1)")
            .bind(member_user_id)
            .fetch_one(&mut *transaction)
            .await
            .map_err(|error| db_error(error, "verify Chain member account"))?;
    if !target_exists {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "chain_member_not_found",
            "This account is unavailable.",
        ));
    }

    let existing_role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM chain_members WHERE chain_id = $1 AND user_id = $2",
    )
    .bind(chain_id)
    .bind(member_user_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "load existing Chain member role"))?;
    if existing_role.as_deref() == Some("owner") && !is_creator {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "chain_owner_role_locked",
            "Only the original creator can change another assigned owner's role.",
        ));
    }

    sqlx::query(
        r#"
        INSERT INTO chain_members (chain_id, user_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (chain_id, user_id)
        DO UPDATE SET role = EXCLUDED.role
        "#,
    )
    .bind(chain_id)
    .bind(member_user_id)
    .bind(role)
    .execute(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "save Chain member role"))?;

    sqlx::query(
        "UPDATE chains SET participant_count = (SELECT COUNT(*) FROM chain_members WHERE chain_id = $1), updated_at = NOW() WHERE id = $1",
    )
    .bind(chain_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "update Chain member count"))?;

    transaction
        .commit()
        .await
        .map_err(|error| db_error(error, "commit Chain member update"))?;

    Ok(Json(ChainMemberMutationResponse {
        chain_id,
        user_id: member_user_id,
        role: role.to_owned(),
    }))
}

/// Remove an invited or contributing member from a Chain. Creator ownership
/// is permanent; assigned owners can only be removed by the original creator.
pub async fn remove_member(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path((chain_id, member_user_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|error| db_error(error, "begin Chain member removal"))?;
    let chain = sqlx::query("SELECT creator_id, circle_id FROM chains WHERE id = $1 FOR UPDATE")
        .bind(chain_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| db_error(error, "load Chain for member removal"))?
        .ok_or_else(|| {
            api_error(
                StatusCode::NOT_FOUND,
                "chain_not_found",
                "This Chain is unavailable.",
            )
        })?;
    let creator_id: Uuid = chain
        .try_get("creator_id")
        .map_err(|error| db_error(error, "read Chain creator"))?;
    let circle_id: Option<Uuid> = chain
        .try_get("circle_id")
        .map_err(|error| db_error(error, "read Chain Circle"))?;
    let actor_role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM chain_members WHERE chain_id = $1 AND user_id = $2",
    )
    .bind(chain_id)
    .bind(user.id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "verify Chain manager"))?;
    let is_creator = creator_id == user.id;
    if !is_creator && actor_role.as_deref() != Some("owner") {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "chain_manager_required",
            "Only the Chain creator or an assigned Chain owner can manage members.",
        ));
    }
    if member_user_id == creator_id {
        return Err(api_error(
            StatusCode::CONFLICT,
            "chain_creator_role_locked",
            "The Chain creator cannot be removed.",
        ));
    }
    if let Some(circle_id) = circle_id {
        let actor_is_circle_member = sqlx::query_scalar::<_, bool>(
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
        .map_err(|error| db_error(error, "verify manager Circle membership"))?;
        if !actor_is_circle_member {
            return Err(api_error(
                StatusCode::FORBIDDEN,
                "circle_membership_required",
                "Rejoin the Circle before managing its Chain.",
            ));
        }
    }

    let target_role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM chain_members WHERE chain_id = $1 AND user_id = $2",
    )
    .bind(chain_id)
    .bind(member_user_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "load Chain member"))?
    .ok_or_else(|| {
        api_error(
            StatusCode::NOT_FOUND,
            "chain_member_not_found",
            "This Chain member was not found.",
        )
    })?;
    if target_role == "owner" && !is_creator {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "chain_owner_role_locked",
            "Only the original creator can remove another assigned owner.",
        ));
    }

    sqlx::query("DELETE FROM chain_members WHERE chain_id = $1 AND user_id = $2")
        .bind(chain_id)
        .bind(member_user_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| db_error(error, "remove Chain member"))?;
    sqlx::query(
        "UPDATE chains SET participant_count = GREATEST(1, (SELECT COUNT(*) FROM chain_members WHERE chain_id = $1)), updated_at = NOW() WHERE id = $1",
    )
    .bind(chain_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "update Chain member count"))?;

    transaction
        .commit()
        .await
        .map_err(|error| db_error(error, "commit Chain member removal"))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn contribute(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(chain_id): Path<Uuid>,
    Json(input): Json<CreateContributionInput>,
) -> Result<(StatusCode, Json<CreatedContributionResponse>), ApiError> {
    let contribution_type = valid_contribution_type(input.contribution_type.as_deref())
        .ok_or_else(|| {
            api_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_contribution_type",
                "This contribution format is not supported.",
            )
        })?;
    let title = input.title.unwrap_or_default();
    let content = input.content.unwrap_or_default();
    if title.chars().count() > 120 || content.chars().count() > 8_000 {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "contribution_too_long",
            "Contribution titles are limited to 120 characters and content to 8,000.",
        ));
    }
    if !input.payload.is_null() && !input.payload.is_object() {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_contribution_payload",
            "Structured contribution data must be a JSON object.",
        ));
    }
    let payload_has_content = input
        .payload
        .as_object()
        .is_some_and(|payload| !payload.is_empty());
    if title.trim().is_empty() && content.trim().is_empty() && !payload_has_content {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "empty_contribution",
            "Add text, a link or an attachment before contributing.",
        ));
    }
    match contribution_type.as_str() {
        "list" | "ranking" => {
            let entries = input.payload.get("items").and_then(Value::as_array);
            let valid_entries = entries.is_some_and(|items| {
                (2..=40).contains(&items.len())
                    && items.iter().all(|entry| {
                        entry.as_str().is_some_and(|value| {
                            !value.trim().is_empty() && value.chars().count() <= 240
                        })
                    })
            });
            if !valid_entries {
                return Err(api_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_structured_entries",
                    "Lists and rankings need 2 to 40 non-empty entries, each up to 240 characters.",
                ));
            }
        }
        "poll" => {
            let options = input.payload.get("options").and_then(Value::as_array);
            let valid_options = options.is_some_and(|items| {
                (2..=10).contains(&items.len())
                    && items.iter().all(|option| {
                        option.as_str().is_some_and(|value| {
                            !value.trim().is_empty() && value.chars().count() <= 160
                        })
                    })
            });
            if content.trim().is_empty() || !valid_options {
                return Err(api_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_poll_contribution",
                    "Poll contributions need a question and 2 to 10 non-empty options, each up to 160 characters.",
                ));
            }
        }
        _ => {}
    }
    if serde_json::to_vec(&input.payload).map_or(true, |value| value.len() > 64 * 1024) {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "contribution_payload_too_large",
            "Structured contribution data cannot exceed 64 KiB.",
        ));
    }
    if matches!(
        contribution_type.as_str(),
        "image" | "video" | "audio" | "document" | "link"
    ) {
        let attachment_url = input
            .payload
            .get("url")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if !attachment_url.is_some_and(is_valid_https_url) {
            return Err(api_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_contribution_url",
                "Links and uploaded media must use a valid HTTPS URL.",
            ));
        }
    }

    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|error| db_error(error, "begin Chain contribution"))?;
    let chain = sqlx::query(
        "SELECT creator_id, circle_id, contribution_policy, visibility, status, title FROM chains WHERE id = $1 FOR UPDATE",
    )
    .bind(chain_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "lock Chain"))?
    .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "chain_not_found", "This Chain is unavailable."))?;

    let creator_id: Uuid = chain
        .try_get("creator_id")
        .map_err(|e| db_error(e, "read Chain creator"))?;
    let circle_id: Option<Uuid> = chain
        .try_get("circle_id")
        .map_err(|e| db_error(e, "read Chain Circle"))?;
    let policy: String = chain
        .try_get("contribution_policy")
        .map_err(|e| db_error(e, "read contribution policy"))?;
    let visibility: String = chain
        .try_get("visibility")
        .map_err(|e| db_error(e, "read Chain visibility"))?;
    let status: String = chain
        .try_get("status")
        .map_err(|e| db_error(e, "read Chain status"))?;
    let chain_title: String = chain
        .try_get("title")
        .map_err(|e| db_error(e, "read Chain title"))?;
    if status != "active" {
        return Err(api_error(
            StatusCode::CONFLICT,
            "chain_not_active",
            "This Chain is not accepting new contributions.",
        ));
    }

    let chain_member_role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM chain_members WHERE chain_id = $1 AND user_id = $2",
    )
    .bind(chain_id)
    .bind(user.id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "check Chain membership role"))?;
    let is_chain_member = chain_member_role.is_some();

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
    let may_access = can_access_chain(
        &visibility,
        circle_id.is_some(),
        is_creator,
        is_chain_member,
        is_circle_member,
    );
    if !may_access {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "chain_access_denied",
            "You do not have access to this Chain.",
        ));
    }
    let may_contribute = can_contribute_to_chain(
        &policy,
        &visibility,
        circle_id.is_some(),
        is_creator,
        chain_member_role.as_deref(),
        is_circle_member,
    );
    if !may_contribute {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "chain_contribution_restricted",
            "This Chain only accepts contributions from its members.",
        ));
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
            return Err(api_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_contribution_parent",
                "The parent contribution must belong to this Chain and be published.",
            ));
        }
    }

    let position: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position), 0) + 1 FROM chain_contributions WHERE chain_id = $1",
    )
    .bind(chain_id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "allocate contribution position"))?;

    let payload = if input.payload.is_null() {
        serde_json::json!({})
    } else {
        input.payload
    };
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
    .bind(if title.trim().is_empty() {
        None
    } else {
        Some(title.trim())
    })
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

    notification_events::notify_chain_contribution(
        &mut transaction,
        chain_id,
        row.try_get("id")
            .map_err(|error| db_error(error, "read new contribution id"))?,
        user.id,
        &user.display_name,
        &chain_title,
    )
    .await
    .map_err(|error| db_error(error, "create Chain contribution notifications"))?;

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

    transaction
        .commit()
        .await
        .map_err(|error| db_error(error, "commit Chain contribution"))?;

    let contribution = ChainContribution {
        id: row
            .try_get("id")
            .map_err(|e| db_error(e, "read new contribution id"))?,
        chain_id: row
            .try_get("chain_id")
            .map_err(|e| db_error(e, "read new contribution Chain id"))?,
        author_id: row
            .try_get("author_id")
            .map_err(|e| db_error(e, "read new contribution author"))?,
        author_username: user.username,
        author_display_name: user.display_name,
        author_avatar_url: user.avatar_url,
        parent_contribution_id: row
            .try_get("parent_contribution_id")
            .map_err(|e| db_error(e, "read contribution parent"))?,
        contribution_type: row
            .try_get("contribution_type")
            .map_err(|e| db_error(e, "read contribution type"))?,
        title: row
            .try_get("title")
            .map_err(|e| db_error(e, "read contribution title"))?,
        content: row
            .try_get("content")
            .map_err(|e| db_error(e, "read contribution content"))?,
        payload: row
            .try_get("payload")
            .map_err(|e| db_error(e, "read contribution payload"))?,
        position: row
            .try_get("position")
            .map_err(|e| db_error(e, "read contribution position"))?,
        created_at: row
            .try_get("created_at")
            .map_err(|e| db_error(e, "read contribution creation time"))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|e| db_error(e, "read contribution update time"))?,
    };

    Ok((
        StatusCode::CREATED,
        Json(CreatedContributionResponse { contribution }),
    ))
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::{
        can_access_chain, can_contribute_to_chain, insert_circle_challenge_origin,
        valid_chain_member_role, valid_contribution_type, valid_kind, valid_policy,
        valid_visibility,
    };

    #[test]
    fn circle_drop_origin_is_written_as_a_server_generated_reference() {
        let mut metadata = serde_json::json!({ "created_from": "drop" });
        let drop_id = Uuid::parse_str("11111111-1111-4111-8111-111111111111").unwrap();
        let circle_id = Uuid::parse_str("22222222-2222-4222-8222-222222222222").unwrap();

        assert!(
            insert_circle_challenge_origin(
                &mut metadata,
                drop_id,
                circle_id,
                "Community prompt".to_owned(),
            )
            .is_ok()
        );

        assert_eq!(metadata["origin"]["type"], "circle_challenge");
        assert_eq!(metadata["origin"]["id"], drop_id.to_string());
        assert_eq!(metadata["origin"]["circle_id"], circle_id.to_string());
        assert_eq!(metadata["origin"]["title"], "Community prompt");
    }

    #[test]
    fn clients_cannot_spoof_chain_origin_metadata() {
        let mut metadata = serde_json::json!({
            "origin": { "type": "circle_challenge", "id": "not-verified" }
        });
        let drop_id = Uuid::parse_str("11111111-1111-4111-8111-111111111111").unwrap();
        let circle_id = Uuid::parse_str("22222222-2222-4222-8222-222222222222").unwrap();

        let result = insert_circle_challenge_origin(
            &mut metadata,
            drop_id,
            circle_id,
            "Community prompt".to_owned(),
        );

        assert!(result.is_err());
        assert_eq!(metadata["origin"]["id"], "not-verified");
    }

    #[test]
    fn circle_scoped_chains_require_current_circle_membership_even_for_chain_members() {
        assert!(!can_access_chain("circle", true, false, false, false));
        assert!(!can_access_chain("circle", true, true, false, false));
        assert!(!can_access_chain("circle", true, false, true, false));
        assert!(can_access_chain("circle", true, false, false, true));
        assert!(can_access_chain("circle", true, true, true, true));
    }

    #[test]
    fn former_circle_members_cannot_contribute_through_stale_chain_membership() {
        assert!(!can_contribute_to_chain(
            "open",
            "circle",
            true,
            true,
            Some("contributor"),
            false
        ));
        assert!(!can_contribute_to_chain(
            "circle_members",
            "circle",
            true,
            false,
            Some("viewer"),
            false
        ));
        assert!(can_contribute_to_chain(
            "open",
            "circle",
            true,
            false,
            Some("contributor"),
            true
        ));
    }

    #[test]
    fn private_chains_require_creator_or_chain_membership() {
        assert!(!can_access_chain("private", false, false, false, false));
        assert!(can_access_chain("private", false, true, false, false));
        assert!(can_access_chain("private", false, false, true, false));
    }

    #[test]
    fn open_policy_never_bypasses_private_chain_visibility() {
        assert!(!can_contribute_to_chain(
            "open", "private", false, false, None, false
        ));
        assert!(can_contribute_to_chain(
            "open", "public", false, false, None, false
        ));
        assert!(can_contribute_to_chain(
            "circle_members",
            "circle",
            true,
            false,
            None,
            true
        ));
        assert!(!can_contribute_to_chain(
            "circle_members",
            "circle",
            true,
            false,
            None,
            false
        ));
    }

    #[test]
    fn viewer_members_can_read_but_cannot_contribute() {
        assert!(can_access_chain("private", false, false, true, false));
        assert!(!can_contribute_to_chain(
            "open",
            "public",
            false,
            false,
            Some("viewer"),
            false,
        ));
        assert!(!can_contribute_to_chain(
            "members",
            "private",
            false,
            false,
            Some("viewer"),
            false,
        ));
        assert!(!can_contribute_to_chain(
            "open",
            "public",
            false,
            false,
            Some("viewer"),
            false,
        ));
        assert!(!can_contribute_to_chain(
            "circle_members",
            "circle",
            true,
            false,
            Some("viewer"),
            true,
        ));
    }

    #[test]
    fn contributor_roles_can_contribute_but_non_member_policy_is_respected() {
        for role in ["owner", "collaborator", "contributor"] {
            assert!(can_contribute_to_chain(
                "members",
                "private",
                false,
                false,
                Some(role),
                false,
            ));
        }
        assert!(!can_contribute_to_chain(
            "members", "public", false, false, None, false,
        ));
    }

    #[test]
    fn removed_chain_members_follow_the_current_contribution_policy_for_edits() {
        // Public/open Chains allow contributors to correct their own work.
        assert!(can_contribute_to_chain(
            "open", "public", false, false, None, false,
        ));
        // Restricting the Chain to members revokes edit access from an author
        // whose Chain membership has been removed.
        assert!(!can_contribute_to_chain(
            "members", "public", false, false, None, false,
        ));
        // An explicit viewer assignment always stays read-only on public Chains.
        assert!(!can_contribute_to_chain(
            "open",
            "public",
            false,
            false,
            Some("viewer"),
            false,
        ));
        // Active contributors and owners retain access on member-only Chains.
        for role in ["owner", "collaborator", "contributor"] {
            assert!(can_contribute_to_chain(
                "members",
                "private",
                false,
                false,
                Some(role),
                false,
            ));
        }
    }

    #[test]
    fn only_supported_non_owner_roles_can_be_assigned_to_chain_members() {
        assert_eq!(
            valid_chain_member_role("collaborator"),
            Some("collaborator")
        );
        assert_eq!(valid_chain_member_role("CONTRIBUTOR"), Some("contributor"));
        assert_eq!(valid_chain_member_role("viewer"), Some("viewer"));
        assert_eq!(valid_chain_member_role("owner"), Some("owner"));
        assert!(valid_chain_member_role("admin").is_none());
        assert!(valid_chain_member_role("").is_none());
    }

    #[test]
    fn chain_status_transitions_allow_pause_resume_and_completion_but_not_reopening() {
        let allowed = [
            ("active", "paused"),
            ("paused", "active"),
            ("active", "completed"),
            ("paused", "completed"),
            ("completed", "archived"),
            ("archived", "archived"),
        ];
        for (current, next) in allowed {
            assert!(super::can_transition_chain_status(current, next));
        }

        let denied = [
            ("completed", "active"),
            ("completed", "paused"),
            ("archived", "active"),
            ("archived", "paused"),
            ("archived", "completed"),
        ];
        for (current, next) in denied {
            assert!(!super::can_transition_chain_status(current, next));
        }
    }

    #[test]
    fn validates_all_supported_chain_lifecycle_states() {
        for state in ["active", "paused", "completed", "archived"] {
            assert_eq!(super::valid_chain_status(state).as_deref(), Some(state));
        }
        assert!(super::valid_chain_status("deleted").is_none());
    }

    #[test]
    fn supports_collaborative_chain_formats() {
        for kind in [
            "story",
            "worldbuilding",
            "ranking",
            "playlist",
            "gallery",
            "challenge",
            "project",
            "recommendations",
            "open",
        ] {
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
    fn only_https_urls_are_valid_for_links_and_uploaded_media() {
        assert!(super::is_valid_https_url(
            "https://cdn.example.com/media.png"
        ));
        assert!(!super::is_valid_https_url("http://example.com/media.png"));
        assert!(!super::is_valid_https_url("javascript:alert(1)"));
        assert!(!super::is_valid_https_url("not a url"));
    }

    #[test]
    fn validates_rich_contribution_types() {
        assert_eq!(
            valid_contribution_type(Some("image")).as_deref(),
            Some("image")
        );
        assert_eq!(
            valid_contribution_type(Some("poll")).as_deref(),
            Some("poll")
        );
        assert!(valid_contribution_type(Some("executable")).is_none());
    }
}
