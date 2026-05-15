# Private Mentorship — Handover Package

**To the next assistant:** read this whole file before touching code.
The owner explicitly asked for it because chat-context limits keep
killing long sessions and we want continuity.

Last updated: 2026-05-15. Author: Claude session that built the pick-list system.
Project owner: **Caleb Brandt** (single founder, building this himself).

---

## TL;DR — what to do in your first 30 minutes

1. Read **§1 Business** so you understand what's being built and for who.
2. Read **§2 Revert safety net** — the owner is paying for Netlify
   deploys; commit locally only and only push when explicitly told.
3. Read **§12 Architectural rules (NON-NEGOTIABLE)** — this is the
   list of things that will silently corrupt production data if you
   break them. Cite the manual (§20) when you reference them.
4. Read **§20 The Master Engineering Manual** — it's the API for
   contracts/schedules/lifecycle. Don't touch those areas without
   reading the relevant section first.
5. Run the **§5 Audit checklist** before writing code. The mobile app
   and the website were built by different sessions over months; a lot
   already exists. **Do not duplicate Supabase tables, edge functions,
   or auth flows that already work.**
6. Match the **§4 Quality bar** — the owner singled out specific
   sections as "looks great" (The Assistant section, Who this fits,
   We're Looking For, Why Work With PM). Use those as the visual
   language anchor when redesigning anything else.
7. **For any big arc (>6 hours of work)**, propose a phased plan
   before starting (see **§21**). The owner has been burned by
   single-session mega-builds.
8. **After major work**, ask the owner: *"Should I update the
   HANDOVER.md?"* See **§22** for the rule.

---

## §1. Business fundamentals

**Private Mentorship** is a Canada-wide service Caleb runs. One
trusted adult (the "Assistant") attaches to a family and works
across three areas:

- **Education** — 1-on-1 lessons, homework, study strategies,
  school re-teach, ESL, vocational, post-secondary support (~40%
  of time).
- **Life Skills** — communication, confidence, social practice,
  daily routines, independence, transit, social opportunities
  (~35%).
- **Personal Support** — appointments, errands, transportation,
  paperwork, advocacy, day-to-day coordination (~25%).

The Assistant's job has three modes (the "tal" section on the
landing page):

1. **Representation** — attends meetings (school, WorkBC, CLBC,
   medical, funding) on behalf of the family.
2. **Resourcing** — finds programs, files applications, secures
   funded supports (a real example on the page: a $4,000 WorkBC-
   funded psych assessment).
3. **Reinforcement** — sends written summaries, then re-teaches
   the material to the client in a separate session.

**Plans** (matches `client-membership.html` and the new mobile
plan cards on the landing):

- 1-month term: $30/hr blended → 24h plan = $720/mo, 40h = $1,200
- 2-month term: $45/hr blended → 24h plan = $1,080,    40h = $1,800
- 40-hour plan is marketed as "Popular"
- Three flex tokens per term (cancel/reschedule/stack)
- Standard membership: hours protected by contract, 24h advance
  cancel/reschedule, monthly progress review
- Premium add-ons (40h plan): priority scheduling, same-day
  reschedule Mon-Thu, quarterly review

**Audience** — the marketing site has age-stage targeting:
Children & Pre-Teens (6–13), Teenagers & Young Adults (14–19),
Adults & Seniors (20–65+), Special Needs & Disability (Any Age).
Triggered by the "Learn More — By Age & Stage" modal in Chapter 1.

**Status of the business itself** (this is critical):

> No clients have been invited yet. The app is on TestFlight but
> nothing is in the App Store. The browser/desktop site isn't
> finished. Caleb is finishing the website *before* inviting any
> clients in. Treat this as pre-launch — there's no live user data
> to break. But also: don't ship anything that pretends customers
> already exist.

---

## §2. Revert safety net (READ BEFORE YOU EDIT)

The owner explicitly asked: **"give me a revert option if something
goes wrong"** and: **"stop deploying for every check i do its going
to waste all the tokens."**

### Rules of engagement

- **Commit locally on every edit.** `git commit --no-verify` is
  fine; we use no pre-commit hooks here.
- **Do NOT `git push` unless the user explicitly says "push" /
  "deploy" / equivalent.** Netlify auto-deploys on push and the
  owner pays per build minute.
- **Tag risky milestones** before big redesigns:

  ```bash
  cd "/Users/calebbrandt/Private Mentorship Website/website"
  git tag -a mobile-pre-<thing> -m "Snapshot before <thing>"
  ```

- **Tell the user the revert command** in your response so they can
  copy-paste:

  ```bash
  git reset --hard mobile-pre-<thing>
  git push --force origin main   # only if they want to also undo on Netlify
  ```

### Existing safety tags

- `mobile-pre-book-redesign` — snapshot before the big book-section
  redesign on mobile (commit `a7c8765`). Run
  `git tag --list "mobile-*"` to see all.

---

## §3. What was just done in the prior session (chronological)

A long-running thread did the following — most of it shipped to
production. **If you can't see a change, hard-refresh the browser
or bump the cache-bust query string on `<link rel="stylesheet">`
tags in `index.html`.**

### Big wins shipped

1. **Mobile responsiveness pass on `index.html`** — viewport meta,
   `overflow-x: clip`, sticky pin restoration via `100svh` (iOS
   URL-bar fix), shimmer/sparkle animations paused on mobile,
   `backdrop-filter` killed on mobile (huge perf win on Safari).
2. **PM·001 / Vancouver / Family Assistant folder card** in the
   hero — shrunk from 100→78px wide with proportional internal
   scaling (flag, helmet, badges all reduced together).
3. **The Assistant section** — hero text + photo collision fix,
   $4,000+ Funded supports stat moved to top-right of photo,
   "Working across" marquee sped up from 50s → 22s on mobile.
4. **Real Moments / Experience photo gallery** — sticky pin
   restored on mobile with squeezed inner layout (square photo
   capped at 280px, info clamped to 3 lines, thumbnail strip
   hidden, controls tightened).
5. **Performance cleanup** — `script.js` spotlight `tick()` now
   self-terminates when settled and pauses via IntersectionObserver
   when offscreen; cached `space.getBoundingClientRect()` so it's
   not recalculated every scroll event (was the #1 source of
   scroll jank). Same pattern applied to the made-for shader
   cycle in `index.html`.
