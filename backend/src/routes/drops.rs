use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row, postgres::PgRow};
use uuid::Uuid;

use crate::{auth::AuthenticatedUser, state::AppState};

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
pub struct ListDropsQuery {
    limit: Option<i64>,
    offset: Option<i64>,
    kind: Option<String>,
    category: Option<String>,
    search: Option<String>,
    live: Option<bool>,
    upcoming: Option<bool>,
    sort: Option<String>,
}

#[derive(Clone, Copy)]
struct DropFilters<'a> {
    search: Option<&'a str>,
    category: Option<&'a str>,
    live: bool,
    upcoming: bool,
    sort: &'a str,
}

#[derive(Serialize)]
pub struct DropItem {
    id: String,
    kind: &'static str,
    source: &'static str,
    title: String,
    description: String,
    category: String,
    starts_at: Option<DateTime<Utc>>,
    ends_at: Option<DateTime<Utc>>,
    status: &'static str,
    is_live: bool,
    image_url: Option<String>,
    participants_count: i64,
    reward_coins: i64,
    circle_id: Option<String>,
    circle_name: Option<String>,
    action_url: String,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct DropsResponse {
    success: bool,
    items: Vec<DropItem>,
    total: usize,
    limit: i64,
    offset: i64,
    has_more: bool,
    live_count: usize,
    challenge_count: usize,
    event_count: usize,
}

pub async fn list(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Query(query): Query<ListDropsQuery>,
) -> Result<Json<DropsResponse>, ApiError> {
    let limit = query.limit.unwrap_or(30).clamp(1, 75);
    let offset = query.offset.unwrap_or(0).clamp(0, 1_000);
    let search_filter = query
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let kind_filter = query
        .kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let category_filter = query
        .category
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if search_filter.is_some_and(|value| value.chars().count() > 120) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "drops_search_too_long",
            "Search terms are limited to 120 characters.",
        ));
    }
    if query.live.unwrap_or(false) && query.upcoming.unwrap_or(false) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "conflicting_drop_filters",
            "Choose either live or upcoming activity, not both.",
        ));
    }
    let sort = query.sort.as_deref().unwrap_or("recommended").trim();
    if !matches!(sort, "recommended" | "upcoming" | "popular" | "recent") {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "invalid_drop_sort",
            "Sort must be recommended, upcoming, popular or recent.",
        ));
    }

    if let Some(kind) = kind_filter
        && !matches!(kind, "event" | "challenge")
    {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "invalid_drop_kind",
            "Kind must be event or challenge.",
        ));
    }

    let search_pattern = search_filter.map(|value| format!("%{}%", value));
    let filters = DropFilters {
        search: search_pattern.as_deref(),
        category: category_filter.filter(|value| !value.eq_ignore_ascii_case("all")),
        live: query.live.unwrap_or(false),
        upcoming: query.upcoming.unwrap_or(false),
        sort,
    };

    let circle_ids = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT circle.id
        FROM circles AS circle
        WHERE circle.is_private IS FALSE
           OR circle.owner_id = $1
           OR EXISTS (
               SELECT 1
               FROM circle_members AS member
               WHERE member.circle_id = circle.id
                 AND member.user_id = $1
                 AND member.status IN ('active', 'approved')
           )
        "#,
    )
    .bind(user.id)
    .fetch_all(&state.database)
    .await
    .map_err(|error| {
        tracing::error!(%error, "failed to load joined Circles for Drops");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "drops_membership_failed",
            "Could not load your Circle activity.",
        )
    })?;

    let mut items = Vec::new();
    // Fetch the first offset + page + one row from every source. Each source
    // uses the same ordering and filters, so the merged page stays correct.
    let per_source_limit = offset + limit + 1;

    if kind_filter != Some("challenge") {
        append_rows(
            &mut items,
            load_global_events(&state.database, per_source_limit, filters).await?,
            "event",
            "official_event",
        )?;
        append_rows(
            &mut items,
            load_hosted_events(&state.database, user.id, per_source_limit, filters).await?,
            "event",
            "hosted_event",
        )?;
    }

    if !circle_ids.is_empty() {
        if kind_filter != Some("challenge") {
            append_rows(
                &mut items,
                load_circle_events(&state.database, &circle_ids, per_source_limit, filters).await?,
                "event",
                "circle_event",
            )?;
        }
        if kind_filter != Some("event") {
            append_rows(
                &mut items,
                load_circle_challenges(&state.database, &circle_ids, per_source_limit, filters)
                    .await?,
                "challenge",
                "circle_challenge",
            )?;
        }
    }

    if let Some(category) = category_filter {
        let normalized = category.trim().to_lowercase();
        if normalized != "all" {
            items.retain(|item| item.category.to_lowercase() == normalized);
        }
    }

    if query.live.unwrap_or(false) {
        items.retain(|item| item.is_live);
    }
    if query.upcoming.unwrap_or(false) {
        items.retain(|item| item.status == "upcoming" && !item.is_live);
    }

    if let Some(search) = search_filter {
        let needle = search.to_lowercase();
        items.retain(|item| {
            item.title.to_lowercase().contains(&needle)
                || item.description.to_lowercase().contains(&needle)
                || item.category.to_lowercase().contains(&needle)
                || item
                    .circle_name
                    .as_deref()
                    .is_some_and(|name| name.to_lowercase().contains(&needle))
                || item.source.to_lowercase().contains(&needle)
        });
    }

    items.sort_by(|left, right| match sort {
        "recent" => right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.id.cmp(&left.id)),
        "popular" => right
            .participants_count
            .cmp(&left.participants_count)
            .then_with(|| right.created_at.cmp(&left.created_at))
            .then_with(|| right.id.cmp(&left.id)),
        "upcoming" => right
            .is_live
            .cmp(&left.is_live)
            .then_with(|| left.starts_at.is_none().cmp(&right.starts_at.is_none()))
            .then_with(|| left.starts_at.cmp(&right.starts_at))
            .then_with(|| right.created_at.cmp(&left.created_at))
            .then_with(|| right.id.cmp(&left.id)),
        _ => right
            .is_live
            .cmp(&left.is_live)
            .then_with(|| left.starts_at.is_none().cmp(&right.starts_at.is_none()))
            .then_with(|| left.starts_at.cmp(&right.starts_at))
            .then_with(|| right.created_at.cmp(&left.created_at))
            .then_with(|| right.id.cmp(&left.id)),
    });

    let total = items.len();
    let has_more = total > (offset + limit) as usize;
    let live_count = items.iter().filter(|item| item.is_live).count();
    let challenge_count = items.iter().filter(|item| item.kind == "challenge").count();
    let event_count = items.len().saturating_sub(challenge_count);
    let items = items
        .into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .collect();

    Ok(Json(DropsResponse {
        success: true,
        items,
        total,
        limit,
        offset,
        has_more,
        live_count,
        challenge_count,
        event_count,
    }))
}

