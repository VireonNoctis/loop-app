use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use url::Url;
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

#[derive(Serialize)]
pub struct CollectionSummary {
    id: Uuid,
    owner_id: Uuid,
    title: String,
    description: String,
    visibility: String,
    is_collaborative: bool,
    item_count: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct CollectionItem {
    id: Uuid,
    item_type: String,
    loop_id: Option<Uuid>,
    circle_id: Option<Uuid>,
    chain_id: Option<Uuid>,
    external_url: Option<String>,
    title_override: Option<String>,
    note: Option<String>,
    position: i64,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct CollectionCollaborator {
    user_id: Uuid,
    username: String,
    display_name: String,
    avatar_url: Option<String>,
    role: String,
    joined_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct CollectionPendingInvitation {
    user_id: Uuid,
    username: String,
    display_name: String,
    role: String,
    invited_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct CollectionInvitation {
    collection_id: Uuid,
    title: String,
    description: String,
    owner_id: Uuid,
    owner_username: String,
    owner_display_name: String,
    owner_avatar_url: Option<String>,
    role: String,
    invited_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct CollectionMemberInvitationResult {
    collection_id: Uuid,
    user_id: Uuid,
    username: String,
    role: String,
    status: String,
    expires_at: Option<DateTime<Utc>>,
}

#[derive(Deserialize)]
pub struct RespondCollectionInvitationInput {
    action: String,
}

fn normalize_collection_invitation_action(value: &str) -> Result<&str, ApiError> {
    match value {
        "accept" | "decline" => Ok(value),
        _ => Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_collection_invitation_action",
            "Choose accept or decline.",
        )),
    }
}

#[derive(Deserialize)]
pub struct AddCollectionMemberInput {
    username: String,
    role: Option<String>,
}

#[derive(Serialize)]
pub struct CollectionDetail {
    collection: CollectionSummary,
    items: Vec<CollectionItem>,
    collaborators: Vec<CollectionCollaborator>,
    pending_invitations: Vec<CollectionPendingInvitation>,
    can_edit: bool,
    can_manage_members: bool,
}

#[derive(Deserialize)]
pub struct ListCollectionsQuery {
    limit: Option<i64>,
    offset: Option<i64>,
    owner_id: Option<Uuid>,
    search: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateCollectionInput {
    title: String,
    description: Option<String>,
    visibility: Option<String>,
    is_collaborative: Option<bool>,
}

#[derive(Clone, Deserialize)]
pub struct AddCollectionItemInput {
    item_type: String,
    loop_id: Option<Uuid>,
    circle_id: Option<Uuid>,
    chain_id: Option<Uuid>,
    external_url: Option<String>,
    title_override: Option<String>,
    note: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    user: OptionalAuthenticatedUser,
    Query(query): Query<ListCollectionsQuery>,
) -> Result<Json<Vec<CollectionSummary>>, ApiError> {
    let limit = query.limit.unwrap_or(24).clamp(1, 50);
    let offset = query.offset.unwrap_or(0).max(0);

    let rows = sqlx::query(
        r#"
        SELECT
            c.id,
            c.owner_id,
            c.title,
            c.description,
            c.visibility,
            c.is_collaborative,
            COUNT(item.id)::BIGINT AS item_count,
            c.created_at,
            c.updated_at
        FROM collections AS c
        LEFT JOIN collection_items AS item ON item.collection_id = c.id
        WHERE (
            c.visibility = 'public'
            OR (
                $1::uuid IS NOT NULL
                AND (
                    c.owner_id = $1
                    OR (
                        c.is_collaborative IS TRUE
                        AND EXISTS (
                            SELECT 1
                            FROM collection_members AS member
                            WHERE member.collection_id = c.id
                              AND member.user_id = $1
                              AND member.status = 'active'
                        )
                    )
                )
            )
        )
          AND ($4::uuid IS NULL OR c.owner_id = $4)
          AND (
              $5::text IS NULL
              OR c.title ILIKE '%' || $5 || '%'
              OR c.description ILIKE '%' || $5 || '%'
          )
        GROUP BY c.id
        ORDER BY c.updated_at DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(user.0.as_ref().map(|authenticated| authenticated.id))
    .bind(limit)
    .bind(offset)
    .bind(query.owner_id)
    .bind(
        query
            .search
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    )
    .fetch_all(&state.database)
    .await
    .map_err(|error| {
        tracing::error!(%error, "failed to list collections");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_list_failed",
            "Could not load collections.",
        )
    })?;

    let collections = rows
        .into_iter()
        .map(|row| {
            Ok(CollectionSummary {
                id: row.try_get("id").map_err(internal_db_error)?,
                owner_id: row.try_get("owner_id").map_err(internal_db_error)?,
                title: row.try_get("title").map_err(internal_db_error)?,
                description: row.try_get("description").map_err(internal_db_error)?,
                visibility: row.try_get("visibility").map_err(internal_db_error)?,
                is_collaborative: row.try_get("is_collaborative").map_err(internal_db_error)?,
                item_count: row.try_get("item_count").map_err(internal_db_error)?,
                created_at: row.try_get("created_at").map_err(internal_db_error)?,
                updated_at: row.try_get("updated_at").map_err(internal_db_error)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(collections))
}

pub async fn create(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Json(input): Json<CreateCollectionInput>,
) -> Result<(StatusCode, Json<CollectionSummary>), ApiError> {
    let title = input.title.trim();
    if title.is_empty() || title.chars().count() > 80 {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_title",
            "Collection titles must contain between 1 and 80 characters.",
        ));
    }

    let description = input.description.unwrap_or_default();
    if description.chars().count() > 500 {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "description_too_long",
            "Collection descriptions cannot exceed 500 characters.",
        ));
    }

    let visibility = input.visibility.as_deref().unwrap_or("private");
    if !matches!(visibility, "private" | "unlisted" | "public") {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_visibility",
            "Visibility must be private, unlisted or public.",
        ));
    }

    let row = sqlx::query(
        r#"
        INSERT INTO collections (owner_id, title, description, visibility, is_collaborative)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, owner_id, title, description, visibility, is_collaborative,
                  created_at, updated_at
        "#,
    )
    .bind(user.id)
    .bind(title)
    .bind(description.trim())
    .bind(visibility)
    .bind(input.is_collaborative.unwrap_or(false))
    .fetch_one(&state.database)
    .await
    .map_err(|error| {
        tracing::error!(%error, "failed to create collection");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_create_failed",
            "Could not create the collection.",
        )
    })?;