6. **Hamburger menu + mobile drawer** — full-screen overlay with
   blurred backdrop, slides in from right, has Explore / Account
   sections. Wired to all existing chapter-anchor logic.
   — File: markup in `index.html`, CSS in `css/shared.css`.
7. **Mobile menu chapter anchors** — Plans was scrolling to "The
   Service" because the desktop chapter rail is hidden on mobile
   so `btn.click()` was a no-op. Now the click handler scrolls
   directly to `.pm-book__page[data-page="N"]` on mobile and
   closes the drawer first so body-scroll-lock doesn't freeze the
   smooth scroll.
8. **Choose Your Plan cards** (mobile only, Chapter 03) — replaces
   the interactive calculator with the same 24h / 40h cards from
   `client-membership.html`. 1mo / 2mo pill toggle, prices update
   live, both CTAs route to `apply.html`.
9. **Book section premium redesign** (mobile only, all 5 chapters)
   — uniform card system, centered narrative intros, chapter-color
   accents on roman numerals + eyebrows + step discs, dash bullets
   tinted in chapter color, Step 03 (Submit Application) gets a
   distinct cream→peach gradient bg + orange CTA pill, Scene 5
   ("longer arc") same treatment. **Revert tag:
   `mobile-pre-book-redesign`.**
10. **Service worker (`sw.js`) + OS-level Web Push** — calls AND
    system messages now ring the user's phone/desktop OS even when
    the tab is closed. SQL trigger lives in
    `supabase-functions/system-message-web-push.sql` (already
    deployed; option A — JWT verification disabled on the edge
    function — was chosen).
11. **Pick list system end-to-end** (Phases A/B/C — 2026-05-14/15) —
    A pre-engagement family flow: family applies → browses curated
    roster → builds top-3 pick list → submits → admin facilitates
    intro meetings → lifecycle to engaged or declined. **Critical
    context:** this session began with a parallel-system build that
    duplicated existing production pages (separate `/client/`,
    `/admin/`, `/assistants/` dashboards with hardcoded data and
    passcode gates). An audit caught the duplication and the work was
    cleaned up to integrate with the existing Supabase + sidebar
    architecture instead.
    - **Cleanup** (commit `f3618a2`) — deleted 9 duplicate files
      (`/client/dashboard.html`, `/admin/dashboard.html`, mock
      `/assistants/sarah-y.html` etc., gate scripts). Reverted a
      script-block addition to `apply.html`. Snapshot tag
      `pre-cleanup-2026-05-14` preserves the messy state.
    - **Public roster wiring** (commit `428a2f0`) — `assistants.html`
      (a new public page) now fetches `assistant_profiles WHERE
      is_published=true` via new public function
      `listPublishedAssistantProfiles()`. Anonymized rendering: no
      real names, generic person icon, city + languages only. Empty
      state if no published profiles. Requires RLS policy
      "anon read published profiles" (deployed manually 2026-05-14).
    - **Pick list schema + service** (commit `926d478`) — new table
      `client_assistant_picks`, 6 RLS policies (4 own-row for clients
      via `clients.profile_id = auth.uid()`, 2 admin/owner). Two RPCs:
      `client_submit_picks()` (transitions shortlisted →
      introduction_requested) and `admin_update_pick_status(p_pick_id,
      p_new_status, p_notes)`. Status lifecycle: `shortlisted →
      introduction_requested → meeting_scheduled → meeting_complete
      → engaged | declined`. Schema file:
      `supabase-functions/client-assistant-picks.sql`. Service
      additions: `getCurrentClientId`, `fetchMyPicks`, `addPick`,
      `removePick`, `updatePick`, `submitPicks`, `adminListPicks`,
      `adminUpdatePickStatus` on `window.pmHiring`.
    - **Client UI** (commit `1e90061`) — `client-assistants.html`
      (matches the existing sidebar entry "My Assistant", which was
      previously a dead link). Two tabs: Browse Roster (full names
      visible because user is authenticated client) and My Picks
      (1st/2nd/3rd Choice rows, Submit Picks bar, status pills per
      pick). Filters: Location, Language.
    - **Admin UI** (commit `1e90061`) — `admin-intro-requests.html`
      (matches the existing sidebar entry "Intro Requests", also
      previously a dead link). Filter pills (Open · New · Scheduled ·
      Met · All) with live counts. Families grouped together with
      submitted timestamps. Per-row "Move to…" select that calls
      `admin_update_pick_status` RPC. Toast notifications.
    - **Service-layer fix** (commit `543c2a1`) — `adminListAssistantUsers()`
      was using `.or('role.eq.ASSISTANT,role.eq.assistant')` which
      crashed on the lowercase variant because `user_role` is a
      case-sensitive enum (uppercase by convention per §12). Now uses
      `.eq('role','ASSISTANT')`. Required adding `'ASSISTANT'` to the
      `user_role` enum in Supabase (deployed 2026-05-15).
    - **Testing artifact:** A test user `assistant@privatementorship.com`
      ("TYASSISTANT") was promoted to role=ASSISTANT and given an
      `applicants` row manually so the demo profile (Sarah K.) could
      be published. The end-to-end loop was verified: family submitted
      picks, admin received them, status transitions worked.
    - **Known schema mismatch** (carry-forward — see §16):
      `assistant_profiles.assistant_id` has FK to `applicants(id)`,
      but `hiring-service.js` `adminListAssistantUsers()` queries
      `profiles` and treats `user_id` as the assistant_id. This works
      only when `applicants.id = user_id`, which is the convention
      we used manually. Real applicants flowing through the hiring
      wizard probably already have this — but the service-layer code
      should either query `applicants` directly OR the FK should be
      relaxed.

### Earlier in the same thread (not in this short list but verified
shipped):

- Stream.io video calls working browser↔browser, browser↔phone,
  phone↔phone with ring/auto-join.
- Site-wide call ring overlay on any authenticated page.
- Messages page redesign (premium conversations panel, theme
  toggle dark↔pearl per-client persisted).
- Hiring flow live + admin dashboards working.

---

## §4. Quality bar — match these