async fn load_global_events(
    pool: &PgPool,
    limit: i64,
    filters: DropFilters<'_>,
) -> Result<Vec<PgRow>, ApiError> {
    sqlx::query(
        r#"
        SELECT
            id::text AS id,
            title,
            COALESCE(description, '') AS description,
            COALESCE(category, 'Community') AS category,
            starts_at,
            ends_at,
            status,
            is_live,
            banner_url AS image_url,
            COALESCE(rsvp_count, 0)::bigint AS participants_count,
            COALESCE(reward_coins, 0)::bigint AS reward_coins,
            NULL::text AS circle_id,
            NULL::text AS circle_name,
            created_at
        FROM global_events
        WHERE is_active = true
          AND COALESCE(status, 'upcoming') <> 'ended'
          AND (is_live = true OR ends_at IS NULL OR ends_at >= NOW())
          AND ($2::text IS NULL OR title ILIKE $2 OR COALESCE(description, '') ILIKE $2 OR COALESCE(category, 'Community') ILIKE $2)
          AND ($3::text IS NULL OR LOWER(COALESCE(category, 'Community')) = LOWER($3))
          AND (NOT $4::boolean OR is_live = true OR (starts_at <= NOW() AND (ends_at IS NULL OR ends_at >= NOW())))
          AND (NOT $5::boolean OR (NOT (is_live = true OR (starts_at <= NOW() AND (ends_at IS NULL OR ends_at >= NOW()))) AND (starts_at IS NULL OR starts_at > NOW())))
        ORDER BY
            CASE WHEN $6 = 'recent' THEN created_at END DESC NULLS LAST,
            CASE WHEN $6 = 'popular' THEN COALESCE(rsvp_count, 0) END DESC NULLS LAST,
            CASE WHEN $6 IN ('recommended', 'upcoming') THEN (is_live = true OR (starts_at <= NOW() AND (ends_at IS NULL OR ends_at >= NOW())))::int END DESC NULLS LAST,
            CASE WHEN $6 IN ('recommended', 'upcoming') THEN starts_at END ASC NULLS LAST,
            created_at DESC, id DESC
        LIMIT $1
        "#,
    )
    .bind(limit)
    .bind(filters.search)
    .bind(filters.category)
    .bind(filters.live)
    .bind(filters.upcoming)
    .bind(filters.sort)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(%error, "failed to load official Drops");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "drops_global_events_failed",
            "Could not load official events.",
        )
    })
}

