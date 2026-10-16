# Maple Freight: Zack Telsem

## How to run it

There are two ways to see the build.

**Option 1: run it on your computer (recommended).** This is the full version. Everyone using the same computer or network shares one live board: an escalation from Operations shows up for Maintenance. It also picks up new data files on its own, and the server checks every permission.

Install **Node.js 18 or newer**. Nothing else is needed: no packages, no API keys.

```bash
git clone https://github.com/zackt223/maple.git
cd maple
npm start
```

Open http://localhost:3000, pick a user, and press **Enter** on the password screen (no password is set).

Optional:

```bash
npm run report   # tonight's top 10 in the terminal
npm test         # 24 automated checks
```

To clear all escalations, notes and costs, delete `state.json` and restart.

**Option 2: view it online on GitHub Pages (quickest, nothing to install).** Open https://zackt223.github.io/maple/. It looks and works the same, but it runs entirely in your browser, so each browser keeps its own escalations, notes and costs, and other people won't see them. Use it for a quick look or a demo. After changing anything in `data/` or `public/`, run `npm run build:pages` and push `docs/` to update it.

## Tonight's top 3 for Maple Freight

1. **Item:** Pull **V-108** (Hamilton) and **V-137** (North Yard) from the 6:00 a.m. dispatch.
   **Why it matters:** Both trucks overheated and then lost oil pressure. The fault-code list says to stop the vehicle immediately. Driving on, they risk engine failure on the road.
   **Evidence from the data:** V-137 ran hotter every day from Sep 17 to 20 (104 → 109 → 113 → 118 °C). The shop replaced a sensor and cleared it at 7:40 a.m. on Sep 21, and at 2:32 p.m. it lost oil pressure (96 kPa). V-108 hit 107 °C at 12:05 p.m. and lost oil pressure (88 kPa) at 3:41 p.m. Its alerts were stuck in Hamilton's outage until 6:47 p.m. The vendor marked all of these MEDIUM, so a "HIGH only" filter misses them.
   **Next action (who, by when):** Operations first confirms where both trucks are: V-137 was in use at 10:40 and 11:37 a.m. after being cleared, and V-108 at 1:09 p.m. after overheating. The Maintenance Lead then tags out both trucks tonight and checks cooling and oil before they move. The Operations Manager assigns spare trucks for drivers D-08 and D-37 before 6:00 a.m.

2. **Item:** Five trucks with engine misfires (P0300) have no work order: V-151, V-113, V-126, V-131 and V-111.
   **Why it matters:** A misfire should be inspected within 24 hours. These have been running for 2 to 12 days.
   **Evidence from the data:** 8 trucks logged a misfire; only 3 have work orders. 4 of the 5 without one are at Hamilton, where alerts reach the office up to 30 hours late. V-151 is also 2,350 km overdue for service, and its service isn't booked until Oct 5.
   **Next action (who, by when):** The Operations Manager sends all five to Maintenance tonight. V-151 is held from dispatch and its service moved up; the other four are inspected on Tuesday, Sep 22. V-158, which also has a misfire, is held at 6:00 a.m. because its repair is booked for the same morning.

3. **Item:** D-17 is not the worst driver. Coach **D-49** and **D-30** first.
   **Why it matters:** Coaching the wrong driver wastes time and leaves the risky ones on the road.
   **Evidence from the data:** D-17 has the most alerts (81) because D-17 drives the most (3,650 km) on device software version 4.2.1, which logs about 5 times more light braking than the other versions. Counting only serious events (hard braking or over 115 km/h) per 100 km driven, D-17 ranks 56th of 60. D-49 and D-30 each had 8 serious events, with braking up to 0.74 g.
   **Next action (who, by when):** The Safety Manager reviews camera footage and coaches D-49 and D-30 this week.

## What I built, and for whom

A dashboard for the **Business Manager**, **Operations**, **Safety**, **Maintenance**, and **Sales & Finance**. Each user signs in and only sees their own work.

- **Operations:** tonight's top 10 vehicle problems. Ops can send a problem to Maintenance, bring in Safety with a note, and mark it resolved.
- **Safety:** tonight's top 10 driver problems, cases sent over by Operations, a driver ranking, and the minimum device software version allowed on the road.
- **Maintenance:** only the work orders sent to them. They can approve, set a finish time and add notes.
- **Sales & Finance:** every work order with its cost, plus an audit log for quarterly reviews. They can export both to a spreadsheet.
- **Business Manager:** sees every team, depot and number.

Every view can be narrowed to **North Yard**, **Airport Hub** or **Hamilton Depot**. An **All alerts** page filters by driver, vehicle and yard.

Charts show daily alert trends and can be **exported as PNG or JPEG** for pitch decks and presentations.

Alerts are colour-coded: red = critical, orange = high, yellow = medium, grey = low.

Every alert has an **AI note**: one or two plain sentences on what it means and what to do. The notes are written by fixed rules in the code, not by a live AI service, so they need no API key and always give the same answer.

