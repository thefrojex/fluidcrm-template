# FluidCRM for AI agents: context, suggestions and tools

FluidCRM is used by people **and** by AI agents. This doc defines how agents see a deal, how they propose next steps, what they're allowed to do, and the tools they call. It sits on top of the relational model in [DATA-MODEL.md](DATA-MODEL.md). UI behaviour is in [UI-DECISIONS.md](UI-DECISIONS.md).

These are design directions for whoever builds the backend; adapt names and transport (REST, MCP, function calling) to the stack.

---

## 1. Principles

1. **AI proposes, humans dispose.** Agents create *suggestions*. Only a human accepts or dismisses them. Agents never silently change data a human created.
2. **One deal, one JSON.** An agent analyses a deal from a single self-contained **deal context** document (section 2): the whole event list, reminders, contacts and history. It doesn't make many small reads.
3. **Grounded reasons.** Every suggestion carries a short `reason` that cites real facts from the context (dates, events, contacts), plus the ids it relied on. The user reads that reason in the sidebar before deciding.
4. **Everything is attributable and reversible.** Every tool call is recorded in `activity_log` as the agent's actor. Writes are soft, versioned and idempotent.
5. **Derived values are given, not re-derived.** The context includes each event's computed `status` and `days_from_today`, using the same rules as the UI, so the agent can't disagree with what the user sees.

---

## 2. The deal context document

Built by the backend for one deal at the moment of a run. It's stored verbatim in `ai_runs.context_snapshot` and is the agent's only input about that deal.

### Rules for building it
- Events are **sorted in timeline order** (`event_date`, then `sort_key`) and include **every non-deleted event**, including pending and accepted AI ones.
- Statuses and `days_from_today` are computed with the workspace timezone (DATA-MODEL.md §6.3).
- Include **recently dismissed and expired suggestions** (last 30 days), with their reasons, so the agent doesn't propose them again.
- Include `limits`, so the agent knows how many suggestions it may still create.
- Use ids everywhere. The agent must refer to events and contacts by id in its output.
- Keep it compact: no audit internals, no other deals' data.

### Example (Meridian Technologies, today = 2025-10-30)

