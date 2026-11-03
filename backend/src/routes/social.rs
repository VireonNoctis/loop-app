use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
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

#[derive(Deserialize)]
pub struct FollowActionInput {
    action: String,
}

#[derive(Serialize)]
pub struct FollowStateResponse {
    is_following: bool,
    has_pending_follow_request: bool,
    is_private: bool,
    followers_count: i64,
    following_count: i64,
}

#[derive(Serialize)]
pub struct FollowActionResponse {
    success: bool,
    is_following: bool,
    requires_approval: bool,
    has_pending_follow_request: bool,
    followers_count: i64,
    following_count: i64,
}

#[derive(Deserialize)]
pub struct ListConnectionsQuery {
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Serialize)]
pub struct SocialPerson {
    id: Uuid,
    username: String,
    display_name: String,
    avatar_url: Option<String>,
    video_avatar_url: Option<String>,
    is_verified: bool,
    is_premium: bool,
    bio: Option<String>,
    followed_at: DateTime<Utc>,
    is_following: bool,
    is_self: bool,
}

#[derive(Serialize)]
pub struct FollowersListResponse {
    success: bool,
    followers: Vec<SocialPerson>,
    has_more: bool,
}

#[derive(Serialize)]
pub struct FollowingListResponse {
    success: bool,
    following: Vec<SocialPerson>,
    has_more: bool,
}