    let collection = CollectionSummary {
        id: row.try_get("id").map_err(internal_db_error)?,
        owner_id: row.try_get("owner_id").map_err(internal_db_error)?,
        title: row.try_get("title").map_err(internal_db_error)?,
        description: row.try_get("description").map_err(internal_db_error)?,
        visibility: row.try_get("visibility").map_err(internal_db_error)?,
        is_collaborative: row.try_get("is_collaborative").map_err(internal_db_error)?,
        item_count: 0,
        created_at: row.try_get("created_at").map_err(internal_db_error)?,
        updated_at: row.try_get("updated_at").map_err(internal_db_error)?,
    };

    Ok((StatusCode::CREATED, Json(collection)))
}

pub async fn get(
    State(state): State<AppState>,
    user: OptionalAuthenticatedUser,
    Path(collection_id): Path<Uuid>,
) -> Result<Json<CollectionDetail>, ApiError> {
    let viewer_id = user.0.as_ref().map(|authenticated| authenticated.id);
    let row = sqlx::query(
        r#"
        SELECT
            c.id, c.owner_id, c.title, c.description, c.visibility,
            c.is_collaborative, c.created_at, c.updated_at,
            COUNT(item.id)::BIGINT AS item_count,
            COALESCE(
                $2::uuid IS NOT NULL
                AND (
                    c.owner_id = $2
                    OR (
                        c.is_collaborative IS TRUE
                        AND EXISTS (
                            SELECT 1 FROM collection_members AS member
                            WHERE member.collection_id = c.id
                              AND member.user_id = $2
                              AND member.status = 'active'
                              AND member.role = 'editor'
                        )
                    )
                ),
                false
            ) AS can_edit
        FROM collections AS c
        LEFT JOIN collection_items AS item ON item.collection_id = c.id
        WHERE c.id = $1
          AND (
              c.visibility IN ('public', 'unlisted')
              OR (
                  $2::uuid IS NOT NULL
                  AND (
                      c.owner_id = $2
                      OR (
                          c.is_collaborative IS TRUE
                          AND EXISTS (
                              SELECT 1 FROM collection_members AS member
                              WHERE member.collection_id = c.id
                                AND member.user_id = $2
                               AND member.status = 'active'
                          )
                      )
                  )
              )
          )
        GROUP BY c.id
        "#,
    )
    .bind(collection_id)
    .bind(user.0.as_ref().map(|authenticated| authenticated.id))
    .fetch_optional(&state.database)
    .await
    .map_err(|error| {
        tracing::error!(%error, "failed to load collection");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_load_failed",
            "Could not load this collection.",
        )
    })?;

    let Some(row) = row else {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "collection_not_found",
            "This collection is unavailable.",
        ));
    };

    let mut collection = CollectionSummary {
        id: row.try_get("id").map_err(internal_db_error)?,
        owner_id: row.try_get("owner_id").map_err(internal_db_error)?,
        title: row.try_get("title").map_err(internal_db_error)?,
        description: row.try_get("description").map_err(internal_db_error)?,
        visibility: row.try_get("visibility").map_err(internal_db_error)?,
        is_collaborative: row.try_get("is_collaborative").map_err(internal_db_error)?,
        item_count: row.try_get("item_count").map_err(internal_db_error)?,
        created_at: row.try_get("created_at").map_err(internal_db_error)?,
        updated_at: row.try_get("updated_at").map_err(internal_db_error)?,
    };
    let can_edit: bool = row.try_get("can_edit").map_err(internal_db_error)?;

    let item_rows = sqlx::query(
        r#"
        SELECT
            item.id, item.item_type, item.loop_id, item.circle_id, item.chain_id,
            item.external_url, item.title_override, item.note, item.position, item.created_at
        FROM collection_items AS item
        WHERE item.collection_id = $1
          AND (
              item.item_type = 'external'
              OR (
                  item.item_type = 'loop'
                  AND EXISTS (
                      SELECT 1 FROM loops AS target_loop
                      WHERE target_loop.id = item.loop_id
                        AND (
                            target_loop.visibility = 'public'
                            OR target_loop.author_id = $2
                            OR (
                                target_loop.visibility = 'circle'
                                AND EXISTS (
                                    SELECT 1 FROM circle_members AS member
                                    WHERE member.circle_id = target_loop.circle_id
                                      AND member.user_id = $2
                                      AND member.status IN ('active', 'approved')
                                )
                            )
                        )
                  )
              )
              OR (
                  item.item_type = 'circle'
                  AND EXISTS (
                      SELECT 1 FROM circles AS target_circle
                      WHERE target_circle.id = item.circle_id
                        AND (
                            target_circle.is_premium_only IS NOT TRUE
                            OR EXISTS (
                                SELECT 1
                                FROM profiles AS viewer_profile
                                WHERE viewer_profile.id = $2
                                  AND viewer_profile.is_premium IS TRUE
                                  AND (
                                      viewer_profile.premium_expires_at IS NULL
                                      OR viewer_profile.premium_expires_at > NOW()
                                  )
                            )
                        )
                        AND (
                            target_circle.is_private = false
                            OR target_circle.owner_id = $2
                            OR EXISTS (
                                SELECT 1 FROM circle_members AS member
                                WHERE member.circle_id = target_circle.id
                                  AND member.user_id = $2
                                  AND member.status IN ('active', 'approved')
                            )
                        )
                  )
              )
              OR (
                  item.item_type = 'chain'
                  AND EXISTS (
                      SELECT 1 FROM chains AS target_chain
                      WHERE target_chain.id = item.chain_id
                        AND (
                            target_chain.circle_id IS NULL
                            OR EXISTS (
                                SELECT 1
                                FROM circles AS scoped_circle
                                WHERE scoped_circle.id = target_chain.circle_id
                                  AND (
                                      scoped_circle.is_premium_only IS NOT TRUE
                                      OR EXISTS (
                                          SELECT 1
                                          FROM profiles AS viewer_profile
                                          WHERE viewer_profile.id = $2
                                            AND viewer_profile.is_premium IS TRUE
                                            AND (
                                                viewer_profile.premium_expires_at IS NULL
                                                OR viewer_profile.premium_expires_at > NOW()
                                            )
                                      )
                                  )
                            )
                        )
                        AND (
                            target_chain.visibility <> 'circle'
                            OR EXISTS (
                                SELECT 1 FROM circle_members AS circle_member
                                WHERE circle_member.circle_id = target_chain.circle_id
                                  AND circle_member.user_id = $2
                                  AND circle_member.status IN ('active', 'approved')
                            )
                            OR EXISTS (
                                SELECT 1 FROM circles AS circle
                                WHERE circle.id = target_chain.circle_id AND circle.owner_id = $2
                            )
                        )
                        AND (
                            target_chain.creator_id = $2
                            OR EXISTS (
                                SELECT 1 FROM chain_members AS chain_member
                                WHERE chain_member.chain_id = target_chain.id
                                  AND chain_member.user_id = $2
                            )
                            OR (
                                target_chain.visibility IN ('public', 'unlisted')
                                AND (
                                    target_chain.circle_id IS NULL
                                    OR EXISTS (
                                        SELECT 1 FROM circle_members AS circle_member
                                        WHERE circle_member.circle_id = target_chain.circle_id
                                          AND circle_member.user_id = $2
                                          AND circle_member.status IN ('active', 'approved')
                                    )
                                )
                            )
                            OR (
                                target_chain.visibility = 'circle'
                                AND EXISTS (
                                    SELECT 1 FROM circle_members AS circle_member
                                    WHERE circle_member.circle_id = target_chain.circle_id
                                      AND circle_member.user_id = $2
                                      AND circle_member.status IN ('active', 'approved')
                                )
                            )
                        )
                  )
              )
          )
        ORDER BY item.position ASC, item.created_at ASC
        LIMIT 200
        "#,
    )
    .bind(collection_id)
    .bind(viewer_id)
    .fetch_all(&state.database)
    .await
    .map_err(|error| {
        tracing::error!(%error, "failed to load collection items");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_items_failed",
            "Could not load collection items.",
        )
    })?;

    let items = item_rows
        .into_iter()
        .map(|row| {
            Ok(CollectionItem {
                id: row.try_get("id").map_err(internal_db_error)?,
                item_type: row.try_get("item_type").map_err(internal_db_error)?,
                loop_id: row.try_get("loop_id").map_err(internal_db_error)?,
                circle_id: row.try_get("circle_id").map_err(internal_db_error)?,
                chain_id: row.try_get("chain_id").map_err(internal_db_error)?,
                external_url: row.try_get("external_url").map_err(internal_db_error)?,
                title_override: row.try_get("title_override").map_err(internal_db_error)?,
                note: row.try_get("note").map_err(internal_db_error)?,
                position: row.try_get("position").map_err(internal_db_error)?,
                created_at: row.try_get("created_at").map_err(internal_db_error)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    // Report only items that this viewer is actually allowed to see.
    collection.item_count = items.len() as i64;

    let collaborators = if collection.is_collaborative {
        let rows = sqlx::query(
            r#"
            SELECT member.user_id, profile.username, profile.display_name,
                   profile.avatar_url, member.role, member.joined_at
            FROM collection_members AS member
            JOIN profiles AS profile ON profile.id = member.user_id
            WHERE member.collection_id = $1
              AND member.status = 'active'
            ORDER BY member.joined_at ASC, member.user_id ASC
            "#,
        )
        .bind(collection_id)
        .fetch_all(&state.database)
        .await
        .map_err(|error| {
            tracing::error!(%error, "failed to load collection collaborators");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "collection_collaborators_failed",
                "Could not load collection collaborators.",
            )
        })?;

        rows.into_iter()
            .map(|row| {
                Ok(CollectionCollaborator {
                    user_id: row.try_get("user_id").map_err(internal_db_error)?,
                    username: row.try_get("username").map_err(internal_db_error)?,
                    display_name: row.try_get("display_name").map_err(internal_db_error)?,
                    avatar_url: row.try_get("avatar_url").map_err(internal_db_error)?,
                    role: row.try_get("role").map_err(internal_db_error)?,
                    joined_at: row.try_get("joined_at").map_err(internal_db_error)?,
                })
            })
            .collect::<Result<Vec<_>, ApiError>>()?
    } else {
        Vec::new()
    };
    let can_manage_members = viewer_id == Some(collection.owner_id);
    let pending_invitations = if can_manage_members {
        let rows = sqlx::query(
            r#"
            SELECT member.user_id, profile.username, profile.display_name,
                   member.role, member.invited_at, member.expires_at
            FROM collection_members AS member
            JOIN profiles AS profile ON profile.id = member.user_id
            WHERE member.collection_id = $1
              AND member.status = 'pending'
              AND member.expires_at > NOW()
            ORDER BY member.invited_at ASC, member.user_id ASC
            "#,
        )
        .bind(collection_id)
        .fetch_all(&state.database)
        .await
        .map_err(|error| {
            tracing::error!(%error, "failed to load pending Collection invitations");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "collection_pending_invitations_failed",
                "Could not load pending invitations.",
            )
        })?;

        rows.into_iter()
            .map(|row| {
                Ok(CollectionPendingInvitation {
                    user_id: row.try_get("user_id").map_err(internal_db_error)?,
                    username: row.try_get("username").map_err(internal_db_error)?,
                    display_name: row.try_get("display_name").map_err(internal_db_error)?,
                    role: row.try_get("role").map_err(internal_db_error)?,
                    invited_at: row.try_get("invited_at").map_err(internal_db_error)?,
                    expires_at: row.try_get("expires_at").map_err(internal_db_error)?,
                })
            })
            .collect::<Result<Vec<_>, ApiError>>()?
    } else {
        Vec::new()
    };

    Ok(Json(CollectionDetail {
        collection,
        items,
        collaborators,
        pending_invitations,
        can_edit,
        can_manage_members,
    }))
}

fn normalize_collection_member_username(value: &str) -> Result<String, ApiError> {
    let username = value.trim().trim_start_matches('@').to_lowercase();
    let valid = !username.is_empty()
        && username.chars().count() <= 50
        && username.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | '-')
        });
    if !valid {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_collection_member_username",
            "Enter a valid LOOP username.",
        ));
    }
    Ok(username)
}

