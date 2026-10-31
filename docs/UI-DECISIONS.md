# FluidCRM Deals page: UI decisions and data contract

This document is for whoever builds the business logic and data layer behind the Deals page. It records **what each block on the page shows, the rule that drives it, and why it looks the way it does**, so the backend can supply the right data and not undo a deliberate design choice by accident.

The page is currently frontend only: React + Vite, all state in memory in `App.jsx`, sample data in `src/data/deals.js`. Everything resets on reload.

Companion docs:
- [DATA-MODEL.md](DATA-MODEL.md): the relational schema, enums, business rules and permissions, plus a field-by-field mapping from the UI shape below to the tables.
- [AI-AGENTS.md](AI-AGENTS.md): the per-deal JSON context agents analyse, the suggestion pipeline, agent scopes and tool definitions.

---

## 1. Design principles behind the page

The design follows three ideas (taken from Kole Jain's UI/UX videos). Most decisions below trace back to one of them.

1. **Data drives the UI.** Colors, chips and badges come from the data's meaning, not decoration. Red means overdue/urgent, green means done, blue means "next / primary", violet means AI, amber means reminders. If a color appears, it encodes something.
2. **Progressive disclosure.** The common state is quiet and rare or urgent states are loud. Secondary actions (mark done, delete, accept, dismiss, add-between) stay hidden until hover or focus. Details (reminder contents, AI reasoning) live in the sidebar, not on the card.
3. **The invisible UI matters.** Tooltips, toasts with Undo, empty states, validation, keyboard shortcuts and edge fades are part of the product, not polish. Each needs data or behaviour from the backend (see section 11).

---

## 2. Where things live

| File | What it owns |
| --- | --- |
| `src/data/deals.js` | Sample deals and events. This is the shape the UI expects (section 3). |
| `src/lib/deals.js` | **All derived logic**: event status, next event, overdue counts, relative dates, reminder state, filters, search, sort, value parsing. Port these rules to the backend or keep them on the client, but keep them identical. |
| `src/App.jsx` | State and every mutation (section 10), toasts and undo, keyboard shortcuts, filter/search/sort pipeline. |
| `src/components/DealsTimeline.jsx` | Company cell, event card, card tags, connectors, Today marker, per-row scrolling. |
| `src/components/EditSidebar.jsx` | Event editor (including reminders and the AI banner) and company editor. |
| `src/components/DealProgress.jsx` | Segmented progress bar used in the company cell and the table. |
| `src/components/DealsTable.jsx` | Table view of the same deals. |
| `src/components/StatsBar.jsx` | Summary tiles above the board. |
| `src/index.css` | All styling; colors are tokens on `:root`. |

---

## 3. Data model the UI consumes

### Deal (one row per company)

| Field | Type | Required | Meaning / UI effect |
| --- | --- | --- | --- |
| `id` | string | yes | Stable id. |
| `name` | string | yes | Company name. A deal with an empty name can't be created (validation). |
| `tag` | `'HOT' \| 'WARM' \| 'COLD' \| 'ENTERPRISE'` | yes | Status chip next to the name; drives the Hot / Warm / Enterprise filters. |
| `industry` | string | no | Muted meta line. |
| `city` | string | no | Muted meta line. |
| `value` | string, e.g. `'₹45L/yr'`, `'₹1.2Cr/yr'` | no | Deal value. Parsed for totals and sorting (section 12). |
| `logo` | `'building' \| 'hexagon' \| 'landmark' \| 'clipboard' \| 'layers' \| 'briefcase'` | yes | Icon in the round logo. |
| `logoColor` | `'blue' \| 'red' \| 'green' \| 'orange' \| 'purple'` | yes | Logo tint. Brand-ish only; it carries no meaning. |
| `events` | Event[] | yes | Timeline items. Order in the array doesn't matter for display (they're sorted by date), but it's kept stable (section 5). |

### Event (one card on the timeline)

