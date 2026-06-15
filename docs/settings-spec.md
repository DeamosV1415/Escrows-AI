# Settings Page — Full Catalog & Build Spec

> A forward-looking catalog of **everything that could live in the Settings page**, so when we
> build it the options are already scoped. Each item notes its **status** against the current
> codebase and any **dependency** that gates it.
>
> Status legend:
> - ✅ **Done** — backend + data already exist; just needs a UI surface.
> - 🟡 **Partial** — some backend exists (model/route/field) but incomplete.
> - ⬜ **Planned** — not built; net-new.
> - 🔒 **Blocked** — depends on another system (e.g. paywall) before it makes sense.

Current state: [SettingsPage.tsx](../src/pages/SettingsPage.tsx) is a "Coming Soon" placeholder.
Suggested layout: a left **section nav** (like the dashboard sidebar) with a scrollable panel on
the right, BEM CSS, `authFetch` + `useState` — matching [ClientsPage.tsx](../src/pages/ClientsPage.tsx).

---

## 1. Account & Profile  🟡
Personal/identity info for the logged-in broker. Most lives on the `User` model already.

| Setting | Status | Notes / data location |
| --- | --- | --- |
| Full name | 🟡 | `User` (set at onboarding) — needs an edit form |
| Email address | 🟡 | `User.email`; changing it needs a re-verify flow |
| Profile photo / avatar | ⬜ | upload → R2 (reuse inventory upload path) |
| Company / brokerage name | 🟡 | used by the `{broker.company}` merge field |
| Phone number | 🟡 | `{broker.phone}` merge field |
| Job title / role label | ⬜ | display only |
| **Timezone** | ✅ | `SequenceSettings.defaultTimezone` — auto-detected from browser today; expose a manual override |
| Preferred language / locale | ⬜ | i18n not yet wired |
| Change password | 🟡 | `auth.js` has password hashing; needs a change-password route + form |

## 2. Security & Access  ⬜
| Setting | Status | Notes |
| --- | --- | --- |
| Two-factor authentication (TOTP/email) | ⬜ | net-new; store secret on `User` |
| Active sessions / device list | ⬜ | needs session/token tracking |
| Login history | ⬜ | audit log collection |
| Sign out everywhere | ⬜ | rotate a token version on `User` |
| Connected OAuth apps review | 🟡 | Gmail/Google OAuth tokens live on `Connection` |

## 3. Integrations  ✅ (already a real feature)
The most-built area. Surfaced today via the Inbox "Connect Apps" flow + [integrations.js](../server/routes/integrations.js).

| Setting | Status | Notes |
| --- | --- | --- |
| Gmail connect/disconnect + status | ✅ | `Connection { channel:"gmail" }` |
| WhatsApp Cloud API connect/disconnect | ✅ | `Connection { channel:"whatsapp" }` |
| Per-channel "connected as" + reconnect | ✅ | `Connection.gmailEmail`, WA phone id |
| Default send-from identity | ⬜ | when multiple Gmail accounts exist |
| Google Calendar | 🔒 | MCP tools exist; needs product wiring |
| SMS / Outlook / iMessage | ⬜ | future channels (engine is channel-ready) |
| Zapier / webhook out | ⬜ | see §11 Developer/API |

## 4. Sequences & Automation  ✅/🟡 (consolidate the "invisible settings")
**This closes the recurring gap** — the per-broker + per-sequence knobs that currently have no UI.
Per-broker defaults live on `SequenceSettings`; per-sequence overrides live on `Sequence.settings`.