fn normalize_collection_member_role(value: Option<&str>) -> Result<&str, ApiError> {
    match value.unwrap_or("editor") {
        "editor" => Ok("editor"),
        "viewer" => Ok("viewer"),
        _ => Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_collection_member_role",
            "Collection collaborators can have the editor or viewer role.",
        )),
    }
}

pub async fn add_member(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(collection_id): Path<Uuid>,
    Json(input): Json<AddCollectionMemberInput>,
) -> Result<(StatusCode, Json<CollectionMemberInvitationResult>), ApiError> {
    let username = normalize_collection_member_username(&input.username)?;
    let role = normalize_collection_member_role(input.role.as_deref())?;
    let mut transaction = state.database.begin().await.map_err(|error| {
        tracing::error!(%error, "could not begin collection invitation transaction");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_invitation_transaction_failed",
            "Could not create this invitation.",
        )
    })?;

    let collection = sqlx::query(
        "SELECT owner_id, title, is_collaborative FROM collections WHERE id = $1 FOR UPDATE",
    )
    .bind(collection_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| {
        tracing::error!(%error, "could not authorize collection invitation");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_invitation_permission_failed",
            "Could not authorize this invitation.",
        )
    })?
    .ok_or_else(|| {
        api_error(
            StatusCode::NOT_FOUND,
            "collection_not_found",
            "This collection is unavailable.",
        )
    })?;

    let owner_id: Uuid = collection.try_get("owner_id").map_err(internal_db_error)?;
    let collection_title: String = collection.try_get("title").map_err(internal_db_error)?;
    let is_collaborative: bool = collection
        .try_get("is_collaborative")
        .map_err(internal_db_error)?;
    if owner_id != user.id {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "collection_owner_required",
            "Only the collection owner can invite collaborators.",
        ));
    }
    if !is_collaborative {
        return Err(api_error(
            StatusCode::CONFLICT,
            "collection_not_collaborative",
            "Enable collaboration before inviting collaborators.",
        ));
    }

    let target_user_id =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM profiles WHERE lower(username) = $1")
            .bind(&username)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|error| {
                tracing::error!(%error, "could not resolve collection invitee");
                api_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "collection_invitee_lookup_failed",
                    "Could not find that account.",
                )
            })?
            .ok_or_else(|| {
                api_error(
                    StatusCode::NOT_FOUND,
                    "collection_invitee_not_found",
                    "No LOOP account has that username.",
                )
            })?;

    if target_user_id == owner_id {
        return Err(api_error(
            StatusCode::CONFLICT,
            "collection_owner_is_not_collaborator",
            "The collection owner already has full access.",
        ));
    }

    let row = sqlx::query(
        r#"
        INSERT INTO collection_members (
            collection_id, user_id, role, invited_by, status, invited_at, expires_at, accepted_at
        )
        VALUES ($1, $2, $3, $4, 'pending', NOW(), NOW() + INTERVAL '30 days', NULL)
        ON CONFLICT (collection_id, user_id)
        DO UPDATE SET
            role = EXCLUDED.role,
            invited_by = EXCLUDED.invited_by,
            status = CASE
                WHEN collection_members.status = 'active' THEN 'active'
                ELSE 'pending'
            END,
            invited_at = CASE
                WHEN collection_members.status = 'active' THEN collection_members.invited_at
                ELSE NOW()
            END,
            expires_at = CASE
                WHEN collection_members.status = 'active' THEN collection_members.expires_at
                ELSE NOW() + INTERVAL '30 days'
            END,
            accepted_at = CASE
                WHEN collection_members.status = 'active' THEN collection_members.accepted_at
                ELSE NULL
            END
        RETURNING user_id, role, status, expires_at
        "#,
    )
    .bind(collection_id)
    .bind(target_user_id)
    .bind(role)
    .bind(user.id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| {
        tracing::error!(%error, "failed to create collection invitation");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_invitation_create_failed",
            "Could not create this invitation.",
        )
    })?;

    let invitee = sqlx::query("SELECT username FROM profiles WHERE id = $1")
        .bind(target_user_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(internal_db_error)?;

    let invitee_username: String = invitee.try_get("username").map_err(internal_db_error)?;
    let status: String = row.try_get("status").map_err(internal_db_error)?;

    if status == "pending" {
        let owner_profile =
            sqlx::query("SELECT username, display_name FROM profiles WHERE id = $1")
                .bind(owner_id)
                .fetch_one(&mut *transaction)
                .await
                .map_err(internal_db_error)?;
        let owner_username: String = owner_profile
            .try_get("username")
            .map_err(internal_db_error)?;
        let owner_display_name: String = owner_profile
            .try_get("display_name")
            .map_err(internal_db_error)?;

        sqlx::query(
            r#"
            INSERT INTO notifications (user_id, type, title, message, data, is_read)
            VALUES (
                $1, 'system', 'Collection invitation',
                $2,
                jsonb_build_object(
                    'collection_id', $3::text,
                    'route', $4::text,
                    'invitation_type', 'collection'
                ),
                FALSE
            )
            "#,
        )
        .bind(target_user_id)
        .bind(format!(
            "{} (@{}) invited you to collaborate on “{}”.",
            owner_display_name, owner_username, collection_title
        ))
        .bind(collection_id)
        .bind(format!("/collections/{}", collection_id))
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            tracing::error!(%error, "failed to create collection invitation notification");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "collection_invitation_notification_failed",
                "Could not deliver this invitation.",
            )
        })?;
    }

    let result = CollectionMemberInvitationResult {
        collection_id,
        user_id: row.try_get("user_id").map_err(internal_db_error)?,
        username: invitee_username,
        role: row.try_get("role").map_err(internal_db_error)?,
        status,
        expires_at: row.try_get("expires_at").map_err(internal_db_error)?,
    };

    transaction.commit().await.map_err(|error| {
        tracing::error!(%error, "failed to commit collection invitation");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_invitation_commit_failed",
            "Could not save this invitation.",
        )
    })?;

    Ok((StatusCode::CREATED, Json(result)))
}

