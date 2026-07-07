# Hanoman Design System

The design system for **hanoman** — the internal workflow orchestrator for **nafanesia.id**. Hanoman drives a **docs-driven** development workflow where **Claude Code** builds SaaS/projects (from scratch or existing) against documentation as the Source of Truth, and it gives the team a single **dashboard to monitor Claude Code running across every project at once**.

The workflow it orchestrates:
- **Docs are the Source of Truth.** No plan executes past stale docs.
- **Features** go through *spec → plan → execute* (the "superpowers" skills).
- **QA findings** go through *audit → spec → plan → execute*.
- **The human** pours the idea (from-scratch), writes feature briefs, and files QA findings.
- **hanoman** brainstorms to a locked MVP objective then scaffolds the full doc index (from-scratch) or reverse-engineers docs from the codebase (existing); turns briefs and findings into **specs** in a backlog; then **plans + executes** — fired by a trigger: **schedule, commit, manual, or interval**.

This system dresses that tooling: an **editorial, instrument-panel** aesthetic — warm bone paper, ink text, and a single **wayang gold-leaf brass** accent — that treats documentation as something crafted and worth trusting.

## Brand story (why it looks like this)
Hanoman (Jawa: **Anoman**) is the white monkey (kera putih) of the *Ramayana* — son of the wind god **Batara Bayu**. He is the emblem of **loyal, selfless service (dharma)**: brave, humble, thorough, watchful. Four lakon set the product's temperament, and they map directly to what the tooling does:

| Lakon | Meaning | In the product |
|---|---|---|
| **Anoman Duta** | The messenger who carries Rama's ring as proof | Trust is *proven* — specs and docs are the evidence a plan executes against |
| **Anoman Obong** | Completes the mission and returns with intelligence | A run finishes the spec → plan → execute job and reports back |
| **Gunung Dronagiri** | Unsure which herb, he carries the whole mountain | When in doubt, document everything — the full doc index is the whole mountain |
| **Chiranjivi** | The immortal | The docs (Source of Truth) outlive any one commit or run |

Palette metaphor: **white monkey → bone paper**, **ink → the record/docs**, **wind → Bayu (info/links)**, **gold-leaf → the trust worth gilding**.

## Sources
This system was authored **from written briefs only** — a brand/philosophy brief plus a workflow spec for nafanesia.id's hanoman tooling. No codebase, Figma file, screenshots, or logo art were provided, so there are no external source links to record. If/when the real tooling repo or a Figma exists, add its links here so future readers can trace the system back to ground truth.

---

## Content fundamentals (voice & copy)

**Vibe.** Quiet, exacting, a little literary. The product is a diligent servant, not a hype machine. Copy is calm and declarative; it states what is true and what will happen. Occasional Ramayana references are used as *section flavor* (a lakon name on a callout), never as required reading.

**Person.** Address the user as **you**; the tool refers to itself as **hanoman** (lowercase) or by what it does ("the Stop hook", "the guardrail") — rarely "we", never "I". System/agent contracts are written in the imperative ("Update the index", "Link every doc").

**Casing.**
- Serif display headings: **sentence case** ("Documentation index", "Needs attention"). Never Title Case.
- Mono eyebrows/labels: **UPPERCASE** with wide tracking ("ON CONVENTION", "WORKSPACE").
- File paths, commands, categories, project names: **lowercase mono, verbatim** (`internal/docs/README.md`, `hanoman execute SPEC-138`).

**Tone examples (use these as templates):**
- Status, plain: *"Running · Execute · 2m"*, *"On convention · 94% indexed"*
- A blocking result, factual + next step: *"Plan blocked — the docs it depends on are stale. Fix the index, then re-run."*
- Success, understated: *"Source of Truth complete."*
- Flavor line (sparingly, on brand moments): *"Trust isn't asked for — it's proven. Carry the ring."*

**Numbers & data.** Prefer concrete counts over adjectives ("34 docs · 3 skills · 2 ADRs", "92% linked"). One metric per idea. No exclamation marks. No "!" or hype words ("blazing", "seamless").

**Emoji.** **Not used.** Meaning is carried by Lucide icons, the status-dot vocabulary, and color — never emoji.

---

## Visual foundations

**Overall feeling.** Warm editorial paper meets a technical instrument panel. Documents are the subject, so the system reads like a well-set page: hairline rules, generous whitespace, a serif for voice and a mono for data. Restraint over decoration.

**Color.**
- **Neutrals are warm**, never blue-gray. Backgrounds are bone/cream (`--bone-100` page, `--bone-000` cards); text is warm ink (`--ink-900/700/500`).
- **One accent: brass** (`--brass-500` `#b8863b`) — wayang gold-leaf. It marks the single primary action, active nav, and brand moments. Used sparingly so it stays precious.
- **Wind (teal-slate `--wind-600`)** is the secondary/informational hue and the link color.
- **Semantics are earthy**, tuned to the paper: leaf green (ok/on-convention), amber (warn/drift), clay red (err/off-convention). Each has a `-100` tint for soft fills.
- A **dark ink surface** (`--term-bg`) is reserved for terminal/log output.

**Type.** IBM Plex trio, three clear jobs:
- **IBM Plex Serif** — display/headings, the "dharma voice". Sentence case, tracking −0.02em, tight leading.
- **IBM Plex Sans** — UI and reading text (14px base UI, 16px reading).
- **IBM Plex Mono** — file paths, commands, data, eyebrow labels (UPPERCASE, 0.14em), and the `hanoman` wordmark.

**Spacing & layout.** 4px base grid. Fixed left sidebar (248px) + 56px topbar; content maxes at 1200px and is centered. Density is comfortable, not cramped. Cards and panels are separated by 1px hairlines (`--border-hair`) more than by shadow.