```json
{
  "schema_version": "1.0",
  "generated_at": "2025-10-30T10:00:00+05:30",
  "today": "2025-10-30",
  "timezone": "Asia/Kolkata",
  "deal": {
    "id": "d_meridian",
    "company": {
      "id": "c_meridian",
      "name": "Meridian Technologies",
      "industry": "Enterprise Software",
      "city": "Mumbai"
    },
    "tag": "hot",
    "status": "open",
    "value": { "amount": 4500000, "currency": "INR", "period": "yearly", "display": "₹45L/yr" },
    "owner": { "id": "u_abhinav", "name": "Abhinav" },
    "last_activity_at": "2025-10-28T16:20:00+05:30"
  },
  "contacts": [
    { "id": "ct_rohan", "name": "Rohan Mehta", "job_title": "Head of IT", "is_decision_maker": false, "channels": ["email", "whatsapp"] }
  ],
  "summary": {
    "committed_events": 6,
    "done": 5,
    "overdue": 0,
    "next_event_id": "e_pricing",
    "pending_suggestions": 0,
    "days_since_last_activity": 2
  },
  "events": [
    { "id": "e_intro",   "title": "Intro Call",       "type": "call",    "date": "2025-10-12", "days_from_today": -18, "status": "done", "owner": { "kind": "user", "name": "Abhinav" }, "completed_at": "2025-10-12T12:00:00+05:30", "notes": null, "origin": "manual", "reminders": [] },
    { "id": "e_demo",    "title": "Platform Demo",    "type": "demo",    "date": "2025-10-14", "days_from_today": -16, "status": "done", "owner": { "kind": "user", "name": "Abhinav" }, "origin": "manual", "reminders": [] },
    { "id": "e_info",    "title": "Follow-up Info",   "type": "email",   "date": "2025-10-20", "days_from_today": -10, "status": "done", "owner": { "kind": "automation", "name": "Auto • Email" }, "origin": "automation", "reminders": [] },
    { "id": "e_prop",    "title": "Send Proposal",    "type": "document","date": "2025-10-24", "days_from_today": -6,  "status": "done", "owner": { "kind": "user", "name": "Abhinav" }, "origin": "manual", "reminders": [] },
    { "id": "e_sync",    "title": "Stakeholder Sync", "type": "meeting", "date": "2025-10-28", "days_from_today": -2,  "status": "done", "owner": { "kind": "automation", "name": "Auto • Calendar" }, "origin": "automation", "reminders": [] },
    {
      "id": "e_pricing", "title": "Pricing Discussion", "type": "pricing", "date": "2025-11-03", "days_from_today": 4, "status": "next",
      "owner": { "kind": "user", "name": "Abhinav" }, "origin": "manual",
      "reminders": [
        { "id": "r_1", "remind_at": "2025-11-02T18:00:00+05:30", "channel": "email",    "recipient": { "kind": "user", "name": "Abhinav" }, "message": "Prepare the 3-tier pricing sheet before tomorrow's call.", "status": "scheduled" },
        { "id": "r_2", "remind_at": "2025-11-03T09:30:00+05:30", "channel": "whatsapp", "recipient": { "kind": "contact", "id": "ct_rohan", "name": "Rohan Mehta" }, "message": "Hi Rohan, looking forward to our pricing discussion at 11 today.", "status": "scheduled" }
      ]
    }
  ],
  "recent_feedback": [
    { "suggestion_id": "s_old1", "title": "Send discount offer", "status": "dismissed", "dismiss_reason": "Too early to discount before pricing call", "reviewed_at": "2025-10-25T11:00:00+05:30" }
  ],
  "recent_activity": [
    { "at": "2025-10-28T16:20:00+05:30", "actor": "Auto • Calendar", "action": "completed", "entity": "e_sync" }
  ],
  "limits": { "max_pending_suggestions": 3, "remaining_suggestions": 3, "earliest_allowed_date": "2025-10-30" }
}
```

---

## 3. The suggestion pipeline

```
trigger ──▶ build deal context ──▶ dedupe (context_hash) ──▶ agent analyses ──▶ validate output
                                        │ same as last run                         │
                                        ▼                                          ▼
                                  ai_runs: skipped              ai_suggestions + pending deal_events
                                                                (+ draft reminders), in one transaction
                                                                                   │
                                                                                   ▼
                                                                  human: Accept / Edit / Dismiss
                                                                                   │
                                                                                   ▼
                                                       feedback (edited_fields, dismiss_reason)
                                                       appears in the next deal context
```

### Triggers (`ai_run_trigger`)
| Trigger | When | Debounce |
| --- | --- | --- |
| `manual` | User clicks "Suggest next step" (UI not built yet). | None. |
| `event_completed` | An event on the deal is completed. | 2 min per deal: batch several completions into one run. |
| `event_overdue` | Daily job finds a newly overdue event. | Once per event. |
| `deal_created` | New deal with no or very few events. | 10 min, so the user can add basics first. |
| `deal_stale` | Open deal, no activity for 7 days and no next event. | Once per 7 days per deal. |
| `schedule` | Optional nightly sweep of open deals. | Skip if `context_hash` hasn't changed since the last successful run. |

Skip the run (status `skipped`) when `remaining_suggestions` is 0.

### What a good suggestion looks like
- **One concrete next action**, dated on or after `today`, that fits the timeline: usually between the last done event and the next one, or after the last event.
- **Fixes a visible problem first:** overdue events, a missing next step, a stale deal, a missing decision maker, a proposal with no follow-up.
- **Respects feedback:** don't re-propose anything in `recent_feedback` with the same intent.
- **Uses the right owner:** a user for human work; an automation (`email`, `calendar`) only for work the automations actually perform.
- **Optional reminders,** when the action is a task someone must remember, for example a prep reminder the evening before or a client nudge the morning of. They're stored as `draft` until accepted.
- **A reason of 1–3 sentences** citing facts, e.g. "Pilot Setup is 4 days overdue. A short call with the client before Closing on Nov 5 can unblock it."
- **No duplicates** of existing events (same intent in the same week).