pub async fn list_invitations(
    State(state): State<AppState>,
    user: AuthenticatedUser,
) -> Result<Json<Vec<CollectionInvitation>>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT
            collection.id AS collection_id,
            collection.title,
            collection.description,
            collection.owner_id,
            owner.username AS owner_username,
            owner.display_name AS owner_display_name,
            owner.avatar_url AS owner_avatar_url,
            member.role,
            member.invited_at,
            member.expires_at
        FROM collection_members AS member
        JOIN collections AS collection ON collection.id = member.collection_id
        JOIN profiles AS owner ON owner.id = collection.owner_id
        WHERE member.user_id = $1
          AND member.status = 'pending'
          AND member.expires_at > NOW()
          AND collection.is_collaborative IS TRUE
        ORDER BY member.invited_at DESC
        LIMIT 50
        "#,
    )
    .bind(user.id)
    .fetch_all(&state.database)
    .await
    .map_err(|error| {
        tracing::error!(%error, "failed to load Collection invitations");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_invitations_load_failed",
            "Could not load your Collection invitations.",
        )
    })?;

    let invitations = rows
        .into_iter()
        .map(|row| {
            Ok(CollectionInvitation {
                collection_id: row.try_get("collection_id").map_err(internal_db_error)?,
                title: row.try_get("title").map_err(internal_db_error)?,
                description: row.try_get("description").map_err(internal_db_error)?,
                owner_id: row.try_get("owner_id").map_err(internal_db_error)?,
                owner_username: row.try_get("owner_username").map_err(internal_db_error)?,
                owner_display_name: row
                    .try_get("owner_display_name")
                    .map_err(internal_db_error)?,
                owner_avatar_url: row.try_get("owner_avatar_url").map_err(internal_db_error)?,
                role: row.try_get("role").map_err(internal_db_error)?,
                invited_at: row.try_get("invited_at").map_err(internal_db_error)?,
                expires_at: row.try_get("expires_at").map_err(internal_db_error)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(invitations))
}

pub async fn respond_to_invitation(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(collection_id): Path<Uuid>,
    Json(input): Json<RespondCollectionInvitationInput>,
) -> Result<StatusCode, ApiError> {
    let action = normalize_collection_invitation_action(&input.action)?;
    let mut transaction = state.database.begin().await.map_err(|error| {
        tracing::error!(%error, "could not begin Collection invitation response");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_invitation_transaction_failed",
            "Could not update this invitation.",
        )
    })?;

    let collection =
        sqlx::query("SELECT owner_id, is_collaborative FROM collections WHERE id = $1 FOR UPDATE")
            .bind(collection_id)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|error| {
                tracing::error!(%error, "could not load Collection invitation target");
                api_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "collection_invitation_lookup_failed",
                    "Could not load this invitation.",
                )
            })?
            .ok_or_else(|| {
                api_error(
                    StatusCode::NOT_FOUND,
                    "collection_invitation_not_found",
                    "This invitation is unavailable.",
                )
            })?;

    let owner_id: Uuid = collection.try_get("owner_id").map_err(internal_db_error)?;
    let is_collaborative: bool = collection
        .try_get("is_collaborative")
        .map_err(internal_db_error)?;
    if !is_collaborative {
        return Err(api_error(
            StatusCode::CONFLICT,
            "collection_not_collaborative",
            "This Collection no longer supports collaboration.",
        ));
    }

    let invitation = sqlx::query(
        r#"
        SELECT status, expires_at
        FROM collection_members
        WHERE collection_id = $1 AND user_id = $2
        FOR UPDATE
        "#,
    )
    .bind(collection_id)
    .bind(user.id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(internal_db_error)?
    .ok_or_else(|| {
        api_error(
            StatusCode::NOT_FOUND,
            "collection_invitation_not_found",
            "This invitation is unavailable.",
        )
    })?;

    let current_status: String = invitation.try_get("status").map_err(internal_db_error)?;
    if current_status != "pending" {
        return Err(api_error(
            StatusCode::CONFLICT,
            "collection_invitation_already_handled",
            "This invitation has already been handled.",
        ));
    }

    let expires_at: DateTime<Utc> = invitation
        .try_get("expires_at")
        .map_err(internal_db_error)?;
    if expires_at <= Utc::now() {
        sqlx::query(
            "UPDATE collection_members SET status = 'expired' WHERE collection_id = $1 AND user_id = $2",
        )
        .bind(collection_id)
        .bind(user.id)
        .execute(&mut *transaction)
        .await
        .map_err(internal_db_error)?;
        transaction.commit().await.map_err(internal_db_error)?;
        return Err(api_error(
            StatusCode::GONE,
            "collection_invitation_expired",
            "This invitation has expired. Ask the owner to send a new one.",
        ));
    }

    if action == "accept" {
        let account =
            sqlx::query("SELECT is_banned, is_deleted FROM profiles WHERE id = $1 FOR UPDATE")
                .bind(user.id)
                .fetch_one(&mut *transaction)
                .await
                .map_err(internal_db_error)?;
        let is_banned: bool = account.try_get("is_banned").map_err(internal_db_error)?;
        let is_deleted: bool = account.try_get("is_deleted").map_err(internal_db_error)?;
        if is_banned || is_deleted {
            return Err(api_error(
                StatusCode::FORBIDDEN,
                "account_cannot_accept_collection_invitation",
                "Suspended or deleted accounts cannot accept Collection invitations.",
            ));
        }

        sqlx::query(
            r#"
            UPDATE collection_members
            SET status = 'active', accepted_at = NOW(), joined_at = NOW()
            WHERE collection_id = $1 AND user_id = $2
            "#,
        )
        .bind(collection_id)
        .bind(user.id)
        .execute(&mut *transaction)
        .await
        .map_err(internal_db_error)?;
    } else {
        sqlx::query(
            r#"
            UPDATE collection_members
            SET status = 'declined', accepted_at = NULL
            WHERE collection_id = $1 AND user_id = $2
            "#,
        )
        .bind(collection_id)
        .bind(user.id)
        .execute(&mut *transaction)
        .await
        .map_err(internal_db_error)?;
    }

    sqlx::query(
        r#"
        INSERT INTO notifications (user_id, type, title, message, data, is_read)
        VALUES (
            $1, 'system', $2, $3,
            jsonb_build_object('collection_id', $4::text, 'route', $5::text),
            FALSE
        )
        "#,
    )
    .bind(owner_id)
    .bind(if action == "accept" {
        "Collection invitation accepted"
    } else {
        "Collection invitation declined"
    })
    .bind(if action == "accept" {
        "A collaborator accepted your Collection invitation."
    } else {
        "A collaborator declined your Collection invitation."
    })
    .bind(collection_id)
    .bind(format!("/collections/{}", collection_id))
    .execute(&mut *transaction)
    .await
    .map_err(|error| {
        tracing::error!(%error, "failed to notify Collection owner about invitation response");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_invitation_response_notification_failed",
            "Could not save the invitation response.",
        )
    })?;

    transaction.commit().await.map_err(|error| {
        tracing::error!(%error, "failed to commit Collection invitation response");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_invitation_response_commit_failed",
            "Could not save the invitation response.",
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_member(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path((collection_id, member_user_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let mut transaction = state.database.begin().await.map_err(|error| {
        tracing::error!(%error, "could not begin collection collaborator removal");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_collaborator_transaction_failed",
            "Could not update collaborators.",
        )
    })?;

    let collection = sqlx::query("SELECT owner_id FROM collections WHERE id = $1 FOR UPDATE")
        .bind(collection_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| {
            tracing::error!(%error, "could not authorize collaborator removal");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "collection_collaborator_permission_failed",
                "Could not authorize this change.",
            )
        })?
        .ok_or_else(|| {
            api_error(
                StatusCode::NOT_FOUND,
                "collection_not_found",
                "This collection is unavailable.",
            )
        })?;

    let owner_id: Uuid = collection.try_get("owner_id").map_err(internal_db_error)?;
    if owner_id == member_user_id {
        return Err(api_error(
            StatusCode::CONFLICT,
            "collection_owner_cannot_be_removed",
            "The collection owner cannot be removed.",
        ));
    }
    if owner_id != user.id && member_user_id != user.id {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "collection_owner_required",
            "Only the owner can remove another collaborator.",
        ));
    }

    let deleted = sqlx::query_scalar::<_, Uuid>(
        "DELETE FROM collection_members WHERE collection_id = $1 AND user_id = $2 RETURNING user_id",
    )
    .bind(collection_id)
    .bind(member_user_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| {
        tracing::error!(%error, "failed to remove collection collaborator");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_collaborator_remove_failed",
            "Could not remove this collaborator.",
        )
    })?;

    if deleted.is_none() {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "collection_collaborator_not_found",
            "That collaborator is no longer part of this collection.",
        ));
    }

    transaction.commit().await.map_err(|error| {
        tracing::error!(%error, "failed to commit collection collaborator removal");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_collaborator_commit_failed",
            "Could not save this change.",
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn add_item(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(collection_id): Path<Uuid>,
    Json(input): Json<AddCollectionItemInput>,
) -> Result<(StatusCode, Json<CollectionItem>), ApiError> {
    let target = validate_item_input(&input)?;

    let mut transaction = state.database.begin().await.map_err(|error| {
        tracing::error!(%error, "could not begin collection item transaction");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_transaction_failed",
            "Could not update this collection.",
        )
    })?;

    let editable = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM collections AS collection
            WHERE collection.id = $1 AND (
                collection.owner_id = $2 OR (
                    collection.is_collaborative IS TRUE
                    AND EXISTS (
                        SELECT 1 FROM collection_members AS member
                        WHERE member.collection_id = collection.id
                          AND member.user_id = $2
                          AND member.status = 'active'
                          AND member.role = 'editor'
                    )
                )
            )
        )
        "#,
    )
    .bind(collection_id)
    .bind(user.id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| {
        tracing::error!(%error, "could not authorize collection edit");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_permission_failed",
            "Could not authorize this change.",
        )
    })?;

    if !editable {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "collection_not_found",
            "This collection is unavailable.",
        ));
    }

    match target {
        ValidatedItem::Loop(loop_id) => {
            let allowed = sqlx::query_scalar::<_, bool>(
                r#"
                SELECT EXISTS (
                    SELECT 1 FROM loops AS loop
                    WHERE loop.id = $1 AND (
                        loop.visibility = 'public'
                        OR loop.author_id = $2
                        OR EXISTS (
                            SELECT 1 FROM circle_members AS member
                            WHERE member.circle_id = loop.circle_id
                              AND member.user_id = $2
                              AND member.status IN ('active', 'approved')
                              AND loop.visibility = 'circle'
                        )
                    )
                )
                "#,
            )
            .bind(loop_id)
            .bind(user.id)
            .fetch_one(&mut *transaction)
            .await
            .map_err(|error| {
                tracing::error!(%error, "could not validate collection Loop");
                api_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "collection_target_check_failed",
                    "Could not validate that Loop.",
                )
            })?;
            if !allowed {
                return Err(api_error(
                    StatusCode::NOT_FOUND,
                    "loop_unavailable",
                    "That Loop is unavailable.",
                ));
            }
        }
        ValidatedItem::Circle(circle_id) => {
            let allowed = sqlx::query_scalar::<_, bool>(
                r#"
                SELECT EXISTS (
                    SELECT 1 FROM circles AS circle
                    WHERE circle.id = $1
                      AND (
                          circle.is_premium_only IS NOT TRUE
                          OR EXISTS (
                              SELECT 1
                              FROM profiles AS viewer_profile
                              WHERE viewer_profile.id = $2
                                AND viewer_profile.is_premium IS TRUE
                                AND (
                                    viewer_profile.premium_expires_at IS NULL
                                    OR viewer_profile.premium_expires_at > NOW()
                                )
                          )
                      )
                      AND (
                          circle.is_private = false
                          OR circle.owner_id = $2
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
            .map_err(|error| {
                tracing::error!(%error, "could not validate collection Circle");
                api_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "collection_target_check_failed",
                    "Could not validate that Circle.",
                )
            })?;
            if !allowed {
                return Err(api_error(
                    StatusCode::NOT_FOUND,
                    "circle_unavailable",
                    "That Circle is unavailable.",
                ));
            }
        }
        ValidatedItem::Chain(chain_id) => {
            let allowed = sqlx::query_scalar::<_, bool>(
                r#"
                SELECT EXISTS (
                    SELECT 1 FROM chains AS target_chain
                    WHERE target_chain.id = $1
                      AND (
                          target_chain.circle_id IS NULL
                          OR EXISTS (
                              SELECT 1
                              FROM circles AS scoped_circle
                              WHERE scoped_circle.id = target_chain.circle_id
                                AND (
                                    scoped_circle.is_premium_only IS NOT TRUE
                                    OR EXISTS (
                                        SELECT 1
                                        FROM profiles AS viewer_profile
                                        WHERE viewer_profile.id = $2
                                          AND viewer_profile.is_premium IS TRUE
                                          AND (
                                              viewer_profile.premium_expires_at IS NULL
                                              OR viewer_profile.premium_expires_at > NOW()
                                          )
                                    )
                                )
                          )
                      )
                      AND (
                          target_chain.visibility <> 'circle'
                          OR EXISTS (
                              SELECT 1 FROM circle_members AS circle_member
                              WHERE circle_member.circle_id = target_chain.circle_id
                                AND circle_member.user_id = $2
                                AND circle_member.status IN ('active', 'approved')
                          )
                          OR EXISTS (
                              SELECT 1 FROM circles AS circle
                              WHERE circle.id = target_chain.circle_id AND circle.owner_id = $2
                          )
                      )
                      AND (
                          target_chain.creator_id = $2
                          OR EXISTS (
                              SELECT 1 FROM chain_members AS member
                              WHERE member.chain_id = target_chain.id
                                AND member.user_id = $2
                          )
                          OR (
                              target_chain.visibility IN ('public', 'unlisted')
                              AND (
                                  target_chain.circle_id IS NULL
                                  OR EXISTS (
                                      SELECT 1 FROM circle_members AS member
                                      WHERE member.circle_id = target_chain.circle_id
                                        AND member.user_id = $2
                                        AND member.status IN ('active', 'approved')
                                  )
                              )
                          )
                          OR (
                              target_chain.visibility = 'circle'
                              AND EXISTS (
                                  SELECT 1 FROM circle_members AS member
                                  WHERE member.circle_id = target_chain.circle_id
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
            .fetch_one(&mut *transaction)
            .await
            .map_err(|error| {
                tracing::error!(%error, "could not validate collection Chain");
                api_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "collection_target_check_failed",
                    "Could not validate that Chain.",
                )
            })?;
            if !allowed {
                return Err(api_error(
                    StatusCode::NOT_FOUND,
                    "chain_unavailable",
                    "That Chain is unavailable.",
                ));
            }
        }
        ValidatedItem::External(_) => {}
    }

    let position = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM collection_items WHERE collection_id = $1",
    )
    .bind(collection_id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| {
        tracing::error!(%error, "could not order collection item");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_order_failed",
            "Could not add this item.",
        )
    })?;

    let (item_type, loop_id, circle_id, chain_id, external_url) = match target {
        ValidatedItem::Loop(id) => ("loop", Some(id), None, None, None),
        ValidatedItem::Circle(id) => ("circle", None, Some(id), None, None),
        ValidatedItem::Chain(id) => ("chain", None, None, Some(id), None),
        ValidatedItem::External(url) => ("external", None, None, None, Some(url)),
    };

    let row = sqlx::query(
        r#"
        INSERT INTO collection_items (
            collection_id, added_by, item_type, loop_id, circle_id, chain_id, external_url,
            title_override, note, position
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, item_type, loop_id, circle_id, chain_id, external_url,
                  title_override, note, position, created_at
        "#,
    )
    .bind(collection_id)
    .bind(user.id)
    .bind(item_type)
    .bind(loop_id)
    .bind(circle_id)
    .bind(chain_id)
    .bind(external_url)
    .bind(
        input
            .title_override
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    )
    .bind(
        input
            .note
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    )
    .bind(position)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| {
        let message = error.to_string();
        if message.contains("idx_collection_items_unique") || message.contains("duplicate key") {
            return api_error(
                StatusCode::CONFLICT,
                "item_already_saved",
                "That item is already in this collection.",
            );
        }
        tracing::error!(%error, "failed to add collection item");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_add_failed",
            "Could not add this item.",
        )
    })?;

    transaction.commit().await.map_err(|error| {
        tracing::error!(%error, "failed to commit collection item");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_commit_failed",
            "Could not save this item.",
        )
    })?;

    let item = CollectionItem {
        id: row.try_get("id").map_err(internal_db_error)?,
        item_type: row.try_get("item_type").map_err(internal_db_error)?,
        loop_id: row.try_get("loop_id").map_err(internal_db_error)?,
        circle_id: row.try_get("circle_id").map_err(internal_db_error)?,
        chain_id: row.try_get("chain_id").map_err(internal_db_error)?,
        external_url: row.try_get("external_url").map_err(internal_db_error)?,
        title_override: row.try_get("title_override").map_err(internal_db_error)?,
        note: row.try_get("note").map_err(internal_db_error)?,
        position: row.try_get("position").map_err(internal_db_error)?,
        created_at: row.try_get("created_at").map_err(internal_db_error)?,
    };

    Ok((StatusCode::CREATED, Json(item)))
}