async fn load_hosted_events(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
    filters: DropFilters<'_>,
) -> Result<Vec<PgRow>, ApiError> {
    sqlx::query(
        r#"
        SELECT
            event.id::text AS id,
            event.title,
            COALESCE(event.description, '') AS description,
            COALESCE(event.category, 'General') AS category,
            event.start_time AS starts_at,
            event.end_time AS ends_at,
            COALESCE(event.status, 'upcoming') AS status,
            COALESCE(event.is_live, false) AS is_live,
            event.cover_image AS image_url,
            COALESCE(event.participants_count, 0)::bigint AS participants_count,
            0::bigint AS reward_coins,
            event.circle_id::text AS circle_id,
            circle.name AS circle_name,
            event.created_at
        FROM events AS event
        LEFT JOIN circles AS circle ON circle.id = event.circle_id
        WHERE COALESCE(event.status, 'upcoming') <> 'ended'
          AND (
            event.circle_id IS NULL
            OR EXISTS (
              SELECT 1
              FROM circles AS circle
              WHERE circle.id = event.circle_id
                AND (
                  circle.is_private IS FALSE
                  OR circle.owner_id = $1
                  OR EXISTS (
                    SELECT 1
                    FROM circle_members AS member
                    WHERE member.circle_id = circle.id
                      AND member.user_id = $1
                      AND member.status IN ('active', 'approved')
                  )
                )
            )
          )
          AND (event.is_live = true OR event.end_time IS NULL OR event.end_time >= NOW())
          AND ($3::text IS NULL OR event.title ILIKE $3 OR COALESCE(event.description, '') ILIKE $3 OR COALESCE(event.category, 'General') ILIKE $3 OR COALESCE(circle.name, '') ILIKE $3)
          AND ($4::text IS NULL OR LOWER(COALESCE(event.category, 'General')) = LOWER($4))
          AND (NOT $5::boolean OR event.is_live = true OR (event.start_time <= NOW() AND (event.end_time IS NULL OR event.end_time >= NOW())))
          AND (NOT $6::boolean OR (NOT (event.is_live = true OR (event.start_time <= NOW() AND (event.end_time IS NULL OR event.end_time >= NOW()))) AND (event.start_time IS NULL OR event.start_time > NOW())))
        ORDER BY
            CASE WHEN $7 = 'recent' THEN event.created_at END DESC NULLS LAST,
            CASE WHEN $7 = 'popular' THEN COALESCE(event.participants_count, 0) END DESC NULLS LAST,
            CASE WHEN $7 IN ('recommended', 'upcoming') THEN (event.is_live = true OR (event.start_time <= NOW() AND (event.end_time IS NULL OR event.end_time >= NOW())))::int END DESC NULLS LAST,
            CASE WHEN $7 IN ('recommended', 'upcoming') THEN event.start_time END ASC NULLS LAST,
            event.created_at DESC, event.id DESC
        LIMIT $2
        "#,
    )
    .bind(user_id)
    .bind(limit)
    .bind(filters.search)
    .bind(filters.category)
    .bind(filters.live)
    .bind(filters.upcoming)
    .bind(filters.sort)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(%error, "failed to load hosted Drops");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "drops_hosted_events_failed",
            "Could not load hosted events.",
        )
    })
}