**Backgrounds.** Flat warm bone. **No gradients**, no photographic hero imagery, no repeating patterns or textures. The topbar uses a subtle translucent bone with `backdrop-filter: blur(8px)`; that blur/transparency is the *only* place glass is used. The one dark surface is the terminal log block.

**Corner radii.** Moderate and specific: inputs/buttons `5px` (`--radius-sm`), cards `12px` (`--radius-lg`), pills fully round. Not a single global radius — controls are tighter than containers.

**Borders.** 1px hairlines do most structural work. `--border-hair` (bone-300) for dividers/cards; `--border-strong` (bone-400) for interactive controls; brass for focus.

**Shadows / elevation.** Soft and **warm-tinted** (ink-based rgba, never pure black). Four steps: `raised` (sm) for cards, `float` (md) for hover/menus, `overlay`/`modal` for popovers. Inputs use an `inset` well. No colored glows.

**Cards.** Bone-white surface, 1px hairline border, 12px radius, `shadow-sm`. Header pattern = mono UPPERCASE eyebrow → serif title → optional right-aligned actions; optional footer sits on a tinted (`--bone-100`) strip with a top hairline. Interactive cards lift 1px and deepen to `shadow-md` on hover.

**Hover / press.**
- *Primary/danger buttons:* hover darkens via `filter: brightness(0.95)`; press nudges `translateY(0.5px)`.
- *Secondary/ghost:* hover fills with a bone tint and (secondary) darkens its border.
- *Nav/rows:* hover = `--bone-200` fill; active = brass tint + brass text.
- No scale-up bounces, no glow.

**Focus.** Brass ring — `box-shadow: 0 0 0 3px` at 45% brass (`--ring`) — plus a brass border. Consistent across inputs, selects, and controls.

**Motion.** Wind-quick and calm. Durations 120/180/280ms; easing `--ease-out` (decelerate). Fades and small translations only; the sole looping animation is the pulsing dot on `StatusPill status="scanning"`. Never bouncy/elastic.

**Imagery vibe.** N/A — the system is type-and-token led and ships no imagery. If imagery is ever added, keep it warm-toned and understated to match the paper.

---

## Iconography

- **System:** [**Lucide**](https://lucide.dev) — clean 2px-stroke outline icons — loaded from CDN as the `window.lucide` UMD build and wrapped by the **`Icon`** component (inherits `currentColor`, per-instance sizing). No icon binaries are vendored into this repo.
- **Substitution flag:** No brand icon set was provided, so Lucide is the chosen default (not a substitute for a known set). If the real product uses a different family, swap the CDN + `Icon` internals and note it here.
- **Weight/size:** 2px stroke; 15–19px inside controls, ~24px for standalone glyphs. Match text color unless a semantic color is intended.
- **Common glyphs:** `layout-grid` (projects), `list-checks` (backlog), `activity` (runs), `book-open` (docs/SoT), `zap` (triggers), `box` (project), `git-commit-horizontal` / `calendar-clock` / `mouse-pointer-click` / `timer` (the four trigger types), `file-text`, `folder`, `refresh-cw`, `radar`, `lightbulb` (brief) / `bug` (QA finding), `wind` (brand tick), `check-circle-2` / `x-circle`, `link` / `unlink`.
- **Unicode/emoji:** none. The brand "wind tick" is the Lucide `wind` glyph in a brass chip — a typographic lockup, **not** a logo.

---

## Index / manifest

**Root**
- `styles.css` — the single entry point consumers link (import manifest only).
- `readme.md` — this guide.
- `SKILL.md` — portable Agent-Skill wrapper.
- `tokens/` — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `effects.css`, `base.css`.
- `assets/README.md` — logo/icon/imagery status (no logo art provided).

**Components** (`window.HanomanDesignSystem_c639ad`)
- `core/` — **Icon**
- `forms/` — **Button**, **IconButton**, **Input**, **Select**, **Checkbox**, **Switch**
- `feedback/` — **Badge**, **StatusPill**, **Callout**, **ProgressBar**, **Tooltip**
- `surfaces/` — **Card**
- `navigation/` — **Tabs**

**UI kits**
- `ui_kits/dashboard/` — the Hanoman dashboard for nafanesia.id: **Projects** (multi-project Claude Code monitor), **Backlog** (specs from briefs + QA findings on the brainstorm → execute lifecycle), **Runs** (spec → plan → execute pipeline + live log), **Docs · SoT** (the `internal/docs` Source-of-Truth index), **Triggers** (schedule / commit / manual / interval automation). Entry: `ui_kits/dashboard/index.html`.

**Templates**
- `templates/project-status/` — a **Project status** starting screen (docs SoT coverage + live run + backlog) consuming projects can copy.

**Foundation cards** (Design System tab): Colors (neutrals, brass, semantics), Type (display, body, mono, scale), Spacing (scale, radii, elevation), Brand (wordmark, voice).

## Fonts — note
The IBM Plex trio is loaded from **Google Fonts** via `@import` in `tokens/fonts.css` (no local `.woff2` binaries are bundled, so the compiler lists 0 local fonts — this is expected). For fully offline builds, vendor the `.woff2` files under `assets/fonts/` and replace the `@import` with local `@font-face` rules.

## Caveats / open questions
- **No logo, no source files.** The wordmark is a type-only placeholder; the whole visual direction is inferred from written briefs. If you have brand art, a Figma, or the actual tooling repo, share it and this system will be corrected to match.
- **The dashboard is a cosmetic recreation** of the intended workflow (multi-project monitoring, backlog, runs, triggers) — no real git/Claude/scheduler logic. Confirm the screen set and flows match how you actually want to operate.
- **Fonts** are the well-known IBM Plex family (chosen, not substituted) but are CDN-loaded — see above.