pub async fn remove_item(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path((collection_id, item_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let deleted = sqlx::query_scalar::<_, Uuid>(
        r#"
        DELETE FROM collection_items AS item
        USING collections AS collection
        WHERE item.id = $1
          AND item.collection_id = collection.id
          AND collection.id = $2
          AND (
              collection.owner_id = $3 OR (
                  collection.is_collaborative IS TRUE
                  AND EXISTS (
                      SELECT 1 FROM collection_members AS member
                      WHERE member.collection_id = collection.id
                        AND member.user_id = $3
                        AND member.status = 'active'
                        AND member.role = 'editor'
                  )
              )
          )
        RETURNING item.id
        "#,
    )
    .bind(item_id)
    .bind(collection_id)
    .bind(user.id)
    .fetch_optional(&state.database)
    .await
    .map_err(|error| {
        tracing::error!(%error, "failed to remove collection item");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "collection_remove_failed",
            "Could not remove this item.",
        )
    })?;

    if deleted.is_none() {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "collection_item_not_found",
            "That collection item is unavailable.",
        ));
    }

    Ok(StatusCode::NO_CONTENT)
}

enum ValidatedItem {
    Loop(Uuid),
    Circle(Uuid),
    Chain(Uuid),
    External(String),
}

fn validate_item_input(input: &AddCollectionItemInput) -> Result<ValidatedItem, ApiError> {
    if input
        .title_override
        .as_ref()
        .is_some_and(|value| value.chars().count() > 160)
        || input
            .note
            .as_ref()
            .is_some_and(|value| value.chars().count() > 500)
    {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "collection_item_text_too_long",
            "An item title can contain up to 160 characters and a note up to 500.",
        ));
    }

    match input.item_type.as_str() {
        "loop"
            if input.loop_id.is_some()
                && input.circle_id.is_none()
                && input.chain_id.is_none()
                && input.external_url.is_none() =>
        {
            Ok(ValidatedItem::Loop(
                input.loop_id.expect("validated Loop id"),
            ))
        }
        "circle"
            if input.circle_id.is_some()
                && input.loop_id.is_none()
                && input.chain_id.is_none()
                && input.external_url.is_none() =>
        {
            Ok(ValidatedItem::Circle(
                input.circle_id.expect("validated Circle id"),
            ))
        }
        "chain"
            if input.chain_id.is_some()
                && input.loop_id.is_none()
                && input.circle_id.is_none()
                && input.external_url.is_none() =>
        {
            Ok(ValidatedItem::Chain(
                input.chain_id.expect("validated Chain id"),
            ))
        }
        "external"
            if input.external_url.is_some()
                && input.loop_id.is_none()
                && input.circle_id.is_none()
                && input.chain_id.is_none() =>
        {
            let value = input.external_url.as_deref().unwrap_or_default().trim();
            let parsed = Url::parse(value).map_err(|_| {
                api_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_external_url",
                    "Provide a valid HTTPS URL.",
                )
            })?;
            if parsed.scheme() != "https"
                || parsed.host_str().is_none()
                || !parsed.username().is_empty()
                || parsed.password().is_some()
            {
                return Err(api_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_external_url",
                    "Only public HTTPS links are allowed.",
                ));
            }
            Ok(ValidatedItem::External(parsed.to_string()))
        }
        _ => Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_collection_item",
            "Provide exactly one supported target: a Loop, Circle or HTTPS link.",
        )),
    }
}