The owner explicitly said these sections **look great** on mobile;
when you redesign anything, anchor to their visual language:

- **The Assistant** section (`#the-assistant-lander`, class `tal`)
- **Who this fits** (the editorial v2 fit list)
- **We're Looking For / Assistants** (`.pm-hire`)
- **Why Work With Private Mentorship** (Working Time / Compensation
  / Where You'll Work)

Common traits across all of these the owner praised:

- **Centered narrative intros** with a small caps eyebrow → tight
  bold title → muted body.
- **Plenty of breathing room** between blocks (24–48px gaps).
- **Cards on a soft background** with hairline borders + subtle
  shadow, not heavy drop shadows.
- **One accent color per section** that ties everything together
  (chapter color, brand teal/coral, etc.) — not a rainbow.
- **Type ramp:** ~10px caps eyebrow → 16-22px card title →
  13-13.5px body.
- **Clear visual hierarchy** — eyebrow, title, sub, card, divider
  in that exact rhythm.

The book section's mobile redesign (`§3 #9`) follows this language;
copy that pattern when you build new sections.

### Take design leadership, but with the revert net

The owner literally wrote: **"i would like you to lead the way and
save my website on mobile."** Translation: don't ask permission for
every CSS tweak. Make the call, make a tag if it's a big change,
explain what you did and why, and offer the revert command.

If something doesn't fit the mobile viewport (414px or smaller —
test at 375px too for older iPhones), **make the executive
decision** to:

- Stack horizontal flex rows into vertical columns.
- Hide the noisy desktop chrome (covers, page-flip animations,
  side rails) and replace with mobile-native equivalents.
- Drop heavy effects: `backdrop-filter`, `mix-blend-mode`,
  infinite shimmer/sparkle keyframes, large `box-shadow` chains.
  These are what make iOS Safari stutter on scroll-up.
- Switch sticky pin heights from `vh` → `svh` so the URL bar
  doesn't re-trigger layout when it shows/hides.
- Use **`overflow-x: clip`** (NOT `hidden`) on `html, body` because
  `hidden` establishes a scroll container and breaks
  `position: sticky` on every descendant. This bug bit us hard.

