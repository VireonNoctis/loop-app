use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::Row;
use url::Url;
use uuid::Uuid;

use crate::{auth::AuthenticatedUser, routes::chains::can_contribute_to_chain, state::AppState};

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
    tracing::error!(%error, context, "Chain lifecycle database operation failed");
    api_error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "chain_lifecycle_database_error",
        "Could not complete this Chain action.",
    )
}

fn is_https(value: &str) -> bool {
    Url::parse(value).is_ok_and(|url| url.scheme() == "https")
}

fn validate_edited_contribution(
    contribution_type: &str,
    title: Option<&str>,
    content: &str,
    payload: &Value,
) -> Result<(), (&'static str, &'static str)> {
    if title.is_some_and(|value| value.chars().count() > 120) || content.chars().count() > 8_000 {
        return Err((
            "contribution_too_long",
            "Contribution titles are limited to 120 characters and content to 8,000.",
        ));
    }
    if !payload.is_object()
        || serde_json::to_vec(payload).map_or(true, |value| value.len() > 64 * 1024)
    {
        return Err((
            "invalid_contribution_payload",
            "Structured contribution data must be an object no larger than 64 KiB.",
        ));
    }
    let has_payload = payload.as_object().is_some_and(|value| !value.is_empty());
    if title.is_none_or(|value| value.trim().is_empty())
        && content.trim().is_empty()
        && !has_payload
    {
        return Err((
            "empty_contribution",
            "A contribution must retain text, a title or structured content.",
        ));
    }
    match contribution_type {
        "list" | "ranking" => {
            let entries = payload.get("items").and_then(Value::as_array);
            let valid = entries.is_some_and(|items| {
                (2..=40).contains(&items.len())
                    && items.iter().all(|entry| {
                        entry.as_str().is_some_and(|value| {
                            !value.trim().is_empty() && value.chars().count() <= 240
                        })
                    })
            });
            if !valid {
                return Err((
                    "invalid_structured_entries",
                    "Lists and rankings need 2 to 40 non-empty entries, each up to 240 characters.",
                ));
            }
        }
        "poll" => {
            let options = payload.get("options").and_then(Value::as_array);
            let valid = options.is_some_and(|items| {
                (2..=10).contains(&items.len())
                    && items.iter().all(|option| {
                        option.as_str().is_some_and(|value| {
                            !value.trim().is_empty() && value.chars().count() <= 160
                        })
                    })
            });
            if content.trim().is_empty() || !valid {
                return Err((
                    "invalid_poll_contribution",
                    "Poll contributions need a question and 2 to 10 non-empty options, each up to 160 characters.",
                ));
            }
        }
        "image" | "video" | "audio" | "document" | "link" => {
            let attachment_url = payload.get("url").and_then(Value::as_str).map(str::trim);
            if !attachment_url.is_some_and(is_https) {
                return Err((
                    "invalid_contribution_url",
                    "Links and uploaded media must use a valid HTTPS URL.",
                ));
            }
        }
        _ => {}
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct ForkChainInput {
    title: Option<String>,
}

#[derive(Serialize)]
pub struct ForkChainResponse {
    id: Uuid,
    source_chain_id: Uuid,
    title: String,
}

pub async fn fork(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(chain_id): Path<Uuid>,
    Json(input): Json<ForkChainInput>,
) -> Result<(StatusCode, Json<ForkChainResponse>), ApiError> {
    let source = sqlx::query(
        r#"
        SELECT chain.id, chain.title, chain.description, chain.prompt, chain.kind,
               chain.category, chain.visibility, chain.circle_id, chain.cover_image_url,
               chain.metadata
        FROM chains AS chain
        WHERE chain.id = $1
          AND chain.status IN ('active', 'completed')
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
              OR (
                  chain.visibility IN ('public', 'unlisted', 'circle')
                  AND (
                      chain.circle_id IS NULL
                      OR EXISTS (
                          SELECT 1 FROM circle_members AS member
                          WHERE member.circle_id = chain.circle_id
                            AND member.user_id = $2
                            AND member.status IN ('active', 'approved')
                      )
                  )
              )
          )
        "#,
    )
    .bind(chain_id)
    .bind(user.id)
    .fetch_optional(&state.database)
    .await
    .map_err(|error| db_error(error, "load source Chain for remix"))?
    .ok_or_else(|| {
        api_error(
            StatusCode::NOT_FOUND,
            "chain_not_found",
            "This Chain is unavailable or cannot be remixed.",
        )
    })?;

    let original_title: String = source
        .try_get("title")
        .map_err(|e| db_error(e, "read source title"))?;
    let supplied_title = input.title.as_deref().map(str::trim);
    if supplied_title.is_some_and(|value| value.is_empty() || value.chars().count() > 120) {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_fork_title",
            "A remix title must contain between 1 and 120 characters.",
        ));
    }
    let title = supplied_title.map(str::to_owned).unwrap_or_else(|| {
        format!("Remix: {original_title}")
            .chars()
            .take(120)
            .collect()
    });

    let source_visibility: String = source
        .try_get("visibility")
        .map_err(|e| db_error(e, "read source visibility"))?;
    let source_circle_id: Option<Uuid> = source
        .try_get("circle_id")
        .map_err(|e| db_error(e, "read source Circle"))?;
    let visibility = match (source_visibility.as_str(), source_circle_id.is_none()) {
        ("public", true) => "public",
        ("unlisted", true) => "unlisted",
        _ => "private",
    };
    let contribution_policy = if visibility == "private" {
        "members"
    } else {
        "open"
    };

    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|error| db_error(error, "begin Chain remix"))?;
    let fork_id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO chains (
            creator_id, source_chain_id, circle_id, title, description, prompt,
            kind, category, visibility, contribution_policy, status, cover_image_url, metadata
        )
        VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $11)
        RETURNING id
        "#,
    )
    .bind(user.id)
    .bind(chain_id)
    .bind(&title)
    .bind(
        source
            .try_get::<String, _>("description")
            .map_err(|e| db_error(e, "read source description"))?,
    )
    .bind(
        source
            .try_get::<String, _>("prompt")
            .map_err(|e| db_error(e, "read source prompt"))?,
    )
    .bind(
        source
            .try_get::<String, _>("kind")
            .map_err(|e| db_error(e, "read source kind"))?,
    )
    .bind(
        source
            .try_get::<String, _>("category")
            .map_err(|e| db_error(e, "read source category"))?,
    )
    .bind(visibility)
    .bind(contribution_policy)
    .bind(
        source
            .try_get::<Option<String>, _>("cover_image_url")
            .map_err(|e| db_error(e, "read source cover"))?,
    )
    .bind(
        source
            .try_get::<Value, _>("metadata")
            .map_err(|e| db_error(e, "read source metadata"))?,
    )
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "create Chain remix"))?;

    sqlx::query(
        "INSERT INTO chain_members (chain_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING",
    )
    .bind(fork_id)
    .bind(user.id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "add remix owner"))?;

    sqlx::query(
        r#"
        WITH source AS MATERIALIZED (
            SELECT id, author_id, parent_contribution_id, contribution_type, title,
                   content, payload, position, gen_random_uuid() AS fork_id
            FROM chain_contributions
            WHERE chain_id = $1 AND status = 'published'
        ),
        inserted AS (
            INSERT INTO chain_contributions (
                id, chain_id, author_id, parent_contribution_id, contribution_type,
                title, content, payload, position, status
            )
            SELECT source.fork_id, $2, source.author_id, parent_item.fork_id,
                   source.contribution_type, source.title, source.content,
                   source.payload, source.position, 'published'
            FROM source
            LEFT JOIN source AS parent_item
              ON parent_item.id = source.parent_contribution_id
            RETURNING author_id
        )
        INSERT INTO chain_members (chain_id, user_id, role)
        SELECT $2, contributors.author_id,
               CASE WHEN contributors.author_id = $3 THEN 'owner' ELSE 'contributor' END
        FROM (SELECT DISTINCT author_id FROM inserted) AS contributors
        WHERE $4::text IN ('public', 'unlisted')
        ON CONFLICT (chain_id, user_id) DO NOTHING
        "#,
    )
    .bind(chain_id)
    .bind(fork_id)
    .bind(user.id)
    .bind(visibility)
    .execute(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "copy Chain contributions into remix"))?;

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
    .bind(fork_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "update remix counters"))?;

    transaction
        .commit()
        .await
        .map_err(|error| db_error(error, "commit Chain remix"))?;

    Ok((
        StatusCode::CREATED,
        Json(ForkChainResponse {
            id: fork_id,
            source_chain_id: chain_id,
            title,
        }),
    ))
}

