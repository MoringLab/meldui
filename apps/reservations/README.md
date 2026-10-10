# Local reservation consumer

Independent business service on loopback 8788, separate from the UI/model server on 8787. Run `pnpm --filter @engine/reservations start`, then open `/reservation.html` in the lab.

SQLite WAL stores reservations, per-user idempotency results, one-use confirmations and audit events. Prepare validates the draft and issues a five-minute server nonce. Confirm requires an authenticated host session, CSRF token, matching user, nonce and idempotency key. A UI boolean/AI-generated Confirmation component does not authorize storage. Confirm is transactional; a retry returns the same result, while a reused key with different intent is rejected. Cancellation verifies ownership and is auditable. Persistence survives service restart; sessions are intentionally ephemeral.

Local demo accounts are alice/bob and the host-controlled default password is `local-preview` (`RESERVATION_DEMO_PASSWORD` overrides it). These credentials are never sent to the model. This is an integration example, not a production identity system. Use your existing host authentication, retention policy, monitoring and private secret management in a real service. Set `RESERVATION_DB` to choose the SQLite path; the default is `artifacts/reservations/data.sqlite`.

Tests cover auth/CSRF, user isolation, stale/reused confirmation, idempotency conflicts, rollback, persistence, cancellation/audit and fault injection. Test-only timeout/500 injection requires `RESERVATION_FAULTS=1`; it is off by default.