If you're ripping out a desktop pattern that doesn't translate
to mobile, **say so in the commit message** ("Drop the page-flip
metaphor on phones — replace with vertical chapter stack") so
future-you can find it.

### Animation budget on mobile

The owner has noticed scroll jank twice. The rules now:

- **No infinite cosmetic keyframes on mobile** (gold shimmers,
  sparkles, pulses on decorative elements). Pause them inside the
  mobile `@media` block.
- **No `mix-blend-mode` on mobile.** It forces stacking-context
  composites every frame.
- **No `backdrop-filter` on mobile** unless you really need it
  (the call modal panel is the one exception). Solid backgrounds
  with `box-shadow` look 95% as nice and don't burn frames.
- **rAF loops must self-terminate** — every long-running
  `requestAnimationFrame` should either stop when the smoothing
  has converged OR pause via `IntersectionObserver` when the
  driving section is off-screen. Search the codebase for
  `requestAnimationFrame` and audit every loop you find before
  adding more.
- **Cache `getBoundingClientRect()`** in scroll handlers — only
  read it once on resize, not per scroll event.

---

## §5. Audit checklist (do this before writing new features)

The owner has TWO repos that interlock. Don't duplicate features
that already exist in either.

### A. The website (this repo)

```
/Users/calebbrandt/Private Mentorship Website/website/
```

Ground-truth files to read first:

- `index.html` — the landing page. Long. Read it section by
  section. Inline `<style>` blocks are everywhere; the global
  shared CSS is in `css/shared.css`.
- `the-assistant.html`, `apply.html`, `signin.html`, `hiring.html`,
  `messages.html`, `client-membership.html`, `client-portal.html`,
  `admin-*.html` — separate pages, all real, all wired to
  Supabase already.
- `script.js` — global JS for the marketing site (spotlight
  gallery scroll-jack lives here, plus the made-for sticky cycle,
  AGI cards, FAQ accordion, nav scroll behavior).
- `hero.js` — the identity hero (powerranger portrait + reveal
  canvas + PM·001 folder card injection).
- `sw.js` — service worker for OS-level Web Push (calls + system
  messages). Already registered.
- `supabase-functions/` — SQL files for functions/triggers that
  have already been deployed to Caleb's Supabase project.
- `css/` — modular per-section stylesheets. `shared.css` is the
  big one (nav, footer, type, hamburger, drawer).

Run before deciding anything is "missing":

```bash
cd "/Users/calebbrandt/Private Mentorship Website/website"
ls -la *.html
grep -rn "supabase\|SUPABASE_URL\|createClient" --include="*.html" --include="*.js" | head -40
git log --oneline -30
git tag --list
```

### B. The mobile app

```
/Users/calebbrandt/private-mentorship-app/
```

(Note the path — it's `private-mentorship-app/` next to the website
directory, NOT inside it.)

This is a React Native / Expo app already on TestFlight. The
owner's app team built most of it. Real-time call ring,
conversation threads, video call (Stream.io), incoming-call
auto-join — all working there. The website mirrors several of
these features (incoming-call ring overlay, OS-level web push)
and was deliberately built to share Supabase tables with the
app. **Don't recreate tables; query the app's schema and reuse.**

Files to scan in the app:

- `App.js` — top-level. Has the Realtime ring listener that
  triggers when a `call_log` row insert happens.
- `src/screens/messaging/Conversation.js` — sends `call_log`
  rows when a video call is initiated.
- `src/services/` — Supabase client + auth + push registration.

If the owner asks for a feature that's clearly cross-device
(notifications, calls, messages, plan management, contracts),
**check the app first** — it's probably already implemented and
you just need to wire the website to the same tables.

### C. Supabase (read-only audit)

The owner's Supabase project is **already wired**. Tables and
edge functions referenced by code that we know exist:

- `profiles`, `clients`, `appointments`, `contracts`,
  `call_logs`, `conversations`, `conversation_messages`,
  `conversation_participants`, `web_push_subscriptions`,
  membership/billing tables.
- Edge function `send-web-push` (used by both the call ring and
  the new SQL trigger `_post_system_message_for_client`).
- The system-message-push trigger lives in
  `website/supabase-functions/system-message-web-push.sql` and is
  already running in prod (option A — JWT verification disabled
  on the edge function).

**Before you create any Supabase resource:**

1. Open the Supabase dashboard (Caleb has the credentials, ask
   for them — don't try to scrape them).
2. Audit existing tables / RPCs / functions / RLS policies by
   name.
3. Audit `website/supabase-functions/*.sql` and grep the codebase
   for `from('table_name')` to see what's actively used.
4. **If a table or function looks similar to what you'd build —
   reuse it.** Don't run the website on a parallel schema; that's
   exactly the duplication the owner is worried about.

If the app team didn't finish a piece (e.g. there's no
`session_notes` table yet but the website needs one), that's
fine — create it, but **document it in this handover so the
next session knows it's new.** Add a section under §7.

---

## §6. File map / where things live

```
website/
├── index.html                          ← landing page (huge)
├── the-assistant.html                  ← The Assistant role detail
├── apply.html                          ← family intake form
├── signin.html                         ← Supabase auth
├── hiring.html                         ← public hiring page
├── messages.html                       ← messenger UI (clients ↔ admin)
├── client-portal.html                  ← logged-in client home
├── client-membership.html              ← logged-in plan picker / billing
├── admin-*.html                        ← internal staff dashboards
├── sw.js                               ← service worker (Web Push)
├── script.js                           ← marketing JS
├── hero.js                             ← hero portrait + PM card
├── css/
│   ├── shared.css                      ← global nav, footer, hamburger
│   ├── footer.css
│   ├── lifecycle-support.css           ← By Age & Stage modal
│   ├── plans-pricing.css
│   ├── partners.css
│   └── ... (more per-section)
├── supabase-functions/                 ← SQL files already deployed
├── js/
│   ├── calls-service.js                ← Stream.io wrapper
│   ├── messages-service.js
│   └── incoming-call-ring.js           ← site-wide ring overlay
├── assets/
│   └── images/, logos/, ...
└── .claude/
    ├── HANDOVER.md                     ← THIS FILE
    └── launch.json                     ← dev server config (port 3000)
```

Dev server: `python3 -m http.server 3000` from the `website/`
directory, OR use Claude Preview (`mcp__Claude_Preview__preview_*`)
which is already configured against port 3000 in
`.claude/launch.json` as **"Marketing Website"**.

---

## §7. Known carry-forward / unfinished items

(Add to this list as you go so the next assistant inherits the
state cleanly.)

- **Apply Now flow on the landing**: the new mobile plan cards both
  CTA to `apply.html`. They should ideally pre-select the tier
  via a query string (`?tier=24h` / `?tier=40h`) so the apply
  form arrives on the right plan card. Not yet wired — `apply.html`
  doesn't read query params for tier preselection at time of
  writing.
- **Hero wordmark / portrait integration**: `hero.js` injects
  `.pm-wordmark` into the page. There were earlier issues where
  it covered the model's face on mobile — currently anchored to
  `.identity-hero` instead of `.portrait__stage`. If the hero gets
  re-laid-out, double-check the wordmark doesn't crash back into
  the face.
- **`messages.html` mobile audit**: messenger UI redesigned for
  desktop premium look (premium conversations panel + theme
  toggle), but never explicitly audited at mobile width with the
  same care the landing got. Likely needs the same treatment:
  hide noisy chrome, stack panels, simplify animations.
- **Cross-page hamburger**: hamburger + drawer were added to
  `index.html` only. The other pages (`apply.html`, `signin.html`,
  etc.) still use the desktop nav-only header which has
  `display:none` on `.nav-links` ≤600px → users on mobile see no
  navigation at all on those pages. Need to lift the hamburger
  markup + JS into a shared partial (or duplicate it on each page
  for now, but plan to share later).
- **Pre-launch placeholders**: a few sections still have
  copy/imagery that hints at active customers. Audit before
  inviting first clients (`testimonials`, partner logos, gallery
  captions). Caleb knows these are placeholders.

---

## §8. Communication style with Caleb

Things he's said directly in chat:

- He wants you to **lead with design decisions** — don't pingpong
  every CSS tweak.
- He wants **revert options** at every milestone.
- He doesn't want **deploys on every check** — local commits only,
  push only when he says "push" / "deploy".
- He wants **clean, polished, premium finishes** — "top tier".
  When in doubt, err toward Apple-class typography spacing and
  Linear-class card density.
- He communicates fast and informally; sometimes typo-heavy. Read
  for intent — if he says "the X is weird, fix it" and you can
  see what he means in a screenshot, don't over-clarify; just fix.
- He sometimes pastes the visible text of a section he doesn't
  like rather than the selector. Find it via grep. He prefers
  you figure out the locator yourself.
- He wants **mobile-only changes** unless he says otherwise. The
  desktop layout is something he's happy with for the most part.
- He wants the **app and website to feel like one product** —
  same brand, same plans, same data, same auth.

When he gives you a screenshot of a problem, the workflow that's
been working:

1. Read the screenshot, identify the section by visible text or
   shape.
2. Grep `index.html` / the relevant page for that text.
3. Find the markup, find the CSS, identify the bug (cascade
   inheritance, viewport unit issue, missing mobile media query,
   etc.).
4. Fix in one edit if possible.
5. Verify in the Claude Preview at mobile width (375x812 preset
   on the existing server `Marketing Website`, port 3000).
6. Commit locally, **don't push**, summarize fix + offer revert.

---

## §9. The four pending pushes that just shipped (today)

These are now live on Netlify (deployed at user's request just
before this handover was written). Don't try to re-push them:

- `786af6a` — Hamburger menu drawer layout fix
- `0a038ff` — Mobile menu chapter anchors
- `a7c8765` — Choose Your Plan cards (Chapter 03 mobile)
- `2210ce6` — Premium book redesign (all 5 chapters mobile)

Tag `mobile-pre-book-redesign` is the rollback point for the
book redesign specifically.

---

## §10. Memory files the user has set up

Caleb has a memory store at
`/Users/calebbrandt/.claude/projects/-Users-calebbrandt/memory/`
that gets surfaced as `claudeMd` context at the start of every
session. Key entries already there (don't recreate):

- `feedback_pm_hero_scope.md` — hero hard-rule: edit `hero.js`
  only, never touch `hero.html` or `hero.css` without asking.
- `project_pm_hero_state.md` — hero current state.
- `project_the_assistant_rebuild.md` — `the-assistant.html`
  rebuild against the NRG reference.
- `project_pm_approach_board.md` — homepage Approach board work.
- `project_lsbc_complaint.md` — unrelated personal project.
- `project_pm_website_hiring.md` — hiring flow state.
- `feedback_pm_website_caveats.md` — hard rules: don't touch DNS
  or schema or `apply.html` without confirming. Watch
  `is_admin` vs `is_admin2` casing bug.
- `feedback_pm_lifecycle_rules.md` — contract / schedule /
  appointments rules from owner's Master Engineering Manual.
  **Read before any contract work.**

When in doubt, grep that memory directory for the topic before
asking.

---

---

# PART TWO — INHERITED REFERENCE MATERIAL

The sections below come from an earlier handoff doc the owner
preserved. Most of it is still current; a few items have moved
forward and are flagged inline. This is the **deep technical
context** for the website — production URLs, architectural
rules, full Supabase deployment status, every page that exists,
all the lifecycle phases shipped, and what's still queued.

**Read this whole second half before doing any work that touches
contracts, lifecycle, schedules, membership, or Supabase.**

---

## §11. Production URLs + critical accounts

- **Production site:** https://privatementorship.ca (Netlify-hosted)
- **Netlify subdomain:** https://luminous-sable-b47923.netlify.app
- **Supabase project:** `llkicgphkvciumfzhbkk`
  → https://supabase.com/dashboard/project/llkicgphkvciumfzhbkk
- **Domain registrar:** GoDaddy (DNS lives at GoDaddy, **NOT
  Netlify** — Resend email DNS lives there too). DO NOT migrate
  DNS to Netlify nameservers without first migrating the email
  records, or the owner's email will break.
- **Master Engineering Manual** (read before any contract /
  lifecycle / membership work):
  `/Users/calebbrandt/Downloads/MASTER ENGINEERING MANUAL (Life Cycle) .txt`

---

## §12. Architectural rules — NON-NEGOTIABLE

Read manual section 5+. These rules are cited throughout the
codebase. Breaking them will silently corrupt production data.

1. **`contracts → contract_recurring_patterns → appointments →
   hours_ledger`** is the chain. Don't break it.
2. **Active contracts are immutable.** Never `UPDATE` an active
   contract's terms. Changes go through future drafts via
   `membership_change_requests`. The only fields safe to touch
   on an active contract are `renewal_mode` (Phase 4) and `notes`
   (audit trail).
3. **Family routing** — all contract logic uses the *service
   recipient's* `client_id`, never the family leader's or
   assistant's `client_id`.
4. **Don't invent parallel approval engines.** There are only two:
   - `schedule_change_requests` — covers cancel / reschedule /
     extra / `membership_schedule`.
   - `membership_change_requests` — covers plan changes.
   Reuse them. Don't make a third.
5. **The hours ledger is sacred.** Don't reseed or rewrite it.
   The `apply_hours_ledger()` trigger automatically updates
   `clients.hours_balance` when rows are inserted.
6. **Lifecycle automation runs every 15 minutes** via pg_cron:
   `SELECT public.run_contract_lifecycle_tick();` — handles
   draft→active promotion, renewals, inventory generation,
   history sync. Do **not** trigger it manually; the pg_cron job
   owns it.
7. **Don't change DNS at GoDaddy.** Resend email DNS lives there.
   Switching to Netlify nameservers without migrating the records
   first will break email.
8. **Owner role is uppercase `OWNER`.** Some legacy `is_admin2()`
   policies expect lowercase — prefer `is_admin()`, which accepts
   both casings.

---

## §13. Detailed page inventory

### Marketing / entry
- `index.html` — homepage (just got the big mobile redesign — see §3)
- `hiring.html` — public hiring page
- `the-assistant.html` — The Assistant role detail
- `apply.html` — family intake form (**out of scope** by default;
  don't edit without explicit ask, per owner's caveat memory)
- `signin.html` — unified signin with Three.js dot-matrix bg,
  role-based routing (OWNER/ADMIN → admin home, CLIENT → client
  dashboard, APPLICANT → wizard)

### Hiring (job applicant) flow
- `hiring-entry.html`, `hiring-signup.html`, `hiring-login.html`,
  `hiring-verify.html`, `hiring-reset.html`
- `hiring-apply.html` — 24-step wizard (debounce-saves to Supabase)

  **Step keys in order:**
  ```
  WELCOME, CONSENT, POSITION_STRATEGY, EARNINGS, IDENTITY,
  ADDRESS, TRANSPORTATION, WORK_ENV, AVAILABILITY, WORK_HISTORY,
  CHILD_EXP, VALUES, UPLOADS_CORE, BACKGROUND_INFO,
  UPLOADS_BACKGROUND, CERTS_INFO, UPLOADS_CERTS, SCENARIOS,
  PROFILE_PREVIEW, BOUNDARIES, CONFIDENTIALITY, LEGAL_LIABILITY,
  FINAL_REVIEW, SUBMIT
  ```

  - Storage bucket: `hiring_docs` (path-based RLS)
  - Edge function: `notify-submission` (Resend → owner email) ✅

### Admin pages
- `admin-dashboard.html` — KPI hero + client roster + management
  tools grid (vivid white/blue NextAdmin style)
- `admin-hiring.html` — applications list with status tabs
- `admin-application.html` — full applicant dossier + status
  actions + correction modal
- `admin-assistant-profiles.html` — list/edit `assistant_profiles`
- `admin-create-client.html` — form to create a client account
  (uses `admin-create-client` edge function)
- `admin-schedule-requests.html` — inbox for cancel / reschedule
  / extra requests; calls `admin_approve_schedule_request` RPC
- `admin-membership-requests.html` — inbox for plan changes; calls
  `admin_approve_membership_change` RPC
- `admin-login.html` — legacy entry (most flows go through
  `signin.html` now)

### Client pages (the lifecycle work)
- `client-dashboard.html` — KPIs, session overview chart,
  conversations, payment history chart, contract history, tasks,
  homework, upcoming sessions
- `client-schedule.html` — schedule hub: 3 action cards
  (Reschedule / Cancel / Request Additional), weekly recurring
  pattern grid (today highlighted), upcoming sessions, recent
  history with inline status dots; modals submit to
  `schedule_change_requests`
- `client-membership.html` — pure plan picker: two stacked pill
  toggles (Yearly / Quarterly + 1 Month / 2 Months), 24h + 40h
  cards, $30/hr (1mo) or $45/hr (2mo), Yearly = 20% off
- `client-contract.html` — **glass settings card (light, premium,
  NOT dark obsidian — owner explicitly rejected dark styling)**:
  Reserved schedule + Service period + Current plan + Billing
  sub-cards, Active/Ending badge, Cancel-after-term button (Phase 4)
- `client-hours.html` — hours ledger table + invoices list +
  receipts list

### Shared JS / CSS
- `js/supabase-client.js` — initializes the `pmSupabase` global
- `js/hiring-service.js` — service layer (~50+ functions covering
  auth, application lifecycle, schedule changes, membership
  changes, hours, contracts, end-of-service, admin operations)
- `js/sidebar.css` + `js/sidebar.js` — collapsible sidebar
  (54px ↔ 272px) with role-aware nav, account popover anchored
  above avatar
- `js/auth-shell.css` — auth pages styling

---

## §14. Supabase deployment status

### RPCs — SQL files in `website/supabase-functions/`

| File | Functions | Status |
|---|---|---|
| `admin-schedule-request-rpcs.sql` | `admin_approve_schedule_request(uuid)`, `admin_reject_schedule_request(uuid, text)` | ✅ deployed |
| `admin-membership-change-rpcs.sql` | `admin_approve_membership_change(uuid)`, `admin_reject_membership_change(uuid, text)` | ⚠️ verify with `SELECT proname FROM pg_proc WHERE proname LIKE 'admin_approve_membership%';` |
| `client-end-of-service-rpcs.sql` | `client_request_end_of_service()`, `client_reactivate_auto_renew()` | ⚠️ needs deploy |
| `system-message-web-push.sql` | `_post_system_message_for_client(...)` | ✅ deployed (option A — JWT verification disabled on `send-web-push` edge fn) |
| `client-assistant-picks.sql` | `client_submit_picks()`, `admin_update_pick_status(uuid,text,text)` | ✅ deployed 2026-05-15 (table + 6 RLS policies + 2 RPCs) |

### Edge functions (Supabase Dashboard → Functions)

| Function | Status |
|---|---|
| `notify-submission` (Resend email on hiring submission) | ✅ deployed |
| `admin-create-client` (admin creates client account) | ✅ deployed |
| `send-web-push` (used by call ring + system-message trigger) | ✅ deployed |
| `contract-lifecycle-runner` (built by app team, runs via pg_cron) | ✅ deployed |
| `stream-video-token` (app feature, not used on web) | ✅ deployed |

### Key tables touched by the website

- **Hiring:** `applicants`, `applications`, `application_steps`,
  `application_documents`, `application_responses`,
  `application_corrections`, `application_correction_actions`,
  `application_events`
- **Lifecycle:** `clients`, `contracts`,
  `contract_recurring_patterns`, `appointments`, `hours_ledger`,
  `schedule_change_requests`, `membership_change_requests`,
  `membership_schedule_negotiations` (negotiations not yet used
  on web)
- **Other:** `profiles`, `families`, `family_assignments`,
  `conversations`, `conversation_participants`,
  `conversation_messages`, `task_lists`, `task_items`, `invoices`,
  `invoice_lines`, `sales_receipts`, `assistant_profiles`,
  `web_push_subscriptions`, `call_logs`
- **Pre-engagement picks** (added 2026-05-15): `client_assistant_picks`
  — family shortlist of Assistants before active engagement. RLS:
  clients see/write own via `clients.profile_id = auth.uid()`;
  admins see/update all via `profiles.role IN OWNER/ADMIN/SUPERADMIN`.

---

## §15. Lifecycle phases shipped

| Phase | Description | Status |
|---|---|---|
| 1 | Read-only schedule view | ✅ |
| 2 | Cancel + reschedule + request additional via `schedule_change_requests` | ✅ |
| 3 | Membership changes (plan + schedule) via `membership_change_requests` + admin approval RPC | ✅ |
| 4 | End of service / "Cancel after term" — `renewal_mode='manual'` + drafts deleted, reversible | ✅ (RPC pending deploy — see §16) |
| 5 | Admin schedule-request inbox + atomic approval RPC | ✅ |

---

## §16. Open queue / pending tasks

### Pending owner tasks (Supabase dashboard, ~5 min each)

- [ ] **Verify `admin_approve_membership_change` deployed**
  ```sql
  SELECT proname FROM pg_proc WHERE proname LIKE 'admin_approve_membership%';
  ```
- [ ] **Deploy `client-end-of-service-rpcs.sql`** (Phase 4)
- [ ] **Rotate Resend API key** — was leaked in chat history months
  ago: `re_HBbt7Nv6_MWU9mvjd2gkzp83Vm6WNyspm`. Replace it in the
  Resend dashboard and update wherever it's referenced
  (`notify-submission` edge function secrets).
- [ ] **Clean up `~/Private Mentorship Website/website/.pre-*`,
  `.backup-*` files** — bloating Netlify deploys (~200 files).
  Quick command:
  ```bash
  cd "/Users/calebbrandt/Private Mentorship Website/website"
  ls -la *.pre-* *.backup-* 2>/dev/null | wc -l
  # Confirm count, then delete
  rm -f *.pre-* *.backup-*
  ```

### Mobile responsiveness audit

- [x] **`index.html` mobile audit** — DONE in this session.
  Hamburger menu, book section premium redesign, plan cards
  replacing calculator, sticky pin fixes (`100svh`), perf
  cleanup. See §3 of this doc.
- [ ] **`messages.html` mobile audit** — STILL PENDING. Messenger
  was redesigned for desktop (premium conversations panel +
  theme toggle) but never explicitly audited at mobile width.
  Likely needs the same treatment as `index.html`: hide noisy
  chrome, stack panels, drop heavy effects.
- [ ] **`apply.html`, `hiring.html`, `the-assistant.html`** —
  mobile audit not yet done. Wizard (`hiring-apply.html`) has
  basic responsive CSS already.
- [ ] **Cross-page hamburger** — currently only on `index.html`.
  Other pages still hide `.nav-links` ≤600px with no replacement
  → mobile users see no navigation. Lift the hamburger markup
  + JS into a shared partial.

### Pick list system — pending polish

(Added 2026-05-15 after the Phase A/B/C build.)

- [ ] **Fix `adminListAssistantUsers()` service-layer query** —
  currently queries `public.profiles WHERE role='ASSISTANT'` and
  passes `user_id` as the `assistant_id` when upserting profiles.
  This only works because the FK
  (`assistant_profiles.assistant_id → applicants.id`) is satisfied
  when applicants.id happens to equal user_id. The wizard's
  `ensureApplicantDraft()` RPC almost certainly already enforces
  this convention, so today's manual `INSERT INTO applicants` for
  TYASSISTANT is an artifact of skipping the wizard. Cleaner fix:
  query `applicants` directly and only show ones with status='accepted'.
- [ ] **Auto-publish on hiring acceptance** — when an applicant's
  status moves to `accepted`, automatically:
  1. Update their `profiles.role` → `'ASSISTANT'`
  2. Insert a draft `assistant_profiles` row (unpublished)
  3. Notify admin to fill in display_name + city + bio
  Currently all three steps are manual.
- [ ] **Email on pick submission** — when `client_submit_picks()`
  fires, send a Resend email to `support@privatementorship.ca`
  with the family's picks. Use the existing `notify-submission`
  edge-function pattern.
- [ ] **Realtime updates on `admin-intro-requests.html`** —
  subscribe to `client_assistant_picks` changes via Supabase
  Realtime so new picks appear without page refresh.
- [ ] **Pick-list count badge in sidebar** — admin sidebar entry
  "Intro Requests" should show a number badge when there are
  unactioned picks (status in `introduction_requested`,
  `meeting_scheduled`, `meeting_complete`).
- [ ] **Client-side status updates without refresh** — after
  admin transitions a pick, the client's `client-assistants.html`
  doesn't reflect the change until they refresh. Same Realtime
  subscription as above would solve it.

### Bigger porting arcs (each is its own session, ~3–5 hr)

Many app features still live as "Coming soon" placeholders on
the client dashboard:

- **Messages** — chat thread with assistant.
  Tables: `conversations`, `conversation_participants`,
  `conversation_messages`. App service:
  `~/private-mentorship-app/src/services/messages.js`.
  *(Note: `messages.html` exists and the service file
  `js/messages-service.js` is wired, but the dashboard's
  Messages card still has a placeholder feel — verify before
  replacing.)*
- **Tasks** — real to-do list.
  Tables: `task_lists`, `task_items`. Already partly fetched on
  dashboard, needs its own page.
- **Education / Homework** detail pages.
  Tables: `homework_sessions`, `homework_events`, `hw_attempts`.
- **My Family (multi-member household)** — invites, permissions,
  member switcher.
  Tables: `families`, `family_assignments`, `family_invites`,
  `family_member_permissions`.
- **Assistant Profiles browse** — clients picking their tutor.
  Tables: `assistant_profiles`, `assistants_clients`.
- **Slot-by-slot membership negotiation** —
  `membership_schedule_negotiations` back-and-forth amendments.
  Phase 3 currently does single-shot approve/reject.
- **Email worker for `email_outbox`** — triggers queue
  notifications; no worker delivers them yet (~2 hr edge function).

---

## §17. Demo mode

Most client + admin pages support `?demo=1` in the URL — overrides
`window.pmHiring` with rich fake data and skips auth. Useful for
design iteration without touching the DB. Pages with demo mode:

- `client-dashboard.html`, `client-schedule.html`,
  `client-membership.html`, `client-contract.html`,
  `client-hours.html`
- `admin-dashboard.html`, `admin-schedule-requests.html`,
  `admin-membership-requests.html`

---

## §18. Owner's working style + design red flags

(Expands on §8 above — these are the explicit do-not-do's the
owner has voiced.)

**Communication:** Product-focused, not deeply technical. Show
the *why* before the *how*. Plain language. Never push forward
when they're confused.

**Stack discipline:** Doesn't want to learn React. Stack stays
vanilla HTML/CSS/JS. When the owner shows React component code
as inspiration, **replicate the visual in vanilla — don't migrate
the stack.** Don't `npm install` in the website folder; no
`package.json` should appear there.

**Local testing:** Tests at `127.0.0.1:5500` via VS Code Live
Server, OR `localhost:3000` via the Claude Preview server (see
`.claude/launch.json`, server name `Marketing Website`).

**Deploy discipline:** Only deploys to Netlify in batches to
conserve credits (Netlify free-tier limited).

**Design red flags — explicitly rejected by owner:**

- ❌ Chunky pills with uppercase labels
- ❌ Dark obsidian gradients (called "garbage / eye-sore" on the
  contract card specifically)
- ❌ Green selected-states (looked off)
- ❌ Small/timid typography ("looks like AI did it")

**Design green flags:**

- ✅ Typography hierarchy (eyebrow → title → sub → body)
- ✅ Clean white cards
- ✅ Subtle gradients
- ✅ Premium, intentional, Apple/Linear-class polish
- ✅ One accent color per section

---

## §19. Things to be paranoid about

- **Active contract immutability.** Never `UPDATE contracts WHERE
  status='active'` except for `renewal_mode` (Phase 4) and `notes`
  audit trail.
- **Don't change DNS, don't switch to Netlify DNS.** Resend email
  setup at GoDaddy is fragile.
- **Don't expose service-role key in client JS.** Anything
  privileged → edge function or PL/pgSQL `SECURITY DEFINER` RPC.
- **Don't `npm install` anything in the website folder.** Vanilla
  HTML — no `package.json` should appear.
- **Verify any RPC you write is gated by role check** (`profiles.role
  IN ('OWNER','ADMIN','SUPERADMIN')`) since `SECURITY DEFINER`
  bypasses RLS.
- **The Resend API key was leaked in chat months ago** — assume
  it's compromised until rotated. See §16.

---

## §20. The Master Engineering Manual (source of truth)

```
/Users/calebbrandt/Downloads/MASTER ENGINEERING MANUAL (Life Cycle) .txt
```

**This is the document that prevents you from breaking the
business.** Read it cover to cover before doing any work that
touches contracts, schedules, membership, hours, family routing,
or lifecycle automation. It's where every architectural rule in
§12 of this handover comes from.

The owner has watched assistants without context invent parallel
systems, mutate active contracts directly, build duplicate
approval engines, and ship things that silently corrupted the
ledger. The manual exists because of that history.

**Section index** (so you can jump to what's relevant):

| § | Topic |
|---|---|
| 1 | What this app actually is (contract-driven service OS) |
| 2 | Core system model (contracts → patterns → appointments → ledger) |
| 3 | High-level lifecycle: beginning → middle → future → transition → end |
| 4 | Verified Supabase data layer (every table documented) |
| 5 | Core contract lifecycle logic (resolver, future drafts, automation, `run_contract_lifecycle`) |
| 6 | Plan vs schedule — non-negotiable distinction |
| 7 | Family-aware routing — protected logic |
| 8 | Membership change system — exact practical behavior |
| 9 | Duplicate request guard |
| 10 | Offboarding / end-of-service architecture |
| (later) | More sections — table inventory, RLS policy guidance, etc. |

**Rule of thumb:** if you're about to touch any of these areas
and you haven't re-read the relevant manual section, **stop and
read first**. The manual is the API.

---

## §21. Realistic phase planning (philosophy for any big arc)

When the owner asked for "all the lifecycle work," the previous
assistant correctly refused to do it in one session. The pattern
that worked, and that you should reuse for any future big arc:

> **5 phases, not one session. Read-only first, writes last.
> Each phase is its own session, ~3–6 hours.**

The shipped lifecycle work followed that pattern exactly:

| Phase | Scope | Time | Risk |
|---|---|---|---|
| 1 | `client-schedule.html` READ-ONLY (weekly grid + upcoming + history, buttons disabled) | ~3–4 hr | Zero — just reads |
| 2 | Cancel + reschedule single appointments via `schedule_change_requests` | ~4–6 hr | Low — uses existing approval engine |
| 3 | Membership changes (plan-only or plan+schedule) via `membership_change_requests` | ~5–7 hr | Medium — duplicate-request guard, future drafts |
| 4 | End service / "Cancel after term" — `renewal_mode` flag, drafts deleted, reversible | ~2–3 hr | Low — preserves all history |
| 5 | Admin approval workspace for both request types | ~4–6 hr | Medium — triggers finalize logic |

**The principle:** if the owner asks for a feature that touches
contracts / schedules / membership / hours / lifecycle, and the
estimated scope is more than ~6 hours, **propose a phased plan
back to him before starting.** He's product-focused; he'll
approve a clean phased approach over a single mega-session every
time. He's seen the failure mode of "redesign → simplify
incorrectly → invent parallel systems."

**Echo of his own words to a previous assistant:**

> "I will not invent parallel systems or mutate active contracts
> directly."

Make that your default disposition.

---

## §22. Keeping THIS handover up to date

The owner explicitly said:

> "tell them to update this after a lot of work we do. they don't
> need to do it every time but after we do major buildings they
> should ask me if they want this file updated with current
> information so it's always a perfect reference guide for a new
> assistant"

**Rule:**

- After **small fixes / tweaks** — leave the handover alone.
- After **major work** (new page shipped, new lifecycle phase,
  new edge function, schema changes, mobile redesign of a whole
  section, big architectural change) — **ask the owner**:

  > "Should I update the HANDOVER.md with what we just did so the
  > next session inherits this cleanly?"

  If yes, edit `website/.claude/HANDOVER.md`:
    - Add the new work to **§3 (chronological list)** with the
      commit hash and a 1–2 line description.
    - Update **§7 (carry-forward)** if you finished pending items
      or discovered new ones.
    - Update **§14 (Supabase deployment status)** if you deployed
      or wrote new RPCs / edge functions / triggers.
    - Update **§16 (open queue)** to remove items you closed and
      add items you discovered.
    - Bump the "Last updated" date at the top.
    - Force-add and commit (`.claude/` is gitignored):
      ```bash
      git add -f .claude/HANDOVER.md
      git commit -m "Handover: update after <X work>"
      ```

The owner cares about this — they ran into the chat-context
limit problem hard and lost continuity multiple times. A
well-maintained handover saves real money on tokens and real
time on rediscovery.

---

## §23. How to pick up cleanly (recommended first 60 minutes)

1. **Read this whole file.**
2. **Run `git log --oneline -30` and `git tag --list`** in
   `~/Private Mentorship Website/website/` to see the most recent
   commits and revert tags.
3. **Run a Supabase RPC inventory:**
   ```sql
   SELECT proname FROM pg_proc
   WHERE proname LIKE 'admin_%' OR proname LIKE 'client_%'
   ORDER BY proname;
   ```
4. **Check the app repo for matching features** before building
   anything new on the website:
   ```bash
   ls /Users/calebbrandt/private-mentorship-app/src/services/
   ls /Users/calebbrandt/private-mentorship-app/src/screens/
   ```
5. **Ask the owner what to test on the live site first** (cancel /
   reschedule, membership change submit, "Cancel after term" on
   contract page, admin approval flows, mobile drawer + plan
   cards on `index.html`).
6. **Then ask which next arc to start** — likely candidates:
   - Messages mobile audit (likely highest value — owner mentioned
     it explicitly when writing this handover)
   - Tasks page port from the app
   - Cross-page hamburger refactor
   - Mobile audit of `apply.html` / `hiring.html` / `the-assistant.html`
   - Family / assistant profiles porting
   - Email worker for `email_outbox`

---

## End of handover

If you've read this far, you're in a strong position to keep
moving. Be opinionated, be careful with deploys, and keep this
file updated when you finish big things or discover unfinished
ones. The owner is excellent to work with — give him your best
work and the revert cord, and you'll do well here.