async fn load_circle_events(
    pool: &PgPool,
    circle_ids: &[Uuid],
    limit: i64,
    filters: DropFilters<'_>,
) -> Result<Vec<PgRow>, ApiError> {
    sqlx::query(
        r#"
        SELECT
            event.id::text AS id,
            event.title,
            COALESCE(event.description, '') AS description,
            COALESCE(event.event_type, 'Circle event') AS category,
            event.starts_at,
            event.ends_at,
            CASE
                WHEN event.starts_at <= NOW()
                 AND (event.ends_at IS NULL OR event.ends_at >= NOW()) THEN 'live'
                ELSE 'upcoming'
            END AS status,
            (
                event.starts_at <= NOW()
                AND (event.ends_at IS NULL OR event.ends_at >= NOW())
            ) AS is_live,
            NULL::text AS image_url,
            COALESCE(event.participant_count, 0)::bigint AS participants_count,
            0::bigint AS reward_coins,
            event.circle_id::text AS circle_id,
            circle.name AS circle_name,
            event.created_at
        FROM circle_events AS event
        JOIN circles AS circle ON circle.id = event.circle_id
        WHERE event.circle_id = ANY($1)
          AND (event.ends_at IS NULL OR event.ends_at >= NOW())
          AND ($3::text IS NULL OR event.title ILIKE $3 OR COALESCE(event.description, '') ILIKE $3 OR COALESCE(event.event_type, 'Circle event') ILIKE $3 OR circle.name ILIKE $3)
          AND ($4::text IS NULL OR LOWER(COALESCE(event.event_type, 'Circle event')) = LOWER($4))
          AND (NOT $5::boolean OR (event.starts_at <= NOW() AND (event.ends_at IS NULL OR event.ends_at >= NOW())))
          AND (NOT $6::boolean OR (event.starts_at IS NULL OR event.starts_at > NOW()))
        ORDER BY
            CASE WHEN $7 = 'recent' THEN event.created_at END DESC NULLS LAST,
            CASE WHEN $7 = 'popular' THEN COALESCE(event.participant_count, 0) END DESC NULLS LAST,
            CASE WHEN $7 IN ('recommended', 'upcoming') THEN (event.starts_at <= NOW() AND (event.ends_at IS NULL OR event.ends_at >= NOW()))::int END DESC NULLS LAST,
            CASE WHEN $7 IN ('recommended', 'upcoming') THEN event.starts_at END ASC NULLS LAST,
            event.created_at DESC, event.id DESC
        LIMIT $2
        "#,
    )
    .bind(circle_ids)
    .bind(limit)
    .bind(filters.search)
    .bind(filters.category)
    .bind(filters.live)
    .bind(filters.upcoming)
    .bind(filters.sort)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(%error, "failed to load Circle event Drops");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "drops_circle_events_failed",
            "Could not load Circle events.",
        )
    })
}

