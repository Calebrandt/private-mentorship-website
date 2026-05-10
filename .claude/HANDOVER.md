# Private Mentorship — Handover Package

**To the next assistant:** read this whole file before touching code.
The owner explicitly asked for it because chat-context limits keep
killing long sessions and we want continuity.

Last updated: 2026-05-10. Author: previous Claude session.
Project owner: **Caleb Brandt** (single founder, building this himself).

---

## TL;DR — what to do in your first 30 minutes

1. Read **§1 Business** so you understand what's being built and for who.
2. Read **§2 Revert safety net** — the owner is paying for Netlify
   deploys; commit locally only and only push when explicitly told.
3. Run the **§5 Audit checklist** before writing code. The mobile app
   and the website were built by different sessions over months; a lot
   already exists. **Do not duplicate Supabase tables, edge functions,
   or auth flows that already work.**
4. Match the **§4 Quality bar** — the owner singled out specific
   sections as "looks great" (The Assistant section, Who this fits,
   We're Looking For, Why Work With PM). Use those as the visual
   language anchor when redesigning anything else.

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

## End of handover

If you've read this far, you're in a strong position to keep
moving. Be opinionated, be careful with deploys, and keep this
file updated when you finish big things or discover unfinished
ones. The owner is excellent to work with — give him your best
work and the revert cord, and you'll do well here.