### Output schema the agent must return

```json
{
  "suggestions": [
    {
      "title": "Share ROI Case Study",
      "type": "document",
      "date": "2025-11-05",
      "insert_after_event_id": "e_pricing",
      "owner": { "kind": "user", "user_id": "u_abhinav" },
      "color_variant": "blue",
      "reason": "Buyers at the pricing stage usually ask for proof of return. Sending a case study two days after the Nov 3 pricing call keeps momentum.",
      "confidence": 0.78,
      "based_on_event_ids": ["e_pricing", "e_prop"],
      "reminders": [
        { "remind_at": "2025-11-04T17:00:00+05:30", "channel": "in_app", "recipient": { "kind": "user", "user_id": "u_abhinav" }, "message": "Pick the case study and tailor the ROI numbers for Meridian." }
      ]
    }
  ],
  "no_suggestion_reason": null
}
```

Return an empty `suggestions` array with a `no_suggestion_reason` when the deal is on track. "Nothing to do" is a valid answer and better than noise.

### Server-side validation before saving
- `date >= today`; `type`, `owner` and `channel` are valid enum values; referenced ids belong to this deal.
- At most `remaining_suggestions` items.
- `dedupe_key` doesn't match a pending suggestion or one dismissed in the last 30 days.
- The reminder recipient is reachable on its channel.
- `reason` is non-empty.

Drop invalid items individually; save the rest, and record the drops in `ai_runs.output`.

---

## 4. Agent scopes and guardrails

| Scope | Grants |
| --- | --- |
| `deals:read` | `list_deals`, `get_deal_context`, `search`, `get_deal_activity` |
| `suggestions:write` | `create_suggestions`, `update_suggestion`, `withdraw_suggestion`, for its **own** pending suggestions only |
| `reminders:write` | Reminder tools on events with `origin = 'ai'` or `'automation'` that the agent created. Reminders on pending suggestions are `draft`. |
| `events:write` | `log_event` and `complete_event` for automation-style agents (e.g. an email agent logging "Follow-up sent"), on events the agent created |
| `deals:write` | `update_deal_fields` for low-risk fields (`industry`, `city`, contacts). Never `status`, `tag` or `value`: propose those. |

Hard rules, enforced by the API (not by prompts):
- An agent can't call accept or dismiss. Those are human-only endpoints.
- An agent can't edit or delete events, reminders or deals created by a human. It suggests instead.
- No hard deletes anywhere.
- Every write requires `idempotency_key` and, for updates, `expected_version`.
- Rate limits per agent and per deal, for example 30 writes per minute per agent and the per-deal pending cap.
- A disabled agent (`agents.is_enabled = false`) gets `403` on every call.

---

## 5. Tool definitions

The shared fields on every write are `idempotency_key: string` (required) and, on updates, `expected_version: integer` (required). Errors follow one shape: `{ "error": { "code": "conflict" | "not_found" | "forbidden" | "validation" | "limit_reached", "message": "...", "details": {} } }`.

### Read tools

```json
{
  "name": "list_deals",
  "description": "List open deals with headline numbers. Use it to pick which deals need attention; use get_deal_context for details.",
  "input_schema": {
    "type": "object",
    "properties": {
      "filter": { "type": "string", "enum": ["all", "hot", "warm", "cold", "enterprise", "overdue", "stale", "no_next_step"], "default": "all" },
      "sort": { "type": "string", "enum": ["default", "next_activity", "value", "name"], "default": "default" },
      "limit": { "type": "integer", "default": 50, "maximum": 200 },
      "cursor": { "type": "string" }
    }
  },
  "returns": "[{ id, company_name, tag, value, done, total, overdue, next_event: { id, title, date } | null, pending_suggestions, last_activity_at }], next_cursor"
}
```

```json
{
  "name": "get_deal_context",
  "description": "Return the full deal context document (all events in timeline order with computed status, reminders, contacts, recent feedback and limits). This is the main input for analysing a deal.",
  "input_schema": {
    "type": "object",
    "properties": { "deal_id": { "type": "string" } },
    "required": ["deal_id"]
  },
  "returns": "DealContext (see section 2)"
}
```