| Field | Type | Required | Meaning / UI effect |
| --- | --- | --- | --- |
| `id` | string | yes | Stable id. |
| `title` | string | yes | Card title. Empty titles can't be saved; a new event closed with no title is discarded. |
| `date` | string `'Oct 20'` (month + day, **no year**) | yes | Card date and the basis for status. **Must migrate to an ISO date** (section 12). |
| `icon` | one of the keys in `eventIcons` (`phone`, `monitor`, `mail`, `file`, …) | yes | Event type, shown in the icon tile. Picker labels are in `eventTypeOptions`. |
| `variant` | `'default' \| 'blue' \| 'purple' \| 'red' \| 'green'` | no | User-chosen color category. Light wash on the card plus the full tint on the icon tile. |
| `owner` | `'Abhinav' \| 'Client' \| 'Team' \| 'Auto • AI' \| 'Auto • Email' \| 'Auto • Calendar'` | yes | Person or automation responsible. Values starting with `Auto` render with an automation icon instead of an avatar. |
| `done` | boolean | no | Completion. If missing, defaults to "date is in the past" (except pending AI suggestions). Set `done: false` on a past event to make it overdue. |
| `notes` | string | no | Free text written by the user. A small note icon appears on the card when it isn't empty. |
| `ai` | `{ status: 'pending' \| 'accepted', reason: string }` | no | Present only if the AI proposed this event (section 7). |
| `reminders` | Reminder[] | no | If non-empty, the event is a **task someone gets reminded about** (section 8). |

### Reminder

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Stable id. |
| `at` | string `'YYYY-MM-DDTHH:mm'` (local, no timezone) | When it fires. Same format a `datetime-local` input produces. Should become a timezone-aware ISO timestamp. |
| `channel` | `'in-app' \| 'email' \| 'whatsapp' \| 'sms'` | Delivery channel. |
| `recipient` | string | Who gets it: a teammate ("Abhinav") or a client contact ("Rohan Mehta (Meridian)"). Free text today; should become a user/contact reference. |
| `message` | string | Reminder text. |

There's no stored `status` on a reminder yet. The UI derives "Sent" or "Scheduled" from `at` versus now (section 8). **The backend should own delivery state** and send it explicitly once reminders are actually delivered.

### Derived, not stored

Don't persist these. They're computed from the fields above every render, and storing them would let them go stale:

- event status (`done` / `overdue` / `next` / `upcoming` / `suggested`)
- which event is "next" for a deal
- overdue count per deal, progress (`done / total`)
- relative labels ("In 4 days", "5 days late")
- reminder sent/scheduled state (until the backend tracks delivery)
- filter counts, summary stats, pipeline total

---

## 4. Event status rules (`eventStatuses` in `src/lib/deals.js`)

Statuses are computed per deal, walking events **sorted by date**:

1. `ai.status === 'pending'` → **`suggested`**. Checked first: a pending suggestion is never done, overdue or next.
2. `done === true` → **`done`**.
3. Date before today → **`overdue`**.
4. The first remaining event (date today or later) → **`next`**. Exactly one per deal at most.
5. Everything after it → **`upcoming`**.

"Today" is currently a constant: `TODAY = Oct 30, 2025` and `NOW = Oct 30, 2025 10:00` in `src/lib/deals.js`, chosen so the sample data has every state. **Replace both with the real current date and time.**

Why: the timeline's most useful questions are "what's late?" and "what's next?". Computing both from one rule keeps the card chips, logo badge, progress bar, stats, Overdue filter and table view consistent with each other.

---

## 5. Timeline row

- **Each company's row scrolls horizontally on its own.** A user asked for this explicitly. That's also why there's no shared date header: rows can't line up with a single header once they scroll separately.
- **Events display sorted by date** using a stable sort. Changing a date moves the card. When the user adds an event "between" two cards, it's inserted after the left card in the array and given that card's date, so the stable sort keeps it in place.
- **Auto-scroll on load:** each row starts scrolled so its first overdue or next event is visible. The point is to show "now", not the start of history.
- **Edge fades** appear on the left or right when a row has more to scroll. They tell the user there's more without a heavy scrollbar. The scrollbar itself only appears when the row is hovered.
- **Row linking:** hovering (or selecting) a company or its timeline tints both, so the fixed company column and the scrolling row read as one row.

### Connectors (the gap between two cards)

- The line is **solid green where the timeline is complete** (leading into a done event), **red leading into an overdue event**, and **dashed everywhere ahead**. Leading into a pending AI suggestion it's dashed violet.
- The dot takes the status of the event to its right: green filled = done, red filled = overdue, blue ring = next, violet hollow = suggestion, grey hollow = upcoming.
- Hovering a gap reveals a **+** that inserts a new event at that point and opens the sidebar. It's hidden by default because adding is frequent but not the main thing you do while reading the timeline.
- The **Today marker** (blue vertical line with a "Today" label) sits in the gap before the first event dated today or later.
- The dashed box at the end of every row adds an event at the end. A company with no events shows a wider "Add the first event" box.

---

## 6. Event card anatomy

