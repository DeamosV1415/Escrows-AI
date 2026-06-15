# Inbox Sync — Architecture & Future Work

> How email/WhatsApp messages get from the provider into the inbox and onto the
> screen, and the one optimization deliberately deferred. Read this before
> touching [gmailSync.js](../server/utils/gmailSync.js),
> [webhooks.js](../server/routes/webhooks.js), or the SSE path.

## The two layers (don't conflate them)

Message delivery is two independent jobs:

| Layer | Job | Mechanisms |
| --- | --- | --- |
| **1. Ingestion** | get a message into the **database** | Pub/Sub webhook · auto-sync · manual sync |
| **2. Delivery** | get a stored row to the **browser** | SSE push · 60s poll · page refresh |

SSE never talks to Gmail — it only forwards rows something else already wrote.
So SSE replaces *polling/refresh* (Layer 2), **not** auto-sync (Layer 1).

## Current design (event-driven)

| Layer | Primary | Fallback |
| --- | --- | --- |
| Ingestion → DB | **Pub/Sub webhook** ([webhooks.js](../server/routes/webhooks.js)) — real-time; watch kept alive by `ensureGmailWatch` | auto-sync reconciliation (30 min prod / 60s dev, concurrency-capped) + manual **Sync** button |
| Delivery → browser | **SSE** (`GET /api/messages/stream`, [realtime.js](../server/utils/realtime.js)) | 60s conversation poll + `EventSource` auto-reconnect |

Key properties:
- **All ingestion paths funnel through `syncGmailMessages`**, which does an
  *idempotent* re-scan (`newer_than:14d`, 50 msgs, deduped by the sparse
  `externalId` index) — no advancing cursor, so nothing is ever permanently
  skipped. This replaced an earlier History-API cursor that dropped messages
  when it advanced past changes Gmail hadn't surfaced yet (eventual consistency).
- **Watch renewal** is opportunistic and expiry-guarded (renews within 1 day of
  expiry), so the Pub/Sub push path doesn't silently die after its ~7-day TTL.
- **Auto-sync is a reconciliation net**, not the workhorse: prod leans on the
  webhook, dev relies on auto-sync because `localhost` can't receive Pub/Sub.

Relevant env vars: `GMAIL_SYNC_INTERVAL_MS`, `GMAIL_SYNC_CONCURRENCY`,
`GMAIL_SCAN_QUERY`, `GMAIL_SCAN_MAX`, `GMAIL_AUTOSYNC_DISABLED`,
`GOOGLE_PUBSUB_TOPIC`, `NODE_ENV`.

---

## Future task: targeted History-API fast path for the webhook ⬜

**What it is.** The Pub/Sub payload carries a `historyId`. Instead of the full
re-scan on every push, the webhook could fetch *only the deltas*:

1. Store the last-processed historyId per connection.
2. On push: `history.list(startHistoryId: lastKnown, historyTypes: [messageAdded], labelId: INBOX)` → exactly the new message IDs.
3. `messages.get` only those; skip the 50-message scan and the `getProfile` call.
4. Advance the stored historyId.

**Why it's deferred.** The current full re-scan costs ~11–16 Gmail quota units +
~50 indexed point lookups per push, to deliver one email. At normal volume
that's invisible, and the re-scan is *self-healing* (no cursor to corrupt).

**The trap to avoid.** A historyId cursor reintroduces the exact hazard we
removed: if you ever advance it past an unobserved change, that message is lost
forever. The targeted path is only safe if it:
- advances the cursor **only to the historyId of records actually processed**
  (or the response's `historyId`), never blindly to the latest;
- on `history.list` **404 (expired historyId)**, falls back to a full scan;
- keeps the **periodic full re-scan as a reconciliation backstop** (already in
  place) to mop up anything the fast path misses due to lag.

So it's purely **additive**: targeted = fast path, re-scan = correctness net.
It cannot regress correctness as long as the reconciliation net stays.

### When to consider building it

Reach for it when **any** of these is true:
- A mailbox is **high-volume** — a support/sales inbox taking hundreds–thousands
  of relevant emails/day, where "scan 50 per email" multiplies.
- You're **approaching Gmail's per-user rate limit** (~250 quota units/user/sec)
  or seeing `429`/quota errors in logs.
- **Webhook latency or Gmail quota cost** shows up in metrics/billing.
- Pub/Sub is **coalescing many pushes** such that concurrent full scans pile up.

Until then, the re-scan's robustness is worth more than the saved API calls.

### Related smaller cleanups (do alongside, if ever)
- Drop the per-sync `getProfile` call on the webhook path (the notification
  already carries the historyId).
- Consider debouncing the SSE-triggered `fetchConversations` if a large batch of
  messages ever arrives at once (minor; fine at current volumes).
