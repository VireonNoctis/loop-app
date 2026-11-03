# LOOP identity verification

## Meaning of the blue mark

The blue verification mark confirms that LOOP has completed an authenticity review for the account. It is not a popularity score, paid feature, creator ranking or endorsement of everything an account posts.

LOOP Pro never grants verification, a faster review or a higher likelihood of approval. A subscription can never replace the identity review.

## Who can apply

The application supports creators, businesses/brands, public figures and nonprofit organizations. The applicant must control or be authorized to represent the account. A user can submit one pending request at a time.

Applications collect a name, category, explanation and optional public evidence links. Supporting URLs must use HTTPS and cannot contain URL credentials. The application form does not accept identity-document uploads; sensitive documents should not be collected through an ordinary public-link field.

## Review and outcomes

A reviewer with the canonical administrator role checks whether the account represents the person or organization claimed, considers evidence and public presence, and records a decision. Rejections require a concise reason. Approval updates both the request and the applicant's verified profile state in one database transaction.

Private applicant information and evidence links remain in the admin review surface. Applicant history exposes statuses, review dates and the designated rejection feedback, not private reviewer notes.

The request system rejects duplicate pending applications. A second decision against an already-reviewed request is rejected rather than silently changing the outcome.

## Data and deployment

Apply the verification lifecycle SQL through the canonical production setup after backing up the target database. The migration deliberately stops if legacy duplicate pending requests need reconciliation.

Server routes use the existing authenticated account/profile mapping and the service-role database client. Direct client access to the request table is denied through RLS and the removal of legacy applicant policies.

The review RPC is executable only by the service role in Supabase deployments. The API still checks the canonical administrator role before invoking it; the database function independently checks that reviewer ID against profiles.is_admin.

This is a staged legacy Next.js/Supabase domain. Moving it to the Rust API requires a separate migration, integration tests and rollback plan. The schema has not been applied to a live production database by this code change.


## Appeals and decision history

A rejected applicant may submit one appeal for that application, with a reason and an optional public HTTPS evidence link. The original application and appeal are kept separate. The appeal has its own pending, accepted or rejected outcome; duplicate appeals are prevented by a database constraint and a row-locked RPC.

Accepting an appeal returns the original application to the pending review queue. It does **not** grant a blue mark or bypass the ordinary authenticity review. If a newer application is already pending, the appeal cannot reopen a second concurrent application.

Verification request status transitions and appeal decisions are recorded in a server-owned review-event table. The applicant cannot read legal application data, internal reviewer notes, or the event log. The review-event table is read-only to the service-role client and has no direct client policies.
