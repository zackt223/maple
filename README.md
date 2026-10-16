# Maple Freight: Zack Telsem

## How to run it

Needs **Node.js 18+** only. There are no dependencies, no `npm install` step and no API keys.

```bash
git clone https://github.com/zackt223/maple.git
cd maple
npm start          # dashboard → http://localhost:3000
npm run report     # tonight's ranked list in the terminal (no browser needed)
npm test           # 18 checks: rules, data counts, permissions, role visibility, referrals, firmware, backfill, admin
```

Open http://localhost:3000 and choose a team: **Operations Manager**, **Safety Manager**, **Maintenance Lead** or **Business Manager** (read-only view of everything). Each team only sees its own view. Use the depot buttons at the top (All / North Yard / Airport Hub / Hamilton Depot) to work one location at a time. To reset the workflow (escalations, approvals, notes), delete `state.json` and restart.

Sample `npm run report` output (abridged):

```
Maple Freight: what needs attention (Mon Sep 21 2026, 6:00 p.m. Eastern)
2370 raw alerts → 134 duplicates removed → 2236 unique → 204 high/critical cases → top 10 tonight

#1 [CRITICAL] Engine fault P0524 on V-137  (maintenance; V-137, D-37, North Yard; last 2026-09-21 14:32 ET)
    New fault P0524 after WO-5540 (Replaced coolant temperature sensor) closed 2026-09-21 07:40
    → Maintenance: pull V-137 from tomorrow's 6:00 a.m. dispatch and tag out.
#2 [HIGH] V-151 service overdue 2350 km  (maintenance; V-151, D-51, Hamilton Depot; last 2026-09-21 06:00 ET)
    WO-5541 Scheduled: Booked for 2026-10-05 (next open bay).
...
D-17: raw-count rank #1, serious-events-per-100-km rank #56 of 60
Hamilton Depot: 114/587 alerts arrived >1 h late (max 30 h)
```

## Tonight's top 3 for Maple Freight