```
                                    ┌[🔔 2 reminders][✦ AI suggestion]┐  ← tags on the top edge
┌──────────────────────────────────────────────────────────────┐
│ [icon tile]  Title (bold, truncates)                         │
│      ✓       Oct 24  [status chip]  [note icon]              │
│              (A) Owner                         [hover actions]│
└──────────────────────────────────────────────────────────────┘
```

| Element | Rule | Why |
| --- | --- | --- |
| **Icon tile** | Event type icon in a 30px rounded tile; tile uses the full variant tint, the card only a light wash. | The tile is the scan anchor. Keeping the strong color on the tile (not the whole card) keeps a row of six cards calm. |
| **Done check** | Small green check on the tile's corner when status is `done`. No chip. | Done is the common state; a chip on every done card was noise that drowned the urgent ones. |
| **Title** | 14.5px semibold, one line, truncates with "…" (max ~190px). | Titles are the primary info; long ones must not stretch the card. |
| **Date line** | Date, then a status chip only for `overdue` ("5 days late", red) or `next` ("In 4 days" / "Tomorrow" / "Today", blue, with a pulsing dot). | Relative time answers "how urgent?" faster than an absolute date. Only states that need attention get a chip. |
| **Overdue card** | Red inset edge on the left, red date. | Lets you find late work by scanning edges, before reading anything. |
| **Next card** | Blue border ring and a slight lift. | One clear "do this next" per company. |
| **Note icon** | Shown in the date line when `notes` isn't empty. | Hidden information gets a signifier so users know to open the card. |
| **Owner** | Avatar initial and name, or an automation icon for `Auto • …` owners. | Faces are recognised faster than names; automations shouldn't look like people. |
| **Hover actions** (bottom-right) | Normal event: mark done / reopen, delete. Pending suggestion: accept, dismiss. | Secondary actions, so they're progressively disclosed. They sit on a backing that fades into the card color so they never collide with text. |
| **Variant wash** | `blue / purple / red / green / default`, chosen by the user. | Kept from the original mockup as the user's own categorisation. Note that red here is a category color, not "overdue"; overdue is shown by the edge and chip. |

Clicking anywhere on a card opens it in the sidebar. Cards are keyboard focusable (Enter or Space opens them).

---

## 7. AI suggestions

AI-generated events are **the same card as any other event**. Only their values come from the AI, plus a tag.

### Lifecycle

```
AI creates event with ai.status = 'pending'
      │
      ├── Accept  → ai.status = 'accepted' → normal event (counts everywhere), AI tag stays, quieter
      ├── Dismiss → event deleted (toast with Undo)
      └── Save for later / close → stays pending
```

### Rules and why

- **Pending suggestions are not committed work.** They're excluded from progress, overdue counts, "due in next 7 days" and can never be the "next" event. Otherwise the AI could make a deal look late, or busier than it is, before a human agreed to anything.
- **Accepted suggestions keep `ai`**, so the card keeps its AI tag as provenance. The user explicitly wanted an accepted AI task to keep the tag, with the reminder tag to its left.
- **`ai.reason` is required from the AI.** It's shown in the sidebar banner so the user can judge the suggestion. Don't put it in `notes`: notes belong to the user.
- **The AI tag has two looks:**
  - pending: filled violet-to-blue gradient with a slow shimmer, because a decision is waiting
  - accepted: soft violet outline chip, because there's nothing to decide
- **Sidebar for a pending suggestion:** the title reads "Review suggestion". A banner shows the reasoning with Accept and Dismiss. The primary button reads "Save for later" instead of "Done", and the Completed switch is hidden because you can't complete something you haven't accepted.
- **Sidebar for an accepted suggestion:** a quiet banner reads "Accepted · now a normal event" with the reasoning, and normal editing applies.
- The AI may set every normal field: `title`, `date`, `icon`, `variant`, `owner` and also `reminders`.

---

## 8. Reminders (events that are tasks)

An event with at least one reminder is a task that someone gets reminded about.

### On the card: the reminder tag

- An amber tag with a bell: **"1 reminder" / "2 reminders"**. The count is **all reminders on the event, sent and scheduled**.
- If every reminder has already gone out, the tag turns grey: the task still has reminders, but nothing is pending.
- Its tooltip shows the next scheduled one: `Next: Nov 3, 9:30 AM · WhatsApp to Rohan Mehta (Meridian)`.
- The bell wiggles once when the card is hovered, a small signifier that the event will nudge someone.
- Amber is reserved for reminders, so it never competes with red (overdue) or violet (AI).