#[derive(Deserialize)]
pub struct UpdateContributionInput {
    title: Option<String>,
    content: Option<String>,
    payload: Option<Value>,
}

#[derive(Serialize)]
pub struct UpdateContributionResponse {
    success: bool,
    revision_number: i64,
}

pub async fn update_contribution(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path((chain_id, contribution_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<UpdateContributionInput>,
) -> Result<Json<UpdateContributionResponse>, ApiError> {
    if input.title.is_none() && input.content.is_none() && input.payload.is_none() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "empty_contribution_update",
            "Provide at least one contribution field to update.",
        ));
    }
    if input
        .title
        .as_ref()
        .is_some_and(|value| value.chars().count() > 120)
        || input
            .content
            .as_ref()
            .is_some_and(|value| value.chars().count() > 8_000)
    {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "contribution_too_long",
            "Contribution titles are limited to 120 characters and content to 8,000.",
        ));
    }
    if let Some(payload) = input.payload.as_ref()
        && (!payload.is_object()
            || serde_json::to_vec(payload).map_or(true, |value| value.len() > 64 * 1024))
    {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_contribution_payload",
            "Structured contribution data must be an object no larger than 64 KiB.",
        ));
    }

    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|error| db_error(error, "begin contribution revision"))?;
    let current = sqlx::query(
        r#"
        SELECT
            contribution.author_id,
            contribution.contribution_type,
            contribution.title,
            contribution.content,
            contribution.payload,
            chain.creator_id,
            chain.circle_id,
            chain.contribution_policy,
            chain.visibility,
            (
                SELECT member.role
                FROM chain_members AS member
                WHERE member.chain_id = chain.id
                  AND member.user_id = $3
            ) AS chain_member_role,
            EXISTS (
                SELECT 1
                FROM circles AS circle
                WHERE circle.id = chain.circle_id
                  AND (
                      circle.owner_id = $3
                      OR EXISTS (
                          SELECT 1
                          FROM circle_members AS circle_member
                          WHERE circle_member.circle_id = circle.id
                            AND circle_member.user_id = $3
                            AND circle_member.status IN ('active', 'approved')
                      )
                  )
            ) AS is_circle_member
        FROM chain_contributions AS contribution
        JOIN chains AS chain ON chain.id = contribution.chain_id
        WHERE chain.id = $1
          AND contribution.id = $2
          AND chain.status = 'active'
          AND contribution.status = 'published'
          AND contribution.author_id = $3
        FOR UPDATE OF contribution, chain
        "#,
    )
    .bind(chain_id)
    .bind(contribution_id)
    .bind(user.id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "load contribution for editing"))?
    .ok_or_else(|| {
        api_error(
            StatusCode::NOT_FOUND,
            "contribution_not_found",
            "This contribution is unavailable.",
        )
    })?;

    let creator_id: Uuid = current
        .try_get("creator_id")
        .map_err(|error| db_error(error, "read Chain creator"))?;
    let circle_id: Option<Uuid> = current
        .try_get("circle_id")
        .map_err(|error| db_error(error, "read Chain Circle"))?;
    let contribution_policy: String = current
        .try_get("contribution_policy")
        .map_err(|error| db_error(error, "read Chain contribution policy"))?;
    let visibility: String = current
        .try_get("visibility")
        .map_err(|error| db_error(error, "read Chain visibility"))?;
    let chain_member_role: Option<String> = current
        .try_get("chain_member_role")
        .map_err(|error| db_error(error, "read Chain member role"))?;
    let is_circle_member: bool = current
        .try_get("is_circle_member")
        .map_err(|error| db_error(error, "read Circle membership"))?;
    if !can_contribute_to_chain(
        &contribution_policy,
        &visibility,
        circle_id.is_some(),
        creator_id == user.id,
        chain_member_role.as_deref(),
        is_circle_member,
    ) {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "contribution_not_found",
            "This contribution is unavailable or you can no longer edit it.",
        ));
    }

    let author_id: Uuid = current
        .try_get("author_id")
        .map_err(|e| db_error(e, "read contribution author"))?;
    if author_id != user.id {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "contribution_edit_denied",
            "Only the original author can edit this contribution.",
        ));
    }

    let contribution_type: String = current
        .try_get("contribution_type")
        .map_err(|e| db_error(e, "read contribution type"))?;
    let old_title: Option<String> = current
        .try_get("title")
        .map_err(|e| db_error(e, "read contribution title"))?;
    let old_content: String = current
        .try_get("content")
        .map_err(|e| db_error(e, "read contribution content"))?;
    let old_payload: Value = current
        .try_get("payload")
        .map_err(|e| db_error(e, "read contribution payload"))?;
    let next_title = input
        .title
        .map(|value| {
            let value = value.trim().to_owned();
            if value.is_empty() { None } else { Some(value) }
        })
        .unwrap_or(old_title.clone());
    let next_content = input.content.unwrap_or_else(|| old_content.clone());
    let next_payload = input.payload.unwrap_or_else(|| old_payload.clone());

    validate_edited_contribution(
        &contribution_type,
        next_title.as_deref(),
        &next_content,
        &next_payload,
    )
    .map_err(|(code, message)| api_error(StatusCode::UNPROCESSABLE_ENTITY, code, message))?;

    let revision_number: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(revision_number), 0) + 1 FROM chain_contribution_revisions WHERE contribution_id = $1",
    )
    .bind(contribution_id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "allocate revision number"))?;

    sqlx::query(
        r#"
        INSERT INTO chain_contribution_revisions (
            contribution_id, editor_id, revision_number, contribution_type,
            title, content, payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(contribution_id)
    .bind(user.id)
    .bind(revision_number)
    .bind(&contribution_type)
    .bind(old_title)
    .bind(old_content)
    .bind(old_payload)
    .execute(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "save previous contribution revision"))?;

    sqlx::query(
        r#"
        UPDATE chain_contributions
        SET title = $3, content = $4, payload = $5, updated_at = NOW()
        WHERE id = $1 AND chain_id = $2
        "#,
    )
    .bind(contribution_id)
    .bind(chain_id)
    .bind(next_title)
    .bind(next_content)
    .bind(next_payload)
    .execute(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "update contribution"))?;

    sqlx::query("UPDATE chains SET updated_at = NOW() WHERE id = $1")
        .bind(chain_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| db_error(error, "touch Chain after contribution edit"))?;

    transaction
        .commit()
        .await
        .map_err(|error| db_error(error, "commit contribution revision"))?;

    Ok(Json(UpdateContributionResponse {
        success: true,
        revision_number,
    }))
}