async fn load_circle_challenges(
    pool: &PgPool,
    circle_ids: &[Uuid],
    limit: i64,
    filters: DropFilters<'_>,
) -> Result<Vec<PgRow>, ApiError> {
    sqlx::query(
        r#"
        SELECT
            challenge.id::text AS id,
            challenge.title,
            COALESCE(challenge.description, '') AS description,
            COALESCE(challenge.challenge_type, 'Creative') AS category,
            challenge.starts_at,
            challenge.ends_at,
            challenge.status,
            false AS is_live,
            NULL::text AS image_url,
            (
                SELECT COUNT(*)::bigint
                FROM community_challenge_entries AS entry
                WHERE entry.challenge_id = challenge.id
            ) AS participants_count,
            COALESCE(challenge.reward_coins, 0)::bigint AS reward_coins,
            challenge.circle_id::text AS circle_id,
            circle.name AS circle_name,
            challenge.created_at
        FROM circle_challenges AS challenge
        JOIN circles AS circle ON circle.id = challenge.circle_id
        WHERE challenge.circle_id = ANY($1)
          AND challenge.status = 'active'
          AND (challenge.ends_at IS NULL OR challenge.ends_at >= NOW())
          AND ($3::text IS NULL OR challenge.title ILIKE $3 OR COALESCE(challenge.description, '') ILIKE $3 OR COALESCE(challenge.challenge_type, 'Creative') ILIKE $3 OR circle.name ILIKE $3)
          AND ($4::text IS NULL OR LOWER(COALESCE(challenge.challenge_type, 'Creative')) = LOWER($4))
          AND NOT $5::boolean
          AND (NOT $6::boolean OR challenge.starts_at > NOW())
        ORDER BY
            CASE WHEN $7 = 'recent' THEN challenge.created_at END DESC NULLS LAST,
            CASE WHEN $7 = 'popular' THEN (
                SELECT COUNT(*) FROM community_challenge_entries AS entry
                WHERE entry.challenge_id = challenge.id
            ) END DESC NULLS LAST,
            CASE WHEN $7 IN ('recommended', 'upcoming') THEN challenge.starts_at END ASC NULLS LAST,
            challenge.created_at DESC, challenge.id DESC
        LIMIT $2
        "#,
    )
    .bind(circle_ids)
    .bind(limit)
    .bind(filters.search)
    .bind(filters.category)
    .bind(filters.live)
    .bind(filters.upcoming)
    .bind(filters.sort)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(%error, "failed to load Circle challenge Drops");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "drops_circle_challenges_failed",
            "Could not load Circle challenges.",
        )
    })
}

fn append_rows(
    items: &mut Vec<DropItem>,
    rows: Vec<PgRow>,
    kind: &'static str,
    source: &'static str,
) -> Result<(), ApiError> {
    for row in rows {
        let id: String = row.try_get("id").map_err(db_error)?;
        let circle_id: Option<String> = row.try_get("circle_id").map_err(db_error)?;
        let starts_at: Option<DateTime<Utc>> = row.try_get("starts_at").map_err(db_error)?;
        let ends_at: Option<DateTime<Utc>> = row.try_get("ends_at").map_err(db_error)?;
        let is_live: bool = row.try_get("is_live").map_err(db_error)?;
        let status: String = row.try_get("status").map_err(db_error)?;
        let action_url = match (source, circle_id.as_deref()) {
            ("circle_challenge", Some(circle_id)) => {
                format!("/communities/{circle_id}/challenges/{id}")
            }
            ("circle_event", Some(circle_id)) => {
                format!("/communities/{circle_id}?tab=events")
            }
            ("hosted_event", Some(circle_id)) => {
                format!("/communities/{circle_id}?tab=events")
            }
            (_, _) => format!("/events/{id}"),
        };

        let (is_live, normalized_status) =
            derive_activity_state(kind, &status, is_live, &starts_at, &ends_at, Utc::now());

        items.push(DropItem {
            id,
            kind,
            source,
            title: row.try_get("title").map_err(db_error)?,
            description: row.try_get("description").map_err(db_error)?,
            category: row.try_get("category").map_err(db_error)?,
            starts_at,
            ends_at,
            status: normalized_status,
            is_live,
            image_url: row.try_get("image_url").map_err(db_error)?,
            participants_count: row.try_get("participants_count").map_err(db_error)?,
            reward_coins: row.try_get("reward_coins").map_err(db_error)?,
            circle_name: row.try_get("circle_name").map_err(db_error)?,
            circle_id,
            action_url,
            created_at: row.try_get("created_at").map_err(db_error)?,
        });
    }

    Ok(())
}