#[derive(Deserialize)]
pub struct ListChainContributionsQuery {
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Serialize)]
pub struct ProfileChainContribution {
    id: Uuid,
    chain_id: Uuid,
    chain_title: String,
    contribution_type: String,
    title: Option<String>,
    content_preview: String,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct ProfileChainContributionsResponse {
    success: bool,
    contributions: Vec<ProfileChainContribution>,
    has_more: bool,
}

/// Contributions displayed on a profile are filtered by profile privacy
/// and by the viewer's own access to each originating Chain.
pub async fn chain_contributions(
    State(state): State<AppState>,
    viewer: OptionalAuthenticatedUser,
    Path(target_id): Path<Uuid>,
    Query(query): Query<ListChainContributionsQuery>,
) -> Result<Json<ProfileChainContributionsResponse>, ApiError> {
    let viewer_id = viewer.0.as_ref().map(|user| user.id);
    check_social_list_access(&state, target_id, viewer_id).await?;

    let limit = query.limit.unwrap_or(12).clamp(1, 40);
    let offset = query.offset.unwrap_or(0).clamp(0, 10_000);
    let rows = sqlx::query(
        r#"
        SELECT
            contribution.id,
            contribution.chain_id,
            chain.title AS chain_title,
            contribution.contribution_type,
            contribution.title,
            LEFT(contribution.content, 280) AS content_preview,
            contribution.created_at
        FROM chain_contributions AS contribution
        JOIN chains AS chain ON chain.id = contribution.chain_id
        WHERE contribution.author_id = $1
          AND contribution.status = 'published'
          AND chain.status IN ('active', 'completed')
          AND (
              chain.visibility <> 'circle'
              OR (
                  $2::uuid IS NOT NULL
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
          AND (
              (chain.visibility = 'public' AND chain.circle_id IS NULL)
              OR (
                  $2::uuid IS NOT NULL
                  AND (
                      $2 = $1
                      OR chain.creator_id = $2
                      OR EXISTS (
                          SELECT 1 FROM chain_members AS member
                          WHERE member.chain_id = chain.id AND member.user_id = $2
                      )
                      OR (
                          chain.visibility = 'circle'
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
        ORDER BY contribution.created_at DESC, contribution.id DESC
        LIMIT $3 OFFSET $4
        "#,
    )
    .bind(target_id)
    .bind(viewer_id)
    .bind(limit + 1)
    .bind(offset)
    .fetch_all(&state.database)
    .await
    .map_err(db_error)?;

    let has_more = rows.len() > limit as usize;
    let contributions = rows
        .into_iter()
        .take(limit as usize)
        .map(|row| {
            Ok(ProfileChainContribution {
                id: row.try_get("id").map_err(db_error)?,
                chain_id: row.try_get("chain_id").map_err(db_error)?,
                chain_title: row.try_get("chain_title").map_err(db_error)?,
                contribution_type: row.try_get("contribution_type").map_err(db_error)?,
                title: row.try_get("title").map_err(db_error)?,
                content_preview: row.try_get("content_preview").map_err(db_error)?,
                created_at: row.try_get("created_at").map_err(db_error)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(ProfileChainContributionsResponse {
        success: true,
        contributions,
        has_more,
    }))
}

async fn check_social_list_access(
    state: &AppState,
    target_id: Uuid,
    viewer_id: Option<Uuid>,
) -> Result<(), ApiError> {
    let privacy: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT privacy_settings FROM profiles WHERE id = $1")
            .bind(target_id)
            .fetch_optional(&state.database)
            .await
            .map_err(db_error)?
            .ok_or_else(|| {
                api_error(
                    StatusCode::NOT_FOUND,
                    "user_not_found",
                    "This profile is unavailable.",
                )
            })?;

    let Some(viewer_id) = viewer_id else {
        let visibility = privacy
            .as_ref()
            .and_then(|value| value.get("profile_visibility"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("public");
        if matches!(visibility, "private" | "followers") {
            return Err(api_error(
                StatusCode::FORBIDDEN,
                "profile_private",
                "This profile's social lists are only visible to approved followers.",
            ));
        }
        return Ok(());
    };

    if viewer_id == target_id {
        return Ok(());
    }

    let blocked: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM user_blocks
            WHERE (blocker_id = $1 AND blocked_id = $2)
               OR (blocker_id = $2 AND blocked_id = $1)
        )
        "#,
    )
    .bind(viewer_id)
    .bind(target_id)
    .fetch_one(&state.database)
    .await
    .map_err(db_error)?;

    if blocked {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "profile_unavailable",
            "This profile is unavailable.",
        ));
    }

    let visibility = privacy
        .as_ref()
        .and_then(|value| value.get("profile_visibility"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("public");
    if matches!(visibility, "private" | "followers") {
        let follows: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2)",
        )
        .bind(viewer_id)
        .bind(target_id)
        .fetch_one(&state.database)
        .await
        .map_err(db_error)?;

        if !follows {
            return Err(api_error(
                StatusCode::FORBIDDEN,
                "profile_private",
                "This profile's social lists are only visible to approved followers.",
            ));
        }
    }

    Ok(())
}

pub async fn followers(
    State(state): State<AppState>,
    viewer: OptionalAuthenticatedUser,
    Path(target_id): Path<Uuid>,
    Query(query): Query<ListConnectionsQuery>,
) -> Result<Json<FollowersListResponse>, ApiError> {
    let viewer_id = viewer.0.as_ref().map(|user| user.id);
    check_social_list_access(&state, target_id, viewer_id).await?;

    let limit = query.limit.unwrap_or(20).clamp(1, 50);
    let offset = query.offset.unwrap_or(0).max(0);
    let rows = sqlx::query(
        r#"
        SELECT
            person.id,
            person.username,
            person.display_name,
            person.avatar_url,
            person.video_avatar_url,
            person.is_verified,
            person.is_premium,
            person.bio,
            relationship.created_at AS followed_at,
            COALESCE($1::uuid = person.id, false) AS is_self,
            CASE
                WHEN $1::uuid IS NULL THEN false
                ELSE EXISTS (
                    SELECT 1 FROM follows AS viewer_follow
                    WHERE viewer_follow.follower_id = $1
                      AND viewer_follow.following_id = person.id
                )
            END AS is_following
        FROM follows AS relationship
        JOIN profiles AS person ON person.id = relationship.follower_id
        WHERE relationship.following_id = $2
          AND (
              $1::uuid IS NULL
              OR NOT EXISTS (
                  SELECT 1 FROM user_blocks AS block
                  WHERE (block.blocker_id = $1 AND block.blocked_id = person.id)
                     OR (block.blocker_id = person.id AND block.blocked_id = $1)
              )
          )
        ORDER BY relationship.created_at DESC, relationship.id DESC
        LIMIT $3 OFFSET $4
        "#,
    )
    .bind(viewer_id)
    .bind(target_id)
    .bind(limit + 1)
    .bind(offset)
    .fetch_all(&state.database)
    .await
    .map_err(db_error)?;

    let has_more = rows.len() > limit as usize;
    let followers = rows
        .into_iter()
        .take(limit as usize)
        .map(|row| {
            Ok(SocialPerson {
                id: row.try_get("id").map_err(db_error)?,
                username: row.try_get("username").map_err(db_error)?,
                display_name: row.try_get("display_name").map_err(db_error)?,
                avatar_url: row.try_get("avatar_url").map_err(db_error)?,
                video_avatar_url: row.try_get("video_avatar_url").map_err(db_error)?,
                is_verified: row.try_get("is_verified").map_err(db_error)?,
                is_premium: row.try_get("is_premium").map_err(db_error)?,
                bio: row.try_get("bio").map_err(db_error)?,
                followed_at: row.try_get("followed_at").map_err(db_error)?,
                is_following: row.try_get("is_following").map_err(db_error)?,
                is_self: row.try_get("is_self").map_err(db_error)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(FollowersListResponse {
        success: true,
        followers,
        has_more,
    }))
}

pub async fn following(
    State(state): State<AppState>,
    viewer: OptionalAuthenticatedUser,
    Path(target_id): Path<Uuid>,
    Query(query): Query<ListConnectionsQuery>,
) -> Result<Json<FollowingListResponse>, ApiError> {
    let viewer_id = viewer.0.as_ref().map(|user| user.id);
    check_social_list_access(&state, target_id, viewer_id).await?;

    let limit = query.limit.unwrap_or(20).clamp(1, 50);
    let offset = query.offset.unwrap_or(0).max(0);
    let rows = sqlx::query(
        r#"
        SELECT
            person.id,
            person.username,
            person.display_name,
            person.avatar_url,
            person.video_avatar_url,
            person.is_verified,
            person.is_premium,
            person.bio,
            relationship.created_at AS followed_at,
            COALESCE($1::uuid = person.id, false) AS is_self,
            CASE
                WHEN $1::uuid IS NULL THEN false
                ELSE EXISTS (
                    SELECT 1 FROM follows AS viewer_follow
                    WHERE viewer_follow.follower_id = $1
                      AND viewer_follow.following_id = person.id
                )
            END AS is_following
        FROM follows AS relationship
        JOIN profiles AS person ON person.id = relationship.following_id
        WHERE relationship.follower_id = $2
          AND (
              $1::uuid IS NULL
              OR NOT EXISTS (
                  SELECT 1 FROM user_blocks AS block
                  WHERE (block.blocker_id = $1 AND block.blocked_id = person.id)
                     OR (block.blocker_id = person.id AND block.blocked_id = $1)
              )
          )
        ORDER BY relationship.created_at DESC, relationship.id DESC
        LIMIT $3 OFFSET $4
        "#,
    )
    .bind(viewer_id)
    .bind(target_id)
    .bind(limit + 1)
    .bind(offset)
    .fetch_all(&state.database)
    .await
    .map_err(db_error)?;

    let has_more = rows.len() > limit as usize;
    let following = rows
        .into_iter()
        .take(limit as usize)
        .map(|row| {
            Ok(SocialPerson {
                id: row.try_get("id").map_err(db_error)?,
                username: row.try_get("username").map_err(db_error)?,
                display_name: row.try_get("display_name").map_err(db_error)?,
                avatar_url: row.try_get("avatar_url").map_err(db_error)?,
                video_avatar_url: row.try_get("video_avatar_url").map_err(db_error)?,
                is_verified: row.try_get("is_verified").map_err(db_error)?,
                is_premium: row.try_get("is_premium").map_err(db_error)?,
                bio: row.try_get("bio").map_err(db_error)?,
                followed_at: row.try_get("followed_at").map_err(db_error)?,
                is_following: row.try_get("is_following").map_err(db_error)?,
                is_self: row.try_get("is_self").map_err(db_error)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(FollowingListResponse {
        success: true,
        following,
        has_more,
    }))
}

pub async fn follow_state(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(target_id): Path<Uuid>,
) -> Result<Json<FollowStateResponse>, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT
            profile.privacy_settings,
            profile.followers_count,
            profile.following_count,
            EXISTS (
                SELECT 1 FROM follows
                WHERE follower_id = $1 AND following_id = profile.id
            ) AS is_following,
            EXISTS (
                SELECT 1 FROM follow_requests
                WHERE requester_id = $1
                  AND target_id = profile.id
                  AND status = 'pending'
            ) AS has_pending_follow_request
        FROM profiles AS profile
        WHERE profile.id = $2
        "#,
    )
    .bind(user.id)
    .bind(target_id)
    .fetch_optional(&state.database)
    .await
    .map_err(|error| {
        tracing::error!(%error, "failed to load follow state");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "follow_state_failed",
            "Could not load follow state.",
        )
    })?;

    let Some(row) = row else {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "user_not_found",
            "This profile is unavailable.",
        ));
    };

    let privacy: Option<serde_json::Value> = row.try_get("privacy_settings").map_err(db_error)?;
    let visibility = privacy
        .as_ref()
        .and_then(|value| value.get("profile_visibility"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("public");

    Ok(Json(FollowStateResponse {
        is_following: row.try_get("is_following").map_err(db_error)?,
        has_pending_follow_request: row
            .try_get("has_pending_follow_request")
            .map_err(db_error)?,
        is_private: matches!(visibility, "private" | "followers"),
        followers_count: row.try_get("followers_count").map_err(db_error)?,
        following_count: row.try_get("following_count").map_err(db_error)?,
    }))
}

pub async fn follow(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(target_id): Path<Uuid>,
    Json(input): Json<FollowActionInput>,
) -> Result<Json<FollowActionResponse>, ApiError> {
    if target_id == user.id {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "cannot_follow_self",
            "You cannot follow yourself.",
        ));
    }

    if !matches!(input.action.as_str(), "follow" | "unfollow") {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_follow_action",
            "Action must be follow or unfollow.",
        ));
    }

    let mut transaction = state.database.begin().await.map_err(|error| {
        tracing::error!(%error, "could not begin follow transaction");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "follow_transaction_failed",
            "Could not update this follow.",
        )
    })?;

    let target = sqlx::query(
        r#"
        SELECT privacy_settings
        FROM profiles
        WHERE id = $1
        FOR UPDATE
        "#,
    )
    .bind(target_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| {
        tracing::error!(%error, "could not load follow target");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "follow_target_failed",
            "Could not load this profile.",
        )
    })?;

    let Some(target) = target else {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "user_not_found",
            "This profile is unavailable.",
        ));
    };

    let privacy: Option<serde_json::Value> =
        target.try_get("privacy_settings").map_err(db_error)?;
    let visibility = privacy
        .as_ref()
        .and_then(|value| value.get("profile_visibility"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("public");
    let is_private = matches!(visibility, "private" | "followers");

    let is_blocked: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM user_blocks
            WHERE (blocker_id = $1 AND blocked_id = $2)
               OR (blocker_id = $2 AND blocked_id = $1)
        )
        "#,
    )
    .bind(user.id)
    .bind(target_id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| {
        tracing::error!(%error, "could not check block relationship");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "block_check_failed",
            "Could not verify this relationship.",
        )
    })?;

    if is_blocked {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "relationship_blocked",
            "You cannot follow this user.",
        ));
    }