#[derive(Serialize)]
pub struct ContributionRevision {
    id: Uuid,
    revision_number: i64,
    title: Option<String>,
    content: String,
    payload: Value,
    editor_username: String,
    created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn list_revisions(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path((chain_id, contribution_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<ContributionRevision>>, ApiError> {
    let can_view = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM chain_contributions AS contribution
            JOIN chains AS chain ON chain.id = contribution.chain_id
            WHERE chain.id = $1 AND contribution.id = $2
              AND contribution.status = 'published'
              AND (contribution.author_id = $3 OR chain.creator_id = $3)
              AND (
                  chain.visibility <> 'circle'
                  OR EXISTS (
                      SELECT 1 FROM circle_members AS circle_member
                      WHERE circle_member.circle_id = chain.circle_id
                        AND circle_member.user_id = $3
                        AND circle_member.status IN ('active', 'approved')
                  )
                  OR EXISTS (
                      SELECT 1 FROM circles AS circle
                      WHERE circle.id = chain.circle_id AND circle.owner_id = $3
                  )
              )
              AND (
                  chain.creator_id = $3
                  OR EXISTS (
                      SELECT 1 FROM chain_members AS member
                      WHERE member.chain_id = chain.id AND member.user_id = $3
                  )
                  OR (
                      chain.visibility IN ('public', 'unlisted', 'circle')
                      AND (
                          chain.circle_id IS NULL
                          OR EXISTS (
                              SELECT 1 FROM circle_members AS member
                              WHERE member.circle_id = chain.circle_id
                                AND member.user_id = $3
                                AND member.status IN ('active', 'approved')
                          )
                      )
                  )
              )
        )
        "#,
    )
    .bind(chain_id)
    .bind(contribution_id)
    .bind(user.id)
    .fetch_one(&state.database)
    .await
    .map_err(|error| db_error(error, "check revision history access"))?;

    if !can_view {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "contribution_not_found",
            "This contribution is unavailable.",
        ));
    }

