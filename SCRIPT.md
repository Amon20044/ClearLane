# ClearLane AI — Demo Video Script

> **Gridlock Hackathon 2.0 · Theme 1 (PS1):** *Poor visibility on parking-induced congestion.*

**Logline**
> *ClearLane turns five months of parking tickets into a bias-corrected, validated,
> role-based command center — and closes the loop with citizens — while staying
> brutally honest that the data is enforcement-shaped, not congestion-measured.*

| | |
|---|---|
| **Runtime** | 5:30 (hard cap 6:00) |
| **Aspect** | 16:9 desktop capture + a phone-frame inset for the mobile/citizen beats |
| **Tone** | Calm, confident, evidence-led. Let the product breathe. |
| **Music** | Low, pulsing, "mission-control" — duck under every voiceover line |
| **Golden thread** | *Citizens report → bias-corrected intelligence ranks → command deploys patrols → forecast validates → repeat.* Say it at the start, prove it by the end. |

---

## Runtime budget

| # | Scene | Time | Purpose |
|---|-------|------|---------|
| 0 | Cold open (onboarding + login) | 0:30 | Feel: this is a real, installable product |
| 1 | The problem & the honest premise | 0:30 | Earn trust in the first minute |
| 2 | Government command + troop simulation | 1:10 | The "wow" — live deployment |
| 3 | The intelligence (the differentiator) | 1:10 | Bias-correction + validation |
| 4 | Area station, scoped (RBAC) | 0:50 | Real access control, per station |
| 5 | Mobile / On-Duty | 0:35 | Officers use this in the field |
| 6 | Citizen app — closing the loop | 1:00 | Public value + route avoidance |
| 7 | Install + offline + close | 0:25 | PWA, resilience, the one-line recap |

---

## Pre-flight checklist

```bash
# Backend (seeds the force DB on first run)
cd backend && uvicorn app.main:app --reload --port 8000
# Frontend — record the PWA build, not dev (service worker + install prompt live here)
cd frontend && npm install && npm run build && npm run preview   # http://localhost:4173
```

- **Reset the first-run feel:** DevTools → Application → Local Storage → delete
  `cl_onboarded` (so onboarding plays) and confirm you're **not** in an installed window.
- **Logins ready:** `govt` / `govt` and a station `shivajinagar` / `shivajinagar`.
- **Tabs:** one desktop window + one phone-sized window (or device mirror).
- **Seed some live ops** beforehand (file 1–2 citizen complaints) so the command
  center already has motion when you arrive.

---

## Scene 0 — Cold open · 0:30

**SHOW**
- The **onboarding** (3 swipe screens, cinematic art) → swipe through them.
- Land on the **login**: full-screen command-center background, glass sign-in card,
  and the **white "Install ClearLane"** card sliding up.

**SAY**
> "This is ClearLane — a parking-enforcement command center for Bengaluru Traffic
> Police. It installs like a native app, works offline, and it's honest about
> exactly what its data is."

**NOTE** — Tap **Install** for half a second so the judges see it's a real PWA, then continue.

---

## Scene 1 — The problem & the honest premise · 0:30

**SHOW** — Hold on the login while you set the stakes; hover the data-window label
(*Nov 2023 – Apr 2024*).

**SAY**
> "We were given five months of parking tickets — roughly 298,000 of them. Zero
> speed, zero flow, zero congestion signal. So we don't claim to measure
> congestion. A naive hotspot map just shows you where police *already* patrol.
> ClearLane's whole job is to **correct that bias** and tell you where to look next."

---

## Scene 2 — Government command + troop simulation · 1:10

**SHOW**
- Log in as **`govt` / `govt`** → **Force Command**.
- **City overview:** all stations on the map, sized by P1 load; the responsive
  stat grid — stations, officers on strength, P1 zones, live complaints.
- **Manage stations:** add one (call out the auto-generated **slug login**), remove it.
- **Drill into a station** → its command center.
- **Troop simulation:** flip **Auto-allocate** on; drag the **shift clock** —
  units go on/off duty by shift and rotate to the worst unserved zones; one is
  en-route, one on-site, coverage visibly slides down the queue.

**SAY**
> "Government sees the whole city. It can stand up or retire a station — each gets
> its own login. Inside a station, patrol units auto-allocate to the worst unserved
> zones on a sliding window, shift-aware across the day."

**NOTE (honesty)**
> "These positions are a deployment **simulation** for planning — not live GPS,
> and we never track or rank individual officers."

---

## Scene 3 — The intelligence (the differentiator) · 1:10

**SHOW** (move briskly, one breath each)
- **Command Map** → open **Map layers & view**; the **"What to do now"** card.
- **Priority Queue** → the formula line: `0.50·pressure + 0.30·recurrence + 0.20·emergence`.
- **Timing Gap** → enforcement peaks ~10am; the evening window is a **coverage gap
  vs assumed peaks**.
- **Flow Impact** → modeled proxy (pressure × road context).
- **Forecast** → next-month obstruction pressure.
- **Methodology & Validation** → ±20% sensitivity, persistence backtest, and the
  **real** re-rank slider.

**SAY**
> "Priority blends obstruction pressure, structural recurrence, and emergence — then
> we **bias-correct** by dividing through exposure: distinct officers times active
> days. The forecaster predicts next month's obstruction pressure and we validate
> it on held-out months, with a sensitivity sweep and a backtest. Nothing here is a
> black box."