    if input.action == "unfollow" {
        let removed = sqlx::query_scalar::<_, Uuid>(
            "DELETE FROM follows WHERE follower_id = $1 AND following_id = $2 RETURNING id",
        )
        .bind(user.id)
        .bind(target_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| {
            tracing::error!(%error, "could not remove follow");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "unfollow_failed",
                "Could not unfollow this user.",
            )
        })?;

        if removed.is_some() {
            sqlx::query(
                "UPDATE profiles SET followers_count = GREATEST(0, followers_count - 1), updated_at = NOW() WHERE id = $1",
            )
            .bind(target_id)
            .execute(&mut *transaction)
            .await
            .map_err(db_error)?;

            sqlx::query(
                "UPDATE profiles SET following_count = GREATEST(0, following_count - 1), updated_at = NOW() WHERE id = $1",
            )
            .bind(user.id)
            .execute(&mut *transaction)
            .await
            .map_err(db_error)?;
        }

        // Recompute from the relationship table so duplicate retries and
        // historical counter drift cannot compound incorrect values.
        let (followers_count, following_count) =
            load_follow_counts(&mut transaction, user.id, target_id).await?;

        sqlx::query(
            r#"
            DELETE FROM follow_requests
            WHERE requester_id = $1 AND target_id = $2 AND status = 'pending'
            "#,
        )
        .bind(user.id)
        .bind(target_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            tracing::error!(%error, "could not clear pending follow request");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "follow_request_clear_failed",
                "Could not update the follow request.",
            )
        })?;

        transaction.commit().await.map_err(|error| {
            tracing::error!(%error, "could not commit unfollow");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "unfollow_commit_failed",
                "Could not save this change.",
            )
        })?;

        return Ok(Json(FollowActionResponse {
            success: true,
            is_following: false,
            requires_approval: false,
            has_pending_follow_request: false,
            followers_count,
            following_count,
        }));
    }

    let already_following: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2)",
    )
    .bind(user.id)
    .bind(target_id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(db_error)?;

    if already_following {
        let (followers_count, following_count) =
            load_follow_counts(&mut transaction, user.id, target_id).await?;
        transaction.commit().await.map_err(|error| {
            tracing::error!(%error, "could not commit idempotent follow");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "follow_commit_failed",
                "Could not save this change.",
            )
        })?;
        return Ok(Json(FollowActionResponse {
            success: true,
            is_following: true,
            requires_approval: false,
            has_pending_follow_request: false,
            followers_count,
            following_count,
        }));
    }

    if is_private {
        let requests_disabled = privacy.as_ref().is_some_and(|value| {
            value.get("allow_friend_requests") == Some(&serde_json::Value::Bool(false))
        });

        if requests_disabled {
            return Err(api_error(
                StatusCode::FORBIDDEN,
                "follow_requests_disabled",
                "This user is not accepting follow requests right now.",
            ));
        }

        let status: Option<String> = sqlx::query_scalar(
            "SELECT status FROM follow_requests WHERE requester_id = $1 AND target_id = $2",
        )
        .bind(user.id)
        .bind(target_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(db_error)?;

        if status.as_deref() == Some("pending") {
            let (followers_count, following_count) =
                load_follow_counts(&mut transaction, user.id, target_id).await?;
            transaction.commit().await.map_err(|_error| {
                api_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "follow_commit_failed",
                    "Could not save this change.",
                )
            })?;
            return Ok(Json(FollowActionResponse {
                success: true,
                is_following: false,
                requires_approval: true,
                has_pending_follow_request: true,
                followers_count,
                following_count,
            }));
        }

        let request_result = sqlx::query(
            r#"
            INSERT INTO follow_requests (requester_id, target_id, status)
            VALUES ($1, $2, 'pending')
            ON CONFLICT (requester_id, target_id)
            DO UPDATE SET status = 'pending', updated_at = NOW()
            WHERE follow_requests.status <> 'pending'
            "#,
        )
        .bind(user.id)
        .bind(target_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            tracing::error!(%error, "could not create follow request");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "follow_request_failed",
                "Could not send this follow request.",
            )
        })?;

        if request_result.rows_affected() > 0 {
            insert_notification(
                &mut transaction,
                NotificationDraft {
                    recipient_id: target_id,
                    actor_id: user.id,
                    notification_type: "follow_request",
                    title: "New follow request",
                    message: &format!("{} requested to follow you", user.display_name),
                    data: serde_json::json!({
                        "requester_id": user.id,
                        "username": user.username,
                    }),
                    action_url: Some(&format!("/profile/{}", user.username)),
                },
            )
            .await?;
        }

        let (followers_count, following_count) =
            load_follow_counts(&mut transaction, user.id, target_id).await?;
        transaction.commit().await.map_err(|error| {
            tracing::error!(%error, "could not commit follow request");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "follow_request_commit_failed",
                "Could not save this request.",
            )
        })?;

        return Ok(Json(FollowActionResponse {
            success: true,
            is_following: false,
            requires_approval: true,
            has_pending_follow_request: true,
            followers_count,
            following_count,
        }));
    }

    // A public profile can be followed immediately. The unique relationship
    // constraint makes retries safe and the counters update only on insert.
    let inserted = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO follows (follower_id, following_id)
        VALUES ($1, $2)
        ON CONFLICT (follower_id, following_id) DO NOTHING
        RETURNING id
        "#,
    )
    .bind(user.id)
    .bind(target_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| {
        tracing::error!(%error, "could not create follow");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "follow_create_failed",
            "Could not follow this user.",
        )
    })?;

    if inserted.is_some() {
        sqlx::query(
            "UPDATE profiles SET followers_count = followers_count + 1, updated_at = NOW() WHERE id = $1",
        )
        .bind(target_id)
        .execute(&mut *transaction)
        .await
        .map_err(db_error)?;

        sqlx::query(
            "UPDATE profiles SET following_count = following_count + 1, updated_at = NOW() WHERE id = $1",
        )
        .bind(user.id)
        .execute(&mut *transaction)
        .await
        .map_err(db_error)?;

        insert_notification(
            &mut transaction,
            NotificationDraft {
                recipient_id: target_id,
                actor_id: user.id,
                notification_type: "follow",
                title: "New follower",
                message: &format!("{} started following you", user.display_name),
                data: serde_json::json!({
                    "follower_id": user.id,
                    "username": user.username,
                }),
                action_url: Some(&format!("/profile/{}", user.username)),
            },
        )
        .await?;
    }

    sqlx::query(
        r#"
        UPDATE follow_requests
        SET status = 'approved', updated_at = NOW()
        WHERE requester_id = $1 AND target_id = $2 AND status = 'pending'
        "#,
    )
    .bind(user.id)
    .bind(target_id)
    .execute(&mut *transaction)
    .await
    .map_err(db_error)?;

    let (followers_count, following_count) =
        load_follow_counts(&mut transaction, user.id, target_id).await?;
    transaction.commit().await.map_err(|error| {
        tracing::error!(%error, "could not commit follow");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "follow_commit_failed",
            "Could not save this change.",
        )
    })?;

    Ok(Json(FollowActionResponse {
        success: true,
        is_following: true,
        requires_approval: false,
        has_pending_follow_request: false,
        followers_count,
        following_count,
    }))
}