    let rows = sqlx::query(
        r#"
        SELECT revision.id, revision.revision_number, revision.title, revision.content,
               revision.payload, editor.username AS editor_username, revision.created_at
        FROM chain_contribution_revisions AS revision
        JOIN chain_contributions AS contribution ON contribution.id = revision.contribution_id
        JOIN profiles AS editor ON editor.id = revision.editor_id
        WHERE contribution.id = $1 AND contribution.chain_id = $2
        ORDER BY revision.revision_number DESC
        LIMIT 25
        "#,
    )
    .bind(contribution_id)
    .bind(chain_id)
    .fetch_all(&state.database)
    .await
    .map_err(|error| db_error(error, "load contribution revisions"))?;

    let revisions = rows
        .into_iter()
        .map(|row| {
            Ok(ContributionRevision {
                id: row
                    .try_get("id")
                    .map_err(|e| db_error(e, "read revision id"))?,
                revision_number: row
                    .try_get("revision_number")
                    .map_err(|e| db_error(e, "read revision number"))?,
                title: row
                    .try_get("title")
                    .map_err(|e| db_error(e, "read revision title"))?,
                content: row
                    .try_get("content")
                    .map_err(|e| db_error(e, "read revision content"))?,
                payload: row
                    .try_get("payload")
                    .map_err(|e| db_error(e, "read revision payload"))?,
                editor_username: row
                    .try_get("editor_username")
                    .map_err(|e| db_error(e, "read revision editor"))?,
                created_at: row
                    .try_get("created_at")
                    .map_err(|e| db_error(e, "read revision timestamp"))?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(revisions))
}

#[derive(Serialize)]
pub struct RestoreContributionRevisionResponse {
    success: bool,
    revision_number: i64,
    restored_revision_number: i64,
}

pub async fn restore_contribution_revision(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path((chain_id, contribution_id, revision_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<RestoreContributionRevisionResponse>, ApiError> {
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|error| db_error(error, "begin contribution revision restore"))?;

    let current = sqlx::query(
        r#"
        SELECT
            contribution.author_id,
            contribution.contribution_type,
            contribution.title,
            contribution.content,
            contribution.payload,
            chain.creator_id,
            chain.circle_id,
            chain.contribution_policy,
            chain.visibility,
            (
                SELECT member.role
                FROM chain_members AS member
                WHERE member.chain_id = chain.id
                  AND member.user_id = $3
            ) AS chain_member_role,
            EXISTS (
                SELECT 1
                FROM circles AS circle
                WHERE circle.id = chain.circle_id
                  AND (
                      circle.owner_id = $3
                      OR EXISTS (
                          SELECT 1
                          FROM circle_members AS circle_member
                          WHERE circle_member.circle_id = circle.id
                            AND circle_member.user_id = $3
                            AND circle_member.status IN ('active', 'approved')
                      )
                  )
            ) AS is_circle_member
        FROM chain_contributions AS contribution
        JOIN chains AS chain ON chain.id = contribution.chain_id
        WHERE chain.id = $1
          AND contribution.id = $2
          AND chain.status = 'active'
          AND contribution.status = 'published'
          AND contribution.author_id = $3
        FOR UPDATE OF contribution, chain
        "#,
    )
    .bind(chain_id)
    .bind(contribution_id)
    .bind(user.id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "load contribution for revision restore"))?
    .ok_or_else(|| {
        api_error(
            StatusCode::NOT_FOUND,
            "contribution_not_found",
            "This contribution is unavailable or you can no longer edit it.",
        )
    })?;

    let creator_id: Uuid = current
        .try_get("creator_id")
        .map_err(|error| db_error(error, "read Chain creator"))?;
    let circle_id: Option<Uuid> = current
        .try_get("circle_id")
        .map_err(|error| db_error(error, "read Chain Circle"))?;
    let contribution_policy: String = current
        .try_get("contribution_policy")
        .map_err(|error| db_error(error, "read Chain contribution policy"))?;
    let visibility: String = current
        .try_get("visibility")
        .map_err(|error| db_error(error, "read Chain visibility"))?;
    let chain_member_role: Option<String> = current
        .try_get("chain_member_role")
        .map_err(|error| db_error(error, "read Chain member role"))?;
    let is_circle_member: bool = current
        .try_get("is_circle_member")
        .map_err(|error| db_error(error, "read Circle membership"))?;
    if !can_contribute_to_chain(
        &contribution_policy,
        &visibility,
        circle_id.is_some(),
        creator_id == user.id,
        chain_member_role.as_deref(),
        is_circle_member,
    ) {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "contribution_not_found",
            "This contribution is unavailable or you can no longer edit it.",
        ));
    }

    let author_id: Uuid = current
        .try_get("author_id")
        .map_err(|error| db_error(error, "read contribution author"))?;
    if author_id != user.id {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "contribution_restore_denied",
            "Only the original author can restore a contribution revision.",
        ));
    }