```json
{
  "name": "search",
  "description": "Search companies (name, industry, city) and events (title, owner). Same matching rules as the board's search box.",
  "input_schema": {
    "type": "object",
    "properties": { "query": { "type": "string", "minLength": 2 }, "limit": { "type": "integer", "default": 20 } },
    "required": ["query"]
  }
}
```

```json
{
  "name": "get_deal_activity",
  "description": "Chronological change history for one deal: who (human or agent) did what, and when.",
  "input_schema": {
    "type": "object",
    "properties": { "deal_id": { "type": "string" }, "since": { "type": "string", "format": "date-time" }, "limit": { "type": "integer", "default": 50 } },
    "required": ["deal_id"]
  }
}
```

### Suggestion tools (scope `suggestions:write`)

```json
{
  "name": "create_suggestions",
  "description": "Propose next-step events for a deal. Each appears on the timeline as a card tagged 'AI suggestion' until a human accepts or dismisses it. Proposed reminders stay as drafts until accepted.",
  "input_schema": {
    "type": "object",
    "properties": {
      "deal_id": { "type": "string" },
      "run_id": { "type": "string", "description": "The ai_run this belongs to, if any." },
      "idempotency_key": { "type": "string" },
      "suggestions": {
        "type": "array",
        "maxItems": 3,
        "items": {
          "type": "object",
          "properties": {
            "title": { "type": "string", "minLength": 1, "maxLength": 80 },
            "type": { "type": "string", "enum": ["call", "team_call", "demo", "email", "document", "contract", "legal_review", "meeting", "qa", "feedback", "pricing", "negotiation", "review", "lunch", "site_visit", "website_visit", "outreach", "onboarding", "closing"] },
            "date": { "type": "string", "format": "date", "description": "On or after today, in the workspace timezone." },
            "insert_after_event_id": { "type": ["string", "null"] },
            "owner": {
              "type": "object",
              "properties": {
                "kind": { "type": "string", "enum": ["user", "contact", "team", "automation"] },
                "user_id": { "type": "string" },
                "contact_id": { "type": "string" },
                "automation": { "type": "string", "enum": ["ai", "email", "calendar"] }
              },
              "required": ["kind"]
            },
            "color_variant": { "type": "string", "enum": ["default", "blue", "purple", "red", "green"], "default": "default" },
            "reason": { "type": "string", "minLength": 10, "maxLength": 400 },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
            "based_on_event_ids": { "type": "array", "items": { "type": "string" } },
            "reminders": { "type": "array", "maxItems": 5, "items": { "$ref": "#/definitions/reminder_input" } }
          },
          "required": ["title", "type", "date", "owner", "reason"]
        }
      }
    },
    "required": ["deal_id", "idempotency_key", "suggestions"],
    "definitions": {
      "reminder_input": {
        "type": "object",
        "properties": {
          "remind_at": { "type": "string", "format": "date-time" },
          "channel": { "type": "string", "enum": ["in_app", "email", "whatsapp", "sms"] },
          "recipient": {
            "type": "object",
            "properties": {
              "kind": { "type": "string", "enum": ["user", "contact", "custom"] },
              "user_id": { "type": "string" },
              "contact_id": { "type": "string" },
              "address": { "type": "string" }
            },
            "required": ["kind"]
          },
          "message": { "type": "string", "minLength": 1, "maxLength": 500 }
        },
        "required": ["remind_at", "channel", "recipient", "message"]
      }
    }
  },
  "returns": "{ created: [{ suggestion_id, event_id }], rejected: [{ index, code, message }] }"
}
```

```json
{
  "name": "update_suggestion",
  "description": "Edit one of your own pending suggestions, for example after new information. Fails if it was already accepted, dismissed or expired.",
  "input_schema": {
    "type": "object",
    "properties": {
      "suggestion_id": { "type": "string" },
      "expected_version": { "type": "integer" },
      "idempotency_key": { "type": "string" },
      "changes": { "type": "object", "description": "Any of: title, type, date, owner, color_variant, reason, confidence, based_on_event_ids." }
    },
    "required": ["suggestion_id", "expected_version", "idempotency_key", "changes"]
  }
}
```