fn derive_activity_state(
    kind: &str,
    stored_status: &str,
    stored_live: bool,
    starts_at: &Option<DateTime<Utc>>,
    ends_at: &Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> (bool, &'static str) {
    let ended_by_time = ends_at.as_ref().is_some_and(|end| end < &now);
    if stored_status == "ended" || ended_by_time {
        return (false, "ended");
    }

    let inside_event_window = starts_at.as_ref().is_some_and(|start| start <= &now)
        && match ends_at.as_ref() {
            Some(end) => end >= &now,
            None => true,
        };

    let is_live = kind == "event" && (stored_live || inside_event_window);
    if is_live {
        return (true, "live");
    }

    if kind == "challenge" {
        return if starts_at.as_ref().is_some_and(|start| start > &now) {
            (false, "upcoming")
        } else {
            (false, "active")
        };
    }

    (false, "upcoming")
}

fn db_error(error: sqlx::Error) -> ApiError {
    tracing::error!(%error, "Drops database operation failed");
    api_error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "drops_database_error",
        "Could not load activity.",
    )
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Utc};

    use super::derive_activity_state;

    #[test]
    fn event_inside_its_time_window_is_live() {
        let now = Utc::now();
        let starts_at = Some(now - Duration::minutes(5));
        let ends_at = Some(now + Duration::minutes(20));

        assert_eq!(
            derive_activity_state("event", "upcoming", false, &starts_at, &ends_at, now),
            (true, "live")
        );
    }

    #[test]
    fn explicit_live_flag_keeps_an_event_live() {
        let now = Utc::now();
        let starts_at = Some(now + Duration::minutes(10));
        let ends_at = Some(now + Duration::hours(1));

        assert_eq!(
            derive_activity_state("event", "upcoming", true, &starts_at, &ends_at, now),
            (true, "live")
        );
    }

    #[test]
    fn challenges_are_active_not_live_broadcasts() {
        let now = Utc::now();
        let starts_at = Some(now - Duration::minutes(5));
        let ends_at = Some(now + Duration::days(2));

        assert_eq!(
            derive_activity_state("challenge", "active", false, &starts_at, &ends_at, now),
            (false, "active")
        );
    }

    #[test]
    fn scheduled_challenges_are_upcoming_not_live() {
        let now = Utc::now();
        let starts_at = Some(now + Duration::hours(2));
        let ends_at = Some(now + Duration::days(1));

        assert_eq!(
            derive_activity_state("challenge", "active", false, &starts_at, &ends_at, now),
            (false, "upcoming")
        );
    }

    #[test]
    fn expired_activity_is_excluded_as_ended() {
        let now = Utc::now();
        let starts_at = Some(now - Duration::days(2));
        let ends_at = Some(now - Duration::hours(1));

        assert_eq!(
            derive_activity_state("event", "upcoming", false, &starts_at, &ends_at, now),
            (false, "ended")
        );
    }
}

#[cfg(test)]
mod drops_visibility_tests {
    #[test]
    fn drops_circle_activity_query_includes_public_circles_and_private_owner_members() {
        let source = include_str!("drops.rs");
        let circle_discovery_query = source
            .split("SELECT circle.id")
            .nth(1)
            .expect("Circle discovery query must select Circle IDs")
            .split("#,")
            .next()
            .expect("Circle discovery query must be bounded");

        assert!(circle_discovery_query.contains("circle.is_private IS FALSE"));
        assert!(circle_discovery_query.contains("circle.owner_id = $1"));
        assert!(circle_discovery_query.contains("member.status IN ('active', 'approved')"));
    }

    #[test]
    fn hosted_drop_events_use_the_same_public_or_member_visibility_boundary() {
        let source = include_str!("drops.rs");
        let hosted_events = source
            .split("async fn load_hosted_events")
            .nth(1)
            .expect("Hosted event loader must exist")
            .split("async fn load_circle_events")
            .next()
            .expect("Hosted event query must end before Circle events");

        assert!(hosted_events.contains("circle.is_private IS FALSE"));
        assert!(hosted_events.contains("circle.owner_id = $1"));
        assert!(hosted_events.contains("member.status IN ('active', 'approved')"));
    }
}