### Tag placement and order (applies to every tag)

- Tags sit **on the card's top-right edge**, half above the border, so they never cover the title on narrow cards.
- **Order is fixed: reminders first, AI last (rightmost).** That's what the user specified: on an accepted AI task with reminders, the reminder tag appears to the left of the AI tag. The AI tag stays in a predictable rightmost spot.
- Cards with both tags get a wider minimum width (228px) so the tags fit within the card.

### In the sidebar

- A **Reminders** section lists each reminder collapsed to a summary: bell, **exact time** ("Nov 5, 10:00 AM"), **channel and recipient** ("Email to Abhinav"), and a state chip **Scheduled** (amber) or **Sent** (grey). Sorted by time.
- Clicking a row expands it to edit: When (date and time), Channel, Remind (recipient), Message, and Remove reminder. It's collapsed by default so a task with several reminders stays scannable.
- **Add reminder** creates one at 9:00 on the event's date, in-app, to the event owner (or Abhinav if the owner is Client, Team or an automation), with the message "Reminder: <title>". It opens expanded.
- Sent versus scheduled is currently `at <= NOW` (section 4). Once reminders are really delivered, the backend should return a real status (scheduled / sent / failed) and the UI should use it.

---

## 9. Deal (company) cell anatomy

```
┌─────────────────────────────────────────────┐
│ (logo)①  Meridian Technologies  [• HOT]     │
│          Enterprise Software • Mumbai       │
│          ₹45L/yr          ▬▬▬▬▬▬▬  5/7      │
└─────────────────────────────────────────────┘
```

| Element | Rule | Why |
| --- | --- | --- |
| **Logo + overdue badge** | Red count badge on the logo's corner when the deal has overdue events. | Scanning down the column, problem deals jump out before any text is read. |
| **Name** | 16px semibold, truncates. | Primary identity. |
| **Tag chip** | Soft chip with a colored dot: HOT orange (the dot pulses), WARM amber, COLD sky, ENTERPRISE violet. The same style is used in the table and the sidebar. | One consistent chip style; previously HOT was a solid block that clashed with the others. The pulse gives hot deals a little life without shouting. |
| **Meta** | Industry • City, muted, truncates. | Context, deliberately lower in the hierarchy. |
| **Value** | Amount in bold blue, `/yr` smaller and lighter. Empty shows "+ Add value". | The amount is what matters; the period is secondary. The empty state invites action instead of showing a blank. |
| **Progress** | One segment per **committed** event (pending AI excluded): green done, red overdue, blue next, grey upcoming. Text is `done/total`, or "**N overdue**" in red when anything is late. Each segment's tooltip names the event, date and status. | Progress at a glance, with the urgent case called out in words. |
| **Selection / hover** | Hovered cell and row tint together; selected cell gets a blue inset edge. | Links the fixed column to its scrolling row. |

Clicking a company opens the company editor: name, status tag, industry, city, value, logo and logo color, and a list of its events. The list marks reminders (bell) and AI events (sparkle), and clicking one opens that event.

---

## 10. Mutations the UI performs (what the API needs to support)

All of these live in `App.jsx`. Today they update in-memory state; each needs a backend operation.

| UI action | Current behaviour | Backend need |
| --- | --- | --- |
| Edit any event or company field | Live update on every keystroke (no Save button). | `PATCH` event / deal. Debounce on the client or batch on the server. |
| Add event (hover + between cards, or the end slot) | Inserts a blank event (`icon: phone`, owner Abhinav, date copied from the left card or today) and opens it. If closed with no title, it's discarded silently. | `POST` event. Only persist once it has a title, or create a draft and delete it on discard. |
| Mark done / reopen (card hover or sidebar switch) | Toggles `done`. Toast with Undo. | `PATCH done`. |
| Delete event | Removes it. Toast with Undo. | `DELETE` (soft delete recommended so Undo can restore it). |
| Accept AI suggestion | `ai.status: 'accepted'`. Toast with Undo. | `PATCH ai.status`. Useful as AI feedback too. |
| Dismiss AI suggestion | Removes the event. Toast says "Dismissed suggestion". | Record it as a dismissal (feedback for the AI), not just a delete. |
| Add / edit / remove reminder | Replaces the event's whole `reminders` array. | Reminder CRUD, plus scheduling and delivery. |
| Add company (button or `N`) | New deal at the top (`tag: WARM`, `logo: briefcase`, cycling logo color), opens the editor. Discarded if closed with no name. | `POST` deal, same draft rule as events. |
| Delete company | Removes the deal and its events. Toast with Undo. | `DELETE` deal (soft delete). |