pub async fn withdraw_follow_request(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(target_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let result = sqlx::query(
        r#"
        DELETE FROM follow_requests
        WHERE requester_id = $1 AND target_id = $2 AND status = 'pending'
        "#,
    )
    .bind(user.id)
    .bind(target_id)
    .execute(&state.database)
    .await
    .map_err(|error| {
        tracing::error!(%error, "could not withdraw follow request");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "follow_request_withdraw_failed",
            "Could not withdraw this request.",
        )
    })?;

    if result.rows_affected() == 0 {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "follow_request_not_found",
            "There is no pending request to withdraw.",
        ));
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn load_follow_counts(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    target_id: Uuid,
) -> Result<(i64, i64), ApiError> {
    let row = sqlx::query(
        r#"
        SELECT
            (SELECT followers_count FROM profiles WHERE id = $1) AS followers_count,
            (SELECT following_count FROM profiles WHERE id = $2) AS following_count
        "#,
    )
    .bind(target_id)
    .bind(user_id)
    .fetch_one(&mut **transaction)
    .await
    .map_err(db_error)?;

    Ok((
        row.try_get("followers_count").map_err(db_error)?,
        row.try_get("following_count").map_err(db_error)?,
    ))
}

struct NotificationDraft<'a> {
    recipient_id: Uuid,
    actor_id: Uuid,
    notification_type: &'a str,
    title: &'a str,
    message: &'a str,
    data: serde_json::Value,
    action_url: Option<&'a str>,
}

async fn insert_notification(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    draft: NotificationDraft<'_>,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO notifications (user_id, actor_id, type, title, message, data, action_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(draft.recipient_id)
    .bind(draft.actor_id)
    .bind(draft.notification_type)
    .bind(draft.title)
    .bind(draft.message)
    .bind(draft.data)
    .bind(draft.action_url)
    .execute(&mut **transaction)
    .await
    .map_err(|error| {
        tracing::error!(%error, "could not insert social notification");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "notification_insert_failed",
            "Could not create the notification.",
        )
    })?;

    Ok(())
}

fn db_error(error: sqlx::Error) -> ApiError {
    tracing::error!(%error, "social graph database operation failed");
    api_error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "social_graph_database_error",
        "Could not complete this social action.",
    )
}