1. **Item:** Ground **V-108 (Hamilton)** and **V-137 (North Yard)** before the 6:00 a.m. dispatch. *(Updated after the new information: V-108 was hidden by Hamilton's gateway outage.)*
   **V-108 evidence (from `hamilton_backfill.csv`):**
   - P0217 over-temperature at **107 °C at 12:05 p.m. ET**, then P0524 oil pressure low at **88 kPa at 3:41 p.m. ET**.
   - That is the same overheat-then-oil-pressure failure pattern as V-137. Both were marked MEDIUM by the vendor.
   - Neither alert reached Maple Freight until the gateway reconnected at **6:47 p.m.**, so nobody has seen them.
   - V-108 is a Class 5 service truck; its previous work order was WO-5512 (P0171).
   **V-137:**
   **Why it matters:** The shop cleared it as "bad sensor, OK to dispatch" this morning. Seven hours later it threw **P0524, engine oil pressure too low**, which the fault-code reference rates *"Critical – stop vehicle immediately"*. Driving on low oil pressure can destroy the engine on the road.
   **Evidence from the data:**
   - P0217 over-temperature fired four days running, and the reading **climbed every day: 104 → 109 → 113 → 118 °C** (Sep 17–20). A steadily rising temperature points to a real overheating problem, not a faulty sensor.
   - WO-5540 replaced the coolant sensor and closed at 07:40 ET on Sep 21.
   - P0524 then fired at **96 kPa at 14:32 ET** the same day.
   - The vendor marked **every one** of these alerts MEDIUM, so the "vendor HIGH only" filter hid them.
   **Next action (who, by when):** The Maintenance Lead tags out **V-108 and V-137** tonight and inspects the cooling and oil systems; clearing codes isn't enough. The Operations Manager assigns spares for D-08 and D-37 before 6:00 a.m.

2. **Item:** Five **misfires (P0300) with no work order**: V-151, V-113, V-126, V-131 and V-111. The worst is **V-151**: it's misfiring *and* 2,350 km overdue for service.
   **Why it matters:** The reference says P0300 needs inspection *within 24 h*. These vehicles have been running for 2 to 12 days, and V-151's service isn't booked until **Oct 5**.
   **Evidence from the data:**
   - 8 vehicles logged P0300. 3 were handled: WO-5527, WO-5534, and WO-5543 for V-158, which is booked for tomorrow morning.
   - **5 have no work order, and 4 of those 5 are at Hamilton Depot.** Hamilton's alerts arrive late: 114 of 587 came in more than 1 h after the event, up to 30 h. The V-113 and V-131 misfires reached the platform 25–30 h after they happened, even though the vendor reports "normal connectivity".
   - V-151 shows `maintenance_due` +2,350 km and a P0300 on Sep 20 at 15:09 ET.
   - The Hamilton outage is now confirmed: the gateway held 10 alerts for up to 6.7 h before reconnecting at 6:47 p.m. ET.
   **Next action (who, by when):** Operations sends these to Maintenance from the dashboard tonight. V-151 is P1 (held from dispatch, service pulled forward). The other four are P2 (inspect by Tue Sep 22). Ops also makes sure V-158 is held at 6:00 a.m. IT opens a ticket with TrackLine about Hamilton's delays.

3. **Item:** **D-17 is not the worst driver.** Coach **D-49 and D-30** first.
   **Why it matters:** Disciplining the wrong driver costs trust and leaves the real risk on the road.
   **Evidence from the data:**
   - D-17 tops the raw count (81 events) only because D-17 drives the most km (3,650) on firmware **4.2.1**.
   - 4.2.1 logs **1.45 harsh-braking events per 100 km**, against **0.30 (4.1.8)** and **0.28 (4.3.0)**. The extra events are almost all light 0.40–0.45 g braking.
   - Counting only serious events (braking ≥ 0.6 g or over 115 km/h) per 100 km, **D-17 ranks #56 of 60**.
   - **D-49 (#3) and D-30 (#5)** each had 8 serious events, with braking up to 0.73–0.74 g, on the *less* sensitive firmware.
   **Next action (who, by when):** The Safety Manager reviews camera footage and coaches D-49 and D-30 this week, and uses the dashboard's Drivers view for the weekly list instead of raw counts. IT asks TrackLine to re-tune the 4.2.1 braking threshold.

## What changed after the new information

Hamilton's gateway reconnected at **6:47 p.m. ET** and delivered 10 held alerts (`hamilton_backfill.csv`). What changed:

- **Tonight's #1 changed.** The backfill held **V-108**'s P0217 overheat (107 °C) and P0524 low oil pressure (88 kPa), both critical, both marked MEDIUM by the vendor. V-108 is now the top case and is added to top-3 item #1, next to V-137.
- **New extreme speeding.** V-131 at 131 km/h and V-126 at **104 km/h in a 60 zone**. I added a rule: 40 km/h or more over a known posted limit counts as high, even when the speed is 115 km/h or below.
- **The outage is now a case of its own.** I added **network/communication failure cases per depot**. Any alert received more than 1 h after it happened is treated as held by a communication failure.
  - Hamilton gets a **critical** "gateway outage: 10 alerts held" case, listing the held alerts.
  - North Yard has 3 delayed alerts. Airport Hub had none.
  - Every case or alert that arrived late carries an **"Arrived after network restored"** or **"Arrived late"** tag, so teams know the timing is off.
- **Depot filter.** Every view (cases, low/medium, work orders, referrals, drivers, firmware) can be narrowed to North Yard, Airport Hub or Hamilton Depot. Cases show vehicle, class, driver and depot, and each depot gets its own ranked top 10.
- **Business Manager role.** Read-only oversight of every team's dashboard and metrics, with a per-depot overview.
- **"Now" moved** from 6:00 p.m. to 6:47 p.m. ET, when the backfill arrived.
- **What did *not* change:** the V-137 finding, the unworked misfires and the D-17 analysis all still hold. The backfill makes the Hamilton point stronger.

## What I built, and for whom

A local triage dashboard for the **Operations Manager** to use tonight and before the 6:00 a.m. dispatch, with separate views for the **Safety Manager** and the **Maintenance Lead**. You choose your team at sign-in, and the server only sends that team's data, so nobody sees another team's queue.

| Team | Sees | Can do |
| --- | --- | --- |
| **Operations** | **Tonight:** top 10 vehicle issues (engine faults, overdue service, unplugged devices) · **Backlog** · **Low & medium** (idling, camera) · **Activity** | Send an issue to Maintenance with a priority (P1 today / P2 48 h / P3 next service). **Bring in Safety** on any case, with a required note (e.g. daytime unplugs → talk to the driver). Add notes, mark resolved. Safety's replies and Maintenance's status, ETA and notes show on the case. |
| **Safety** | **Tonight:** top 10 driver issues (speeding over 115 km/h, braking ≥ 0.6 g) · **From Ops:** cases Operations referred, with their note and the evidence · **Firmware** policy · **Drivers** (risk per 100 km) · **Backlog** · **Low & medium** · **Activity** | Act on drivers and reply to Ops on referrals, send a referred case to Maintenance, or close it. **Advise maintenance** on any vehicle (a safety code, repeat pattern or change needed). Set the **minimum telematics firmware version** and send update requests for every vehicle below it (one work order per depot). |
| **Business Manager** | **Overview** (every team's metrics, cases per depot, network-affected counts, most urgent cases across teams) · read-only **Operations**, **Safety** and **Maintenance** views · **Activity** | Oversee only (no edits) |
| **Maintenance** | **Queue:** work orders sent by Ops and Safety, plus the shop's open ones, each with the evidence and repair history · **Closed** · **Activity** | Only approve work orders, set an estimated completion time, and add notes for Ops and Safety |

**Firmware minimum:** the vendor notes and the data give Safety what it needs to choose a version:
- **4.3.0** is the current release (24 vehicles, 0.28 harsh-braking alerts per 100 km).
- **4.2.1** logs about 5× more light braking (12 vehicles, 1.45 per 100 km), which skews driver scores.
- **4.1.8** is legacy (24 vehicles).

The dashboard recommends 4.3.0. Setting it as the minimum flags 36 vehicles, and one click sends Maintenance one update work order per depot. Requests aren't duplicated.

**How alerts are sorted:**
- **Critical:** engine faults rated critical in the reference (P0217, P0524), and any fault that comes back after a repair.
- **High:** every other engine fault, speeding over 115 km/h, braking at 0.6 g or more, overdue maintenance, and devices unplugged outside the vendor's 23:00–00:00 update window.
- **Medium / low:** speeding at 115 km/h or below, lighter braking, acceleration, cornering, idling, and camera offline. These go in their own section.

High and critical alerts are grouped into **cases**, one per vehicle problem or per driver, and ranked. Each team's tonight list is capped at the **10 things a day** Ops says it can handle.

**Colours:** red = critical, orange = high, yellow = medium, grey = low.

**Each card shows:** the next step, numbered action steps, evidence, and "keep in mind" notes, such as late Hamilton data, firmware sensitivity, or a Class 8 tractor that would strand a full load.

**Metrics** (shown live at the top of each view):
- **Workflow actions taken:** escalations, approvals, ETAs, notes and resolutions on the team's cases.
- **Primary:** high/critical cases resolved through the dashboard, out of all high/critical cases sent.
- **Guardrail:** cases sent vs. cases actioned. "Tonight actioned" turns **red** whenever more high/critical cases were sent than the team has acted on, so the tool can't look good by sending more alerts.
- **Maintenance sees:** work orders waiting for approval, approved work orders, and how many have an ETA.
- **Safety's Firmware view:** vehicles compliant with the minimum version, and how many have update requests.

The design follows iOS 26 Liquid Glass, styled to the dark smoked-glass reference with a lime accent:
- translucent glass panels over a dark background
- a glass sidebar on desktop and a floating tab bar on mobile
- a depot switcher at the top
- large titles
- cards that tap to expand
- light and dark mode
- support for the system's reduced-motion and reduced-transparency settings

## Assumptions I made

**Time**
- "Now" is Mon Sep 21 2026, 6:00 p.m. ET (22:00 UTC). September is Eastern Daylight Time, so local time = UTC − 4. Work-order times are already in Eastern.

**Cleaning the data**
- **Duplicates:** rows with the same vehicle, type, event time, value and fault code are the same event, even with different `alert_id`s. I removed 134. The vendor's "each alert is delivered exactly once" isn't true for this export.
- **Update window:** unplug and camera alerts between 23:00 and 00:00 local time are suppressed, per the vendor notes. The 52 unplugs at other times are high priority.
- **Negative `maintenance_due`** means "not due yet", per the vendor, so those alerts are suppressed.

**Severity rules**
- **Engine severity comes from `dtc_reference.csv`, not the vendor's label.** The vendor rated 5 critical faults below HIGH and 29 low-urgency P0420 faults as HIGH.
- **Speeding uses absolute speed** (the team's 115 km/h rule), because 83 speeding alerts have no posted limit.
- **Braking at 0.6 g or more is high.** In common fleet practice, about 0.4–0.5 g counts as harsh and 0.6 g or more is emergency-stop level. Firmware 4.2.1's extra events sit at 0.40–0.45 g, so this cut-off isn't distorted by firmware.

**Work orders**
- A work order "covers" an alert if its note names the fault code, mentions telematics or the harness (for unplug alerts), or is a service (for maintenance alerts).
- An alert *before* the work order closed counts as resolved; one *after* it closed counts as recurred.
- A new engine code within 7 days of an engine repair is flagged "after repair".

**Teams and capacity**
- Ops owns vehicle availability, so device and mechanical issues go to Ops, who escalates mechanical ones to Maintenance. Safety owns driver behaviour.
- The "about 10 things a day" capacity applies to each team's tonight list.
- Sign-in is a team picker for the demo. A real deployment would use the company's own logins; the server's role checks would stay the same.

## What I deliberately did NOT do (and why)

- **No AI inside the product.** The Safety Manager asked for "an AI that ranks every alert". Ranking 2,370 alerts high/medium/low *is* today's problem: it's still 2,370 things to read. Transparent rules grouped into a capped list of cases can be explained and audited at 6 a.m., and they need no API key.
- **Didn't trust the team's or the vendor's claims without checking:** "V-137 was a bad sensor", "D-17 is the worst driver", "only vendor HIGH matters", "exactly-once delivery" and "normal connectivity". The data contradicts all five.
- **No cross-team visibility.** Ops and Safety don't see the Maintenance board, and Maintenance doesn't see their queues, to avoid confusion. Updates flow through work orders.
- **No database, hosting or sign-in system.** The brief asked for the smallest useful thing that runs locally. Workflow state is a JSON file.
- **No automatic dispatch changes.** The tool recommends; people decide.

## How I checked it's correct

- **`npm test` (14 checks):**
  - every sorting rule at its boundary: 115 vs 116 km/h, 0.6 g, the update window in UTC, negative maintenance km
  - duplicate removal
  - the dataset recomputes to 2,370 → 134 duplicates → 2,236
  - V-137 is #1, with its four earlier P0217 faults shown
  - V-114's P0217 is resolved by WO-5519 and doesn't create a case
  - D-17 ranks #1 on raw counts but not on the per-100-km measure
  - tonight's list holds 10
  - **permissions:** Maintenance can't escalate or resolve, Ops can't approve, and Safety can't act on an Ops case
  - **visibility:** Ops and Safety receive no work-order board, Maintenance receives no cases, and driver and firmware data are Safety-only
  - **referrals:** Ops must include a note; Safety can reply and send the case to Maintenance; Ops sees Safety's reply and the work order
  - **firmware:** a 4.3.0 minimum flags exactly 36 vehicles (24 on 4.1.8 + 12 on 4.2.1), creates one work order per depot, and won't create duplicates
- **Recomputed key numbers** with separate exploration scripts in `scratch/` before building: duplicates, delays by depot, braking per 100 km by firmware, unplug times in local time.
- **Clicked through in the browser:**
  - signed in as Ops and sent V-137 to Maintenance; signed in as Maintenance and saw only the work-order queue, with V-137's evidence and repair history
  - as Ops, brought in Safety on V-137's daytime unplugs; as Safety, saw the referral with Ops' note and set the firmware minimum to 4.3.0
- **Caught a wrong number in the README** by rerunning the code: the P0420 count was first written as 42, and the real figure is 29.

## AI use
- **Tools I used: Claude Code**
- **What AI did for me: Built the dashboard, read further into the data to action into the dashboard, set user permissions/visibility, pushed to github**
- **One thing AI got wrong or incomplete, and how I caught it: Dashboard was initially created and any user could select their role and view extensive amounts of data pointing to confusion.**
- **Link to / export of my AI session:** Exported from the Claude desktop app and submitted with the Final Submission form. It isn't committed to this public repo because the session log contains a credential that was revoked.

## If I had two more days

* build a cleaner dashboard with less confusion across the board
* created workflow automations into any other programs that safety/ops/maintanence might use to further ease actioning the alerts