| Setting | Status | Notes / data location |
| --- | --- | --- |
| **Global kill switch** (pause all sending) | ✅ | `SequenceSettings.killSwitch` — already on the Sequences page; mirror here |
| **Default timezone** | ✅ | `SequenceSettings.defaultTimezone` |
| **Max messages per client / day** (rate cap) | 🟡 | `DEFAULTS.maxPerClientPerDay` (2) + per-seq `settings.maxPerClientPerDay`; **no UI yet** — this caused the "held" confusion |
| Default quiet-hours window | 🟡 | `SequenceSettings.defaultQuietHours`; per-node opt-in now on send blocks |
| Default `stopOnReply` / `stopOnClosed` | 🟡 | `Sequence.settings.*`; engine reads them, no UI |
| Max steps per enrollment | 🟡 | `settings.maxStepsPerEnrollment` (safety cap) |
| Approval mode (review before send) | ⬜ | `settings.mode: "auto"｜"approval"` reserved, not implemented |
| Unsubscribe / opt-out footer text | ⬜ | compliance; append to outbound (see §8) |
| Retry/backoff tuning | ✅(env) | `RETRY_BACKOFF_MS`, `MAX_SEND_RETRIES` — likely keep env-only |

> Note: most §4 rows want **both** a per-broker default (here) and a per-sequence override
> (a settings panel in the builder). Build the builder panel + this page from the same schema.

## 5. Notifications  ⬜
How the broker is alerted. The in-app sink (`Notification` model) already exists.

| Setting | Status | Notes |
| --- | --- | --- |
| In-app notifications on/off + priority filter | 🟡 | `Notification` model exists; pref flags net-new |
| Email notifications (digests, failures) | ⬜ | reuse the send path |
| WhatsApp notifications to the broker | ⬜ | broker-scoped send |
| Daily digest time + contents | 🟡 | the `schedule`/`compose_digest` blocks already do this per-sequence |
| "Notify me when a sequence send fails" | ⬜ | engine already emits `message_failed`/`failed` events |
| Quiet hours for broker notifications | ⬜ | separate from client-send quiet hours |

## 6. Billing & Subscription  🔒 (blocked on paywall)
Add once the paywall ships. Pricing tiers already exist in [PricingPage](../src/components/PricingPage.tsx).

| Setting | Status | Notes |
| --- | --- | --- |
| Current plan + tier | 🔒 | needs a `Subscription` model + provider (Stripe/Razorpay) |
| Upgrade / downgrade / cancel | 🔒 | provider checkout + webhooks |
| Payment method management | 🔒 | provider-hosted; store customer id on `User` |
| Billing history / invoices | 🔒 | provider invoices |
| Billing email / address / GST/VAT | 🔒 | tax fields |
| Plan usage vs limits | 🔒 | seats, sequences, sends/month |
| Auto-renew toggle | 🔒 | provider subscription flag |

## 7. Credits & Usage  🟡 (AI metering already exists)
The copilot already meters AI usage via [creditService.js](../server/agent/creditService.js).

| Setting | Status | Notes |
| --- | --- | --- |
| Current credit balance | 🟡 | `creditService` tracks it; expose a read |
| Usage history / breakdown | 🟡 | per-tool credit costs exist |
| Buy more credits / top-up | 🔒 | depends on billing (§6) |
| Low-balance alerts | ⬜ | threshold notification |
| Free vs paid model indicator | 🟡 | gpt-4.1 vs 4.1-mini already gated by plan |

## 8. Messaging & Compliance  ⬜
Guardrails that keep the broker's numbers/domains healthy. Partially enforced by the engine.

| Setting | Status | Notes |
| --- | --- | --- |
| Default messaging-hours window (client tz) | 🟡 | per-node quiet hours implemented; a global default here |
| Unsubscribe handling / opt-out keyword | 🟡 | `Client.optedOut` exists + engine honors it; inbound keyword parsing net-new |
| Mandatory unsubscribe footer | ⬜ | append to outbound; compliance |
| Per-day / per-client send caps | 🟡 | = §4 rate cap |
| Consent / source tracking per client | ⬜ | where the lead came from + consent timestamp |
| Signature block (email/WhatsApp) | ⬜ | appended to sends; merge-field aware |

## 9. CRM / Pipeline Preferences  ⬜
Customize the client model to the broker's workflow.