```json
{
  "name": "withdraw_suggestion",
  "description": "Withdraw one of your own pending suggestions (status becomes 'superseded'). Use when a newer analysis replaces it.",
  "input_schema": {
    "type": "object",
    "properties": { "suggestion_id": { "type": "string" }, "reason": { "type": "string" }, "idempotency_key": { "type": "string" } },
    "required": ["suggestion_id", "idempotency_key"]
  }
}
```

### Reminder tools (scope `reminders:write`)

```json
{
  "name": "add_reminder",
  "description": "Add a reminder to an event you created. On a pending suggestion it's saved as a draft and fires only after a human accepts.",
  "input_schema": {
    "type": "object",
    "properties": {
      "event_id": { "type": "string" },
      "idempotency_key": { "type": "string" },
      "reminder": { "$ref": "create_suggestions#/definitions/reminder_input" }
    },
    "required": ["event_id", "idempotency_key", "reminder"]
  }
}
```

`update_reminder` (`reminder_id`, `expected_version`, `changes`) and `cancel_reminder` (`reminder_id`, `reason`) follow the same pattern. Neither works on a reminder that's already `sent`.

### Automation tools (scope `events:write`)

```json
{
  "name": "log_event",
  "description": "Record something an automation actually did (e.g. an email that was sent or a meeting the calendar booked) as a committed event. Not for proposals; use create_suggestions for those.",
  "input_schema": {
    "type": "object",
    "properties": {
      "deal_id": { "type": "string" },
      "idempotency_key": { "type": "string" },
      "title": { "type": "string" },
      "type": { "type": "string" },
      "date": { "type": "string", "format": "date" },
      "completed": { "type": "boolean", "default": true },
      "notes": { "type": "string" }
    },
    "required": ["deal_id", "idempotency_key", "title", "type", "date"]
  }
}
```

`complete_event` (`event_id`, `expected_version`, `idempotency_key`) marks an event the agent created as done.

### Human-only endpoints (used by the UI, never exposed as agent tools)

| Endpoint | Effect |
| --- | --- |
| `accept_suggestion(suggestion_id, expected_version)` | DATA-MODEL.md §6.2 Accept. Draft reminders become scheduled. |
| `dismiss_suggestion(suggestion_id, reason?)` | DATA-MODEL.md §6.2 Dismiss. |
| `undo(request_id)` | Reverses one recent request using `activity_log` (DATA-MODEL.md §6.7). |
| Create, update or delete events, reminders, deals and companies | Normal CRUD for people, with the same validation. |

---

## 6. Feedback loop and evaluation

- **Signals per suggestion:**
  - accepted unchanged (strong positive)
  - accepted with `edited_fields` (positive, but note which fields: dates edited often means bad timing)
  - dismissed with a reason (negative, with the cause)
  - expired unreviewed (weak negative, probably noise)
- Feed the last 30 days of these into every deal context (`recent_feedback`), so the agent adapts per deal.
- **Track per agent and per `prompt_version`:**
  - acceptance rate
  - edit rate by field
  - time to review
  - share of runs returning "no suggestion"
  - token cost per accepted suggestion
- Keep `ai_runs.context_snapshot`, so a run can be replayed against a new prompt or model before rolling it out.

---

## 7. Notes for whoever implements this

- Build the deal context in one query path with a cache keyed by `deal_id + last change id`. It's read on every run and by the UI's AI panel.
- Use one transaction per `create_suggestions` call, so the suggestion, event and draft reminders appear together or not at all. The UI must never show a card without its reason.
- Push changes to open clients (websocket or SSE). Agents and humans edit concurrently, and a card appearing live with its AI tag is part of the experience.
- Show the agent's `display_name` in the UI where the activity log is surfaced, e.g. "Suggested by Next-step planner · Accepted by Abhinav".