**NOTE (honesty)** — On Timing Gap and Flow Impact, say the words: *"coverage gap,
not measured congestion"* and *"a proxy, not a sensor."*

---

## Scene 4 — Area station, scoped (RBAC) · 0:50

**SHOW**
- **Logout** (red button, bottom of the sidebar) → log in as
  **`shivajinagar` / `shivajinagar`**.
- The nav is **smaller and scoped**: Station Command, Command Map, Today, Priority
  Queue, Repeat Offenders, Timing Gap, Operations, Staffing — **only this area**.
- **Station Command:** the area's troop map + the **ranked roster by shift**; add an officer live.
- **Repeat Offenders / Timing Gap:** now this station's vehicles / hours only.
- **Prove the boundary:** put `#/...` for a different station's data in the URL → blocked.

**SAY**
> "Log in as a station and everything narrows to that station's turf — its zones,
> its repeat offenders, its roster, its patrols. The login is just the station's
> name as a slug, and the access control is enforced server-side — a station can't
> peek at another's area."

---

## Scene 5 — Mobile / On-Duty · 0:35

**SHOW** — Switch to the phone window (still the station login).
- **Hamburger** opens the drawer (search pinned at the top).
- **Command Map:** the **bottom sheets** ("Map layers", "What to do now") slide up
  Google-Maps style; legend/stats are tap-to-expand chips.
- **On Duty:** current shift, live patrol units with **dispatch**, on-duty officers,
  and area-only jobs + citizen reports.

**SAY**
> "On a phone it's a field tool. One thumb: see your shift, your units, dispatch a
> team, and clear the jobs and citizen reports in your area."

---

## Scene 6 — Citizen app: closing the loop · 1:00

**SHOW** — From login, **"Open the Citizen app"** (`#/citizen`, no login).
- **Area tab:** the map is colored by **today's predicted** obstruction; tap a spot
  → plain risk (clear / some / heavy), the **station covering it**, and **patrols on
  duty now**.
- **Report tab:** tap the map → file a complaint → watch it appear live (this is the
  *same* loop the police side just consumed).
- **Plan a trip:** set start + end → routes draw on the map; the **"Avoids hotspots"**
  option appears, the chosen route glows **blue**, and amber rings mark the spots it
  steers around → "Start navigation" hands off to Google Maps.

**SAY**
> "And the public closes the loop. Citizens see today's predicted obstruction for
> their area, report a problem in two taps — straight into the same command center —
> and plan a trip where we actively route them **around** the worst parking
> hotspots."

**NOTE (honesty)**
> "Still honest: risk is projected from parking-violation patterns, not live traffic;
> roads come from OpenStreetMap, ranked by our obstruction data."

---

## Scene 7 — Install, offline & close · 0:25

**SHOW**
- Tap **Install** → it opens as a standalone app (icon on the home screen / dock).
- **Kill Wi-Fi / airplane mode** → reload → it still opens and renders from the
  bundled demo data.

**SAY**
> "It installs as an app and keeps working with no network — because in an
> emergency, the tool can't go down."

**CLOSE (to camera / black card)**
> "Citizens report. Bias-corrected intelligence ranks. Command deploys patrols. The
> forecast validates. One honest, closed loop — that's ClearLane."

---

## Soundbite cheat sheet

| Beat | Say this |
|------|----------|
| Premise | "Every row is a ticket — zero congestion signal. We correct the bias instead of repeating it." |
| RBAC | "Govt sees all; a station sees only its area — slug = username = password, enforced server-side." |
| Troops | "Shift-aware, sliding-window auto-allocation — a planning simulation, never officer tracking." |
| Validation | "±20% sensitivity sweep + persistence backtest, gated by a self-check in the pipeline." |
| Citizen routing | "We route citizens *around* the worst hotspots, scored on today's prediction." |
| Resilience | "Installable PWA, fully offline — it can't go down when it matters." |

## Honesty guardrails (say-this / not-that)

- **Not** "congestion we measured" → **say** "obstruction pressure from tickets."
- **Not** "evening congestion" → **say** "an enforcement-coverage gap vs assumed peaks."
- **Not** "officer performance" → **say** "zone-level exposure only; we never rank officers."
- **Not** "live vehicle positions" → **say** "a deployment simulation for planning."

## Anticipated judge Q&A

- **"Isn't this just a heatmap?"** No — a raw count re-maps where police already
  patrol. We divide by exposure (distinct officers × active days) to surface the
  **neglected** zones.
- **"What does the forecaster predict?"** A real, observed quantity — next month's
  obstruction pressure — validated on held-out months. Never congestion.
- **"How is operational state kept honest?"** Three separate numbers per zone:
  historical priority (immutable), live adjustment (decays), operational priority
  (clamped sum). Live features never edit the ML scores.
- **"Does it need the internet / the backend?"** No. Offline-first PWA with a
  bundled demo dataset; the live backend is an enhancement.

## Capture tips

- Record at 1440p, 60fps; zoom the browser to ~110% so text reads on a projector.
- Pre-load every view once before recording so map tiles are warm.
- Keep the cursor slow and deliberate; pause ~1s after each click before talking.
- Grab B-roll: the troop units moving, the blue route drawing in, the install
  animation, and the offline reload — these are your highlight cuts.
