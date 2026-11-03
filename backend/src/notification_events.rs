use sqlx::{Postgres, Transaction};
use uuid::Uuid;

/// Insert in-app activity for the current collaborators of a Chain.
///
/// The caller owns the transaction: the contribution and its notification fan-out
/// either commit together or neither is visible. Dedupe keys make retried delivery
/// idempotent without creating another notification table or event store.
pub async fn notify_chain_contribution(
    transaction: &mut Transaction<'_, Postgres>,
    chain_id: Uuid,
    contribution_id: Uuid,
    actor_id: Uuid,
    actor_name: &str,
    chain_title: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO notifications (
            user_id, actor_id, type, title, message, data, action_url, dedupe_key
        )
        SELECT
            recipient.user_id,
            $3,
            'chain_contribution',
            'New Chain contribution',
            LEFT($4, 100) || ' contributed to ' || LEFT($5, 120),
            jsonb_build_object(
                'chain_id', $1::text,
                'contribution_id', $2::text,
                'activity', 'chain_contribution'
            ),
            '/chains/' || $1::text,
            'chain-contribution:' || $2::text || ':' || recipient.user_id::text
        FROM chain_members AS recipient
        JOIN chains AS chain ON chain.id = recipient.chain_id
        JOIN profiles AS preferences ON preferences.id = recipient.user_id
        WHERE recipient.chain_id = $1
          AND recipient.user_id <> $3
          AND COALESCE(preferences.notification_settings->'in_app', 'true'::jsonb) <> 'false'::jsonb
          AND (
              chain.visibility <> 'circle'
              OR EXISTS (
                  SELECT 1 FROM circle_members AS circle_member
                  WHERE circle_member.circle_id = chain.circle_id
                    AND circle_member.user_id = recipient.user_id
                    AND circle_member.status IN ('active', 'approved')
              )
              OR EXISTS (
                  SELECT 1 FROM circles AS circle
                  WHERE circle.id = chain.circle_id
                    AND circle.owner_id = recipient.user_id
              )
          )
          AND NOT EXISTS (
              SELECT 1 FROM user_blocks AS block
              WHERE (block.blocker_id = recipient.user_id AND block.blocked_id = $3)
                 OR (block.blocker_id = $3 AND block.blocked_id = recipient.user_id)
          )
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
        "#,
    )
    .bind(chain_id)
    .bind(contribution_id)
    .bind(actor_id)
    .bind(actor_name)
    .bind(chain_title)
    .execute(&mut **transaction)
    .await?;

    Ok(())
}