It also handles problems hidden in the data. These are listed under **AI use** below.

The truck photo in the background is blurred so the dashboard is easy to read.

## Assumptions I made

- All data provided was taken as set; no changes to the files would be needed. Where the data disagreed with itself, I chose the more reliable source:
  - 134 duplicate alerts were counted once.
  - Fault-code urgency came from the fault-code list instead of the vendor's label.
  - Times are Eastern.
- I first assumed no Business Manager, Sales or Finance role was needed. I later realized those roles must exist, so I added them.
- I first assumed no charts were needed. I added them with an export option so the data can be used in pitch decks and presentations.
- Speeding over 115 km/h, or 40+ km/h over the posted limit, is high. Braking at 0.6 g or more is high.
- Operations can act on about 10 things a day, so each team's tonight list holds 10.

## What I deliberately did NOT do (and why)

- I didn't connect the dashboard to the other software Safety, Maintenance and Operations may use. Those systems weren't known, and the work wasn't feasible in a 90-minute build.

## How I checked it's correct

- Loaded all the data into the dashboard and reviewed it, then worked alerts end to end: sent them to Maintenance, brought in Safety, and approved them as Maintenance.
- Filtered alerts by driver, vehicle and yard.
- Exported the charts as PNG and JPEG.
- Signed in as each user to confirm they only see and change what they should.
- Re-checked the numbers with a separate script (`scratch/validate.js`) and 24 automated tests (`npm test`), including one for each edge case listed under AI use.

## AI use
- **Tools I used:** Claude Code
- **What AI did for me:** Built the dashboard, read further into the data to action into the dashboard, set user permissions/visibility, pushed to GitHub.
- **One thing AI got wrong or incomplete, and how I caught it:** There was no user role for business managers / admin to oversee the entire dashboard and its metrics. Sales or finance also could not look into maintenance work order costs, or audit and cross-check data when quarterly reviews start. After reviewing the build, I noticed the gap and built business manager / admin / sales / finance roles with appropriate permissions for each user (view, edit, delete) to avoid last-minute issues.
- **Link to / export of my AI session:** [`ai-session/prompts-and-outputs.txt`](ai-session/prompts-and-outputs.txt): every prompt I sent and every written reply from Claude Code, in order. Email addresses and tokens are redacted. The full export from the Claude app was also submitted with the Final Submission form.

### Edge cases Claude Code caught, and the fixes I approved

| Edge case | Fix |
| --- | --- |
| **Work-order IDs could be reused (bug).** Deleting a pending request could let the next request take an existing ID and overwrite that work order. | IDs now always count up from the highest one ever issued. Tested. |
| **Driver numbers don't match vehicle numbers.** D-17 drives V-142, and V-117 is driven by D-42. | The AI note on each of these alerts says which truck the driver actually drives. |
| **V-137 went back on the road after it was cleared.** It logged harsh cornering at 10:40 and 11:37, so it may not be parked at the depot. | Trucks used after a stop-the-vehicle fault or repair get a "find it now" step. This also caught V-108, in use at 1:09 p.m. after overheating. |
| **Late data can reorder tonight's list.** Hamilton may still be holding alerts. | Each depot shows when it last sent data. The dashboard reloads by itself when new data arrives. |
| **No data isn't the same as no problem.** V-102 has no telematics unit, and an unplugged device looks "quiet". | Trucks with no alerts for 36+ hours are flagged so someone checks the unit (V-128, V-110, V-159). V-102 is marked out of service. |
| **Real unplugs between 23:00 and midnight were hidden** by the vendor's update-window rule. | They're now shown as low. A truck that does it night after night is high: V-118, 11 nights, the only truck that does this. |
| **The time zone was fixed at UTC−4.** Daylight time ends Nov 1, after which times would be an hour off. | Times now follow real Eastern time, including the change. Tested. |
| **96 engine faults have no reading,** so they can't be tracked over time. | The AI note says so on each one. |
| **V-158's repair is booked for the same morning as dispatch.** | "Hold V-158 from the 6:00 a.m. dispatch" is on tonight's list. V-151's late booking (Oct 5) gets "move it up". |
| **A 4.3.0 firmware minimum would make 36 of 60 vehicles non-compliant at once.** | Updates are requested in phases (4.2.1 first) and don't stop trucks from running. |
| **A network outage could be sent to the maintenance shop** (found in the final review). | Network and "not reporting" problems can't be sent to maintenance; they go to IT and the vendor. Tested. |

## If I had two more days

- Build a cleaner dashboard with less confusion across the board.
- Create workflow automations into the other programs Safety, Operations and Maintenance use, to make acting on alerts easier.

## What changed after the new information

Filtered in the three depots as a factor, so each alert shows vehicle details, driver details and the depot. This lets Maple Freight teams work by location.

It also flags communication / network failures at each location, and marks any alerts that came in after the network was restored.

The 10 alerts Hamilton held until 6:47 p.m. included V-108's overheating and oil-pressure faults, so V-108 was added to tonight's #1.
