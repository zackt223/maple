# Maple Freight: What needs attention today

A local, role-aware triage dashboard for Maple Freight's telematics alerts. It takes 14 days of alerts (2,370 rows) and turns them into a **ranked list of 10 cases for tonight**. Each case has action steps for Operations, Safety and Maintenance. A server-enforced workflow lets Ops and Safety escalate cases to Maintenance and track them through approval, ETA and notes. Low and medium alerts go to their own section, so the main queue stays workable.

## How to run it

Needs **Node.js 18+** only. There are no dependencies, no `npm install` step and no API keys.

```bash
git clone https://github.com/zackt223/maple.git
cd maple
npm start          # dashboard → http://localhost:3000
npm run report     # same ranking printed in the terminal
npm test           # 12 checks: rules, data counts, permissions
```

To reset the workflow (escalations, notes, approvals), delete `state.json` and restart.

Sample `npm run report` output (abridged):

```
Maple Freight: what needs attention (Mon Sep 21 2026, 6:00 p.m. Eastern)
2370 raw alerts → 134 duplicates removed → 2236 unique → 204 high/critical cases → top 10 tonight

#1 [CRITICAL] Engine fault P0524 on V-137  (maintenance; V-137, D-37, North Yard; last 2026-09-21 14:32 ET)
    New fault P0524 after WO-5540 (Replaced coolant temperature sensor) closed 2026-09-21 07:40
    → Maintenance: pull V-137 from tomorrow's 6:00 a.m. dispatch and tag out.
#2 [HIGH] V-151 service overdue 2350 km  (maintenance; V-151, D-51, Hamilton Depot; last 2026-09-21 06:00 ET)
    WO-5541 Scheduled: Booked for 2026-10-05 (next open bay).
#3 [HIGH] Engine fault P0300, P0171, P0420, P0128 on V-113  (maintenance; ... Hamilton Depot)
...
D-17: raw-count rank #1, serious-events-per-100-km rank #56 of 60
Hamilton Depot: 114/587 alerts arrived >1 h late (max 30 h)
```

## Tonight's top 3 for Maple Freight