fn internal_db_error(error: sqlx::Error) -> ApiError {
    tracing::error!(%error, "failed to decode collection database record");
    api_error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "collection_record_invalid",
        "Could not read this collection.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_supported_collection_invitation_actions() {
        assert!(matches!(
            normalize_collection_invitation_action("accept"),
            Ok("accept")
        ));
        assert!(matches!(
            normalize_collection_invitation_action("decline"),
            Ok("decline")
        ));
        assert!(normalize_collection_invitation_action("approve").is_err());
        assert!(normalize_collection_invitation_action("delete").is_err());
    }

    #[test]
    fn normalizes_collection_collaborator_usernames_safely() {
        assert!(matches!(
            normalize_collection_member_username("  @Creator_01 "),
            Ok(username) if username == "creator_01"
        ));
        assert!(normalize_collection_member_username("").is_err());
        assert!(normalize_collection_member_username("bad username").is_err());
        assert!(normalize_collection_member_username("x".repeat(51).as_str()).is_err());
    }

    #[test]
    fn restricts_collection_collaborator_roles_to_editor_and_viewer() {
        assert!(matches!(
            normalize_collection_member_role(None),
            Ok("editor")
        ));
        assert!(matches!(
            normalize_collection_member_role(Some("viewer")),
            Ok("viewer")
        ));
        assert!(normalize_collection_member_role(Some("owner")).is_err());
        assert!(normalize_collection_member_role(Some("admin")).is_err());
    }

    #[test]
    fn accepts_a_loop_target_without_other_targets() {
        let id = Uuid::new_v4();
        let input = AddCollectionItemInput {
            item_type: "loop".to_owned(),
            loop_id: Some(id),
            circle_id: None,
            chain_id: None,
            external_url: None,
            title_override: None,
            note: None,
        };

        assert!(
            matches!(validate_item_input(&input), Ok(ValidatedItem::Loop(value)) if value == id)
        );
    }

    #[test]
    fn accepts_a_circle_target_without_other_targets() {
        let id = Uuid::new_v4();
        let input = AddCollectionItemInput {
            item_type: "circle".to_owned(),
            loop_id: None,
            circle_id: Some(id),
            chain_id: None,
            external_url: None,
            title_override: None,
            note: None,
        };

        assert!(
            matches!(validate_item_input(&input), Ok(ValidatedItem::Circle(value)) if value == id)
        );
    }

    #[test]
    fn accepts_a_chain_target_without_other_targets() {
        let id = Uuid::new_v4();
        let input = AddCollectionItemInput {
            item_type: "chain".to_owned(),
            loop_id: None,
            circle_id: None,
            chain_id: Some(id),
            external_url: None,
            title_override: None,
            note: None,
        };

        assert!(matches!(
            validate_item_input(&input),
            Ok(ValidatedItem::Chain(value)) if value == id
        ));
    }

    #[test]
    fn rejects_missing_or_ambiguous_targets() {
        let missing = AddCollectionItemInput {
            item_type: "loop".to_owned(),
            loop_id: None,
            circle_id: None,
            chain_id: None,
            external_url: None,
            title_override: None,
            note: None,
        };
        assert!(validate_item_input(&missing).is_err());

        let ambiguous = AddCollectionItemInput {
            item_type: "loop".to_owned(),
            loop_id: Some(Uuid::new_v4()),
            circle_id: Some(Uuid::new_v4()),
            chain_id: None,
            external_url: None,
            title_override: None,
            note: None,
        };
        assert!(validate_item_input(&ambiguous).is_err());
    }

    #[test]
    fn external_items_require_https_without_embedded_credentials() {
        let valid = AddCollectionItemInput {
            item_type: "external".to_owned(),
            loop_id: None,
            circle_id: None,
            chain_id: None,
            external_url: Some("https://example.com/reference".to_owned()),
            title_override: None,
            note: None,
        };
        assert!(
            matches!(validate_item_input(&valid), Ok(ValidatedItem::External(url)) if url == "https://example.com/reference")
        );

        let insecure = AddCollectionItemInput {
            external_url: Some("http://example.com".to_owned()),
            ..valid.clone()
        };
        assert!(validate_item_input(&insecure).is_err());

        let credentials = AddCollectionItemInput {
            external_url: Some("https://user:secret@example.com".to_owned()),
            ..valid
        };
        assert!(validate_item_input(&credentials).is_err());
    }

    #[test]
    fn rejects_oversized_item_metadata() {
        let input = AddCollectionItemInput {
            item_type: "external".to_owned(),
            loop_id: None,
            circle_id: None,
            chain_id: None,
            external_url: Some("https://example.com".to_owned()),
            title_override: Some("x".repeat(161)),
            note: None,
        };
        assert!(validate_item_input(&input).is_err());
    }
}