    let contribution_type: String = current
        .try_get("contribution_type")
        .map_err(|error| db_error(error, "read contribution type"))?;
    let current_title: Option<String> = current
        .try_get("title")
        .map_err(|error| db_error(error, "read current contribution title"))?;
    let current_content: String = current
        .try_get("content")
        .map_err(|error| db_error(error, "read current contribution content"))?;
    let current_payload: Value = current
        .try_get("payload")
        .map_err(|error| db_error(error, "read current contribution payload"))?;

    let selected = sqlx::query(
        r#"
        SELECT revision.revision_number, revision.contribution_type,
               revision.title, revision.content, revision.payload
        FROM chain_contribution_revisions AS revision
        WHERE revision.id = $1 AND revision.contribution_id = $2
        "#,
    )
    .bind(revision_id)
    .bind(contribution_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "load selected contribution revision"))?
    .ok_or_else(|| {
        api_error(
            StatusCode::NOT_FOUND,
            "revision_not_found",
            "That previous version is no longer available.",
        )
    })?;

    let restored_revision_number: i64 = selected
        .try_get("revision_number")
        .map_err(|error| db_error(error, "read selected revision number"))?;
    let selected_type: String = selected
        .try_get("contribution_type")
        .map_err(|error| db_error(error, "read selected contribution type"))?;
    let restored_title: Option<String> = selected
        .try_get("title")
        .map_err(|error| db_error(error, "read selected revision title"))?;
    let restored_content: String = selected
        .try_get("content")
        .map_err(|error| db_error(error, "read selected revision content"))?;
    let restored_payload: Value = selected
        .try_get("payload")
        .map_err(|error| db_error(error, "read selected revision payload"))?;

    if selected_type != contribution_type {
        return Err(api_error(
            StatusCode::CONFLICT,
            "revision_format_mismatch",
            "This previous version no longer matches the contribution format.",
        ));
    }
    validate_edited_contribution(
        &contribution_type,
        restored_title.as_deref(),
        &restored_content,
        &restored_payload,
    )
    .map_err(|(code, message)| api_error(StatusCode::UNPROCESSABLE_ENTITY, code, message))?;

    let revision_number: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(revision_number), 0) + 1 FROM chain_contribution_revisions WHERE contribution_id = $1",
    )
    .bind(contribution_id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "allocate restore revision number"))?;

    sqlx::query(
        r#"
        INSERT INTO chain_contribution_revisions (
            contribution_id, editor_id, revision_number, contribution_type,
            title, content, payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(contribution_id)
    .bind(user.id)
    .bind(revision_number)
    .bind(&contribution_type)
    .bind(current_title)
    .bind(current_content)
    .bind(current_payload)
    .execute(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "preserve current version before restore"))?;

    sqlx::query(
        r#"
        UPDATE chain_contributions
        SET title = $3, content = $4, payload = $5, updated_at = NOW()
        WHERE id = $1 AND chain_id = $2
        "#,
    )
    .bind(contribution_id)
    .bind(chain_id)
    .bind(restored_title)
    .bind(restored_content)
    .bind(restored_payload)
    .execute(&mut *transaction)
    .await
    .map_err(|error| db_error(error, "restore selected contribution revision"))?;

    sqlx::query("UPDATE chains SET updated_at = NOW() WHERE id = $1")
        .bind(chain_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| db_error(error, "touch Chain after revision restore"))?;

    transaction
        .commit()
        .await
        .map_err(|error| db_error(error, "commit contribution revision restore"))?;

    Ok(Json(RestoreContributionRevisionResponse {
        success: true,
        revision_number,
        restored_revision_number,
    }))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{is_https, validate_edited_contribution};

    #[test]
    fn structured_lists_require_two_to_forty_entries() {
        assert!(
            validate_edited_contribution("list", None, "", &json!({"items": ["one", "two"]}))
                .is_ok()
        );
        assert!(
            validate_edited_contribution("list", None, "", &json!({"items": ["only one"]}))
                .is_err()
        );
    }

    #[test]
    fn polls_require_a_question_and_valid_options() {
        assert!(
            validate_edited_contribution(
                "poll",
                None,
                "Which option?",
                &json!({"options": ["A", "B"]})
            )
            .is_ok()
        );
        assert!(
            validate_edited_contribution("poll", None, "", &json!({"options": ["A", "B"]}))
                .is_err()
        );
    }

    #[test]
    fn media_and_links_require_https_urls() {
        assert!(is_https("https://media.example.test/file.webp"));
        assert!(!is_https("http://media.example.test/file.webp"));
        assert!(!is_https("javascript:alert(1)"));
    }

    #[test]
    fn update_rejects_oversized_structured_payloads() {
        let payload = json!({"items": ["x".repeat(65_000)]});
        assert!(validate_edited_contribution("list", None, "", &payload).is_err());
    }
}