1. **Item:** Ground **V-137** before the 6:00 a.m. dispatch.
   **Why it matters:** The shop cleared it as "bad sensor, OK to dispatch" this morning. Seven hours later it threw **P0524 (engine oil pressure too low)**, which the reference rates *"Critical – stop vehicle immediately"*. Low oil pressure can destroy the engine, and the vehicle could fail on the road.
   **Evidence from the data:** P0217 over-temperature on four straight days, and the reading climbed every day: **104 → 109 → 113 → 118 °C** (Sep 17–20). A steadily rising trend points to a real overheating problem, not a faulty sensor. WO-5540 replaced the coolant sensor and closed at 07:40 on Sep 21. P0524 then fired at **96 kPa at 14:32 ET** the same day. The vendor marked every one of these alerts **MEDIUM**, so the Maintenance Lead's "vendor HIGH only" filter never showed them. V-137 also had 3 daytime telematics unplugs.
   **Next action:** Maintenance Lead tags out V-137 tonight and inspects the cooling and oil systems (don't just clear codes). The Operations Manager assigns a spare for D-37's 6:00 a.m. route.

2. **Item:** **Unworked misfires (P0300)**: V-151, V-113, V-126, V-131 and V-111. The worst is **V-151**: misfiring *and* 2,350 km overdue for service.
   **Why it matters:** The reference for P0300 says *"inspect within 24 h"*. These vehicles have been running for 2 to 12 days with no work order. V-151's service isn't booked until **Oct 5**, two weeks away.
   **Evidence from the data:** Of the 8 vehicles with P0300, 3 were handled (WO-5527, WO-5534, and WO-5543 for V-158 tomorrow). **5 have no work order, and 4 of those 5 are at Hamilton Depot.** Hamilton's alerts arrive late (see #3). The V-113 and V-131 misfires reached the platform **25–30 hours after they happened**, which probably explains why nobody acted on them. V-151: `maintenance_due` = **+2,350 km** on Sep 21, plus P0300 on Sep 20 at 15:09 ET.
   **Next action:** Maintenance Lead keeps V-151 off tomorrow's dispatch and pulls its Service A forward. Book inspections for V-113, V-126, V-131 and V-111 on Tue Sep 22. Make sure V-158 (WO-5543) is also held at 6:00 a.m.

3. **Item:** Don't act on "D-17 is our worst driver." Coach **D-49 and D-30** instead, and fix the firmware signal.
   **Why it matters:** Disciplining the wrong driver costs trust and leaves the real risk on the road.
   **Evidence from the data:** D-17 tops the raw count (81 events) for two reasons. D-17 drives the most km in the fleet (3,650), and V-142 runs firmware **4.2.1**. That firmware logs **1.45 harsh-braking events per 100 km**, against **0.30 (4.1.8)** and **0.28 (4.3.0)**, almost all of them light 0.40–0.45 g events. Counting only serious events (braking ≥ 0.6 g or speed > 115 km/h) per 100 km, **D-17 ranks #56 of 60**. D-49 (#3, 8 serious events, braking up to 0.73 g) and D-30 (#5, 8 serious, up to 0.74 g) are real concerns, and their vehicles run the *less* sensitive firmware.
   **Next action:** Safety Manager reviews camera footage this week for D-49 and D-30 (both are in the dashboard with evidence). Use the Drivers tab, not raw counts, for the weekly list. IT asks TrackLine to re-tune or roll back the 4.2.1 harsh-braking threshold.

Also tonight: **Hamilton Depot data is delayed by up to 30 hours**, even though the vendor says "normal connectivity". IT should open a ticket with TrackLine. Until then, assume Hamilton's picture is incomplete.

## Metrics

The dashboard shows these live at the top of the page, computed from the workflow log.

| Metric | Definition | Where it shows |
| --- | --- | --- |
| **Workflow actions taken** | Count of actions taken through the workflow to resolve issues: escalations, approvals, ETAs, notes, resolutions | "Workflow actions taken" card and the Activity tab |
| **Primary: high/critical cases resolved through the dashboard** | Resolved cases ÷ all high/critical cases sent (204) | "Primary · resolved via dashboard" card |
| **Guardrail: high alerts sent vs. workflow actions taken** | % of high/critical cases sent that got at least one workflow action. Shown for tonight's 10 and for all 204. It turns **red** when more cases were sent than actioned. | "Guardrail · sent vs actioned" card |

The guardrail exists so the tool can't "win" by sending more alerts. If the team falls behind the queue, it shows red.

## What I built, and for whom

**Primary user: the Operations Manager**, tonight and again before the 6:00 a.m. dispatch, with Safety and Maintenance as the teams they hand work to.

- **Tonight (10):** the ranked top 10 high/critical *cases*. Alerts are grouped by vehicle (engine, maintenance, device) or by driver (speeding, braking). Each case shows priority colour, owner team, numbered action steps and expandable evidence. Engine cases also show the earlier repair history.
- **High & critical backlog:** the other 194 cases, ranked, to pull from once tonight's list is done.
- **Maintenance:** escalated cases arrive as `Pending approval` work orders, next to the shop's own work orders.
- **Low & medium:** 1,743 alerts that aren't urgent and aren't tied to any work order. They can be filtered by priority, type and depot.
- **Drivers:** risk normalized per 100 km and adjusted for firmware.
- **Activity:** a log of every workflow action, which feeds the metrics.
- **Data checks** panel: what in the export I didn't take at face value.

**Colour coding:** red = critical, orange = high, yellow = medium, grey = low or suppressed. It's used on the card stripe, the pills and the table dots.

**Roles and permissions** (enforced by the server in `src/server.js`; the UI only hides buttons):

| Role | Can | Cannot |
| --- | --- | --- |
| Operations Manager | Escalate a case to Maintenance with a priority (P1 today / P2 48 h / P3 next service), add notes, mark resolved | Approve work orders, set ETAs |
| Safety Manager | Same as Operations | Same as Operations |
| Maintenance Lead | Approve work orders, set an estimated completion time, add notes that Ops and Safety see on the case | Escalate, resolve or edit cases |

**Classification rules** (all in `src/triage.js` → `RULES` / `classify`):

| Alert | Critical | High | Medium | Low / suppressed |
| --- | --- | --- | --- | --- |
| engine_fault | DTC reference "Critical" (P0217, P0524) | every other code (High/Medium/Low DTCs ranked lower inside High) | | |
| speeding | | > 115 km/h | ≤ 115 km/h | |
| harsh_braking | | ≥ 0.6 g (emergency-stop level) | 0.45–0.59 g | < 0.45 g |
| maintenance_due | | overdue (> 0 km) | | ≤ 0 km is suppressed (not due) |
| device_unplugged | | outside the 23:00–00:00 ET update window | | inside the window is suppressed |
| camera_offline | | | outside the window | inside the window is suppressed |
| harsh_accel / cornering | | | ≥ 0.5 g | < 0.5 g |
| idling | | | ≥ 60 min | < 60 min |

A case becomes **critical** when it has a critical code, or when a fault recurs after a work order closed.

Cases are ranked by a score: base severity, plus recency, plus repeat count and magnitude, plus "recurred after repair" and "no work order yet". DTCs rated Low urgency (P0420, P0128) are pushed down.

## Assumptions I made

- **"Now" is Mon Sep 21 2026, 18:00 ET (22:00 UTC).** September is EDT, so local time = UTC − 4. Work-order times are already Eastern.
- **Duplicates:** two rows with the same vehicle, type, event time, value and DTC are the same event, even with different `alert_id`s. That's 134 rows, removed. The vendor's "exactly once" claim is false.
- **The vendor's OTA window is real:** unplug and camera alerts between 23:00 and 00:00 local time are suppressed. Unplugs at any other time (52) are high priority.
- **Engine severity comes from `dtc_reference.csv`, not `vendor_severity`.** The vendor rated 5 critical-code faults below HIGH and 29 low-urgency P0420 faults as HIGH.
- **Speeding uses absolute speed** (the team's 115 km/h rule), because 83 speeding alerts have no posted limit.
- **Harsh braking ≥ 0.6 g is high.** In general fleet practice, roughly 0.4–0.5 g counts as "harsh" and ≥ 0.6 g is emergency-stop or near-collision territory. In this data, the 4.2.1 firmware excess sits almost entirely at 0.40–0.45 g, so a 0.6 g cut-off isn't distorted by firmware.
- **A work order "covers" an alert** if its note names the DTC, mentions telematics/harness for unplug alerts, or is a service for maintenance alerts. An alert *before* the work order closed counts as resolved. One *after* it closed counts as recurred. A different engine code within 7 days of an engine repair is flagged "after repair".
- **Ops capacity is 10 a day,** so the "Tonight" list is capped at 10 *cases*, not 10 alerts.
- **Logins are demo user switches.** A real deployment would use the company's sign-in system; the role checks would stay as they are.

## What I deliberately did NOT do (and why)

- **No AI/LLM in the product.** The safety manager asked for "an AI that ranks every alert". The ranking has to be explainable and repeatable, and you have to be able to audit it at 6 a.m. Transparent rules do that better, and they need no API key. AI was used to build it (see below).
- **I didn't rank every alert for humans to read.** Ranking 2,370 alerts high/medium/low is the current problem, not the fix. The tool groups alerts into cases and caps the list at the team's capacity.
- **I didn't trust vendor severity or the vendor notes blindly** (delivery, connectivity, severity). Each one was checked against the data.
- **No database, no hosting, no sign-in system.** The brief asked for the smallest useful thing that runs locally. Workflow state lives in a JSON file.
- **No automatic dispatch changes.** The tool recommends; people decide.

## How I checked it's correct

- `npm test`: 12 automated checks:
  - each classification rule at its boundary (115 vs 116 km/h, 0.6 g, the OTA window in UTC, negative maintenance km)
  - dedupe behaviour
  - dataset counts (2,370 → 134 duplicates → 2,236)
  - V-137 is #1 with 4 prior P0217 events in its history
  - V-114's P0217 is resolved by WO-5519 and does not create a case
  - D-17 ranks #1 raw but not when normalized
  - tonight's list = 10
  - the permissions matrix: Maintenance can't escalate or resolve, Ops can't approve, and an escalation creates a Pending approval work order
- I recomputed key numbers with separate exploration scripts (`scratch/`) before writing the engine: duplicates, lag per depot, braking per 100 km per firmware, unplug hours in local time.
- I checked the dashboard in a browser: escalated V-137 as Ops, approved it and added an ETA and note as Maintenance, confirmed the note and ETA show on Ops' card, and confirmed the server returns **403** when Ops tries to approve a work order.

## AI use

- **Tools I used:** Claude Code (Claude Opus 5.5) in the Claude desktop app.
- **What AI did for me:** Claude explored the CSVs with Node scripts (duplicates, latency, firmware rates, unplug timing). It wrote the triage engine, server, dashboard UI (following Apple's interface design guidance), tests and the first draft of this README. I set the requirements: the 115 km/h speeding rule, putting engine faults, maintenance and unplugged devices in the high section, a separate low/medium section, Maintenance as its own section with escalation from Ops and Safety, role permissions, the three metrics, and a colour-coded Apple-style UI. Claude chose the 0.6 g braking threshold, as I asked it to.
- **One thing AI got wrong or incomplete, and how it was caught:** Claude's first ranking put V-151's misfire (P0300, *"inspect within 24 h"*, no work order) at #14, below routine driver-coaching cases. It caught this when checking the top 10 against the DTC reference, and added a boost for High-urgency faults with no open work order. Separately, it first quoted 42 for "low-urgency P0420 faults marked HIGH" in this README. Recomputing from the code gave 29, and the README was corrected. Its first test command (`node --test test/`) also didn't run on Node 24.
- **Link to / export of my AI session:** exported from the Claude desktop app as `session-export-1792172875887.zip` and submitted with the Final Submission form. It is not committed here because the session log contains a credential that had to be revoked.

## If I had two more days

- Pull work orders from the shop system live, so "covered by a work order" is always current. Add a "dispatch hold" list Ops can print at 5:45 a.m.
- Watch data freshness per depot, and show a banner when a depot's newest alert is more than an hour old (Hamilton).
- Calibrate harsh-event thresholds per firmware version with TrackLine, and backtest the ranking against incidents and repairs.
- Real sign-in through the company's existing logins, plus an audit export of the activity log.
- Notifications for P1 escalations, and an overdue-ETA alert back to Ops.