| Setting | Status | Notes |
| --- | --- | --- |
| Custom pipeline stages | ⬜ | today `stage` enum is fixed (Lead→Closed) |
| Custom intent/temperature labels | ⬜ | `intent` enum fixed (hot/warm/cold) |
| Custom client fields | ⬜ | needs a flexible field schema |
| Default next-action priorities | ⬜ | |
| Lead-source taxonomy | ⬜ | ties to §8 consent tracking |
| Transaction milestone labels | 🟡 | `Client.transaction.status` enum exists (Contract-to-Close) |

## 10. Appearance & Personalization  ⬜
| Setting | Status | Notes |
| --- | --- | --- |
| Theme (light/dark/system) | ⬜ | CSS vars already centralized → feasible |
| Density (comfortable/compact) | ⬜ | |
| Default landing page after login | ⬜ | route preference |
| Sidebar collapsed by default | 🟡 | `DashboardLayout` already has collapse state (not persisted) |
| Date/number/currency format | ⬜ | ties to locale |

## 11. Team & Collaboration  ⬜ (multi-user)
Only relevant once accounts have more than one user. Today everything is `userId`-scoped.

| Setting | Status | Notes |
| --- | --- | --- |
| Invite team members | ⬜ | needs an Org/Team model above `User` |
| Roles & permissions (admin/agent/viewer) | 🟡 | admin email-gate exists ([adminAuth.js](../server/middleware/adminAuth.js)); not a full RBAC |
| Shared vs private sequences/clients | ⬜ | data currently single-owner |
| Seat management | 🔒 | ties to billing seats |
| Activity / audit log | ⬜ | |

## 12. Developer / API  ⬜
| Setting | Status | Notes |
| --- | --- | --- |
| Personal API keys | ⬜ | for external access |
| Outbound webhooks (events → URL) | 🟡 | engine already emits `SequenceEvent`s internally |
| Inbound webhook URLs + secrets | 🟡 | pattern exists ([webhooks.js](../server/routes/webhooks.js)) |
| Cron/tick backup secret | ✅ | `POST /api/sequences/tick` is secret-gated already |

## 13. Data & Privacy  ⬜
| Setting | Status | Notes |
| --- | --- | --- |
| Export my data (clients/messages/sequences) | 🟡 | inventory already has xlsx export; generalize |
| Import clients (CSV/xlsx) | 🟡 | xlsx parsing already used in Inbox |
| Data retention policy | ⬜ | auto-archive old messages |
| Delete account (+ all data) | ⬜ | hard-delete cascade across collections |
| Privacy / consent preferences | ⬜ | ties to §8 |

## 14. Support & About  ⬜
| Setting | Status | Notes |
| --- | --- | --- |
| App version / changelog | ⬜ | |
| Help / docs links | ⬜ | |
| Contact support | 🟡 | [ContactPage](../src/components/ContactPage.tsx) exists |
| Legal links (Privacy/Terms/Cookies) | ✅ | pages already exist |

---

## Build order (when we tackle it)
1. **Account & Profile** + **Sequences & Automation** + **Integrations** — all ✅/🟡, immediate value,
   and §4 closes the "invisible settings" friction (rate cap, quiet hours, stop conditions, kill switch).
2. **Notifications** + **Credits/Usage** — mostly surfacing existing data.
3. **Billing & Subscription** — once the paywall/provider lands (unblocks §6, §7 top-up, §11 seats).
4. **Team**, **Developer/API**, **CRM customization**, **Data/Privacy** — larger net-new subsystems.

## Backend already in place to surface
- `SequenceSettings` (killSwitch, defaultTimezone, defaultQuietHours) → §4
- `Sequence.settings` (rate cap, stopOnReply/stopOnClosed, mode, maxSteps) → §4
- `Connection` (Gmail/WhatsApp) → §3
- `creditService` (AI credits) → §7
- `Notification` model → §5
- `Client.optedOut`, `Client.transaction` → §8, §9
- `User` (profile/auth) → §1, §2