**Undo** currently restores a snapshot of the whole deals list taken before the action, and it's available for the ~4.5s the toast is shown. With a backend, Undo should reverse the specific operation (restore a soft delete, revert a field) rather than overwrite everything.

---

## 11. Page-level behaviour that depends on data

- **Filter pills** (All Deals / Hot / Warm / Overdue / Enterprise) each show a count across **all** deals. Overdue means the deal has at least one overdue event.
- **Summary tiles** are computed over the **visible** deals:
  - pipeline value (sum of parsed values)
  - active deals
  - events due in the next 7 days (not done, not pending AI)
  - overdue events. Clicking this tile toggles the Overdue filter.
- **Search** keeps deals whose name, industry or city matches, or that have an event whose title or owner matches. Inside a kept row, events that don't match are dimmed rather than hidden, so the row keeps its context.
- **Filter popover:** sort by default order, next activity, deal value or name; and "highlight events owned by" (Everyone / Abhinav / Client / Team / Automations), which dims other owners' events.
- **The company being edited always stays visible**, even if an edit makes it stop matching the current filter, so the row doesn't vanish under the user.
- **Empty state** when nothing matches, with a button to clear search and filters.
- **Table view** shows the same visible deals, one row per company: tag, industry, city, value (right-aligned, tabular numbers), progress, next step (clickable) and an overdue chip.
- **Keyboard:** `/` focuses search, `N` adds a company, `Esc` closes the sidebar or clears search, `⌘/Ctrl + Enter` saves in the sidebar. Shortcuts are ignored while typing in a field.
- **Onboarding tips** (bottom-left) show three tips one at a time and remember dismissal in `localStorage` (`fluidcrm.tips.dismissed`). This is the only thing stored in the browser.

---

## 12. Things the data layer should replace or normalise

The target shapes are defined in [DATA-MODEL.md](DATA-MODEL.md) (see its §8 for the exact mapping).

| Today (frontend stand-in) | Should become | Notes |
| --- | --- | --- |
| `TODAY` / `NOW` constants (Oct 30, 2025) | Real current date and time | Every status, chip, Today marker and reminder state depends on these. |
| `date: 'Oct 20'` with an implied `YEAR = 2025` | ISO date (`2025-10-20`) | The UI formats it for display. Without a year the timeline can't span year boundaries. |
| `value: '₹45L/yr'` strings, parsed by regex (`L` = lakh, `Cr` = 100 lakh) | `{ amount, currency, period }` | Totals, sorting and the quieter `/yr` all come from parsing today. |
| `owner` as display strings | User / contact / automation reference plus a display name | Avatars, owner filter and reminder recipient defaults use it. |
| `reminder.recipient` free text | User or contact reference (with phone/email for the channel) | Needed to actually deliver WhatsApp, SMS and email. |
| `reminder.at` local `YYYY-MM-DDTHH:mm` | Timezone-aware ISO timestamp | |
| Reminder sent/scheduled derived from time | Delivery status from the reminder service | Add `failed` and show it in red. |
| Ids from `crypto.randomUUID()` on load | Server ids | |
| `logo` / `logoColor` keys | Keep, or replace with a real company logo URL | Colors are cosmetic. |

---

## 13. Color semantics (keep these consistent)

| Color | Means | Used in |
| --- | --- | --- |
| Red | Overdue / urgent / destructive | Overdue chip and card edge, logo badge, "N overdue", overdue stat, delete hovers |
| Green | Done / complete | Done check, solid green connector, done segments, Completed switch |
| Blue | Primary / next / selected | Next chip and ring, Today marker, active filter, deal value, selection |
| Violet → blue gradient | AI | AI tag, Accept button, AI banner |
| Amber | Reminders | Reminder tag, reminder rows and the Add reminder button |
| Card variants (blue / purple / red / green) | User's own category | Card wash and icon tile only; never used to signal status |

---

## 14. Open questions for the business logic

1. ~~Should pending AI suggestions expire if not reviewed by their date?~~ Proposed answer in DATA-MODEL.md §6.2: yes, they become `expired`.
2. When an AI event is edited heavily before accepting, should it still count as "AI" for analytics?
3. Should the reminder count on the tag show only pending reminders instead of all of them? It currently shows all, and turns grey when none are pending.
4. Do reminders fire relative to the event (for example "1 hour before"), or only at absolute times as now?
5. Who can see or dismiss AI suggestions on a shared deal?
