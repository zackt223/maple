# Maple Freight: Zack Telsem

## How to run it

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
npm test         # 22 automated checks
```

To clear all escalations, notes and costs, delete `state.json` and restart.

## Tonight's top 3 for Maple Freight

1. **Item:** Pull **V-108** (Hamilton) and **V-137** (North Yard) from the 6:00 a.m. dispatch.
   **Why it matters:** Both trucks overheated and then lost oil pressure. The fault-code list says to stop the vehicle immediately. Driving on, they risk engine failure on the road.
   **Evidence from the data:** V-137 ran hotter every day from Sep 17 to 20 (104 → 109 → 113 → 118 °C). The shop replaced a sensor and cleared it at 7:40 a.m. on Sep 21, and at 2:32 p.m. it lost oil pressure (96 kPa). V-108 hit 107 °C at 12:05 p.m. and lost oil pressure (88 kPa) at 3:41 p.m. Its alerts were stuck in Hamilton's outage until 6:47 p.m. The vendor marked all of these MEDIUM, so a "HIGH only" filter misses them.
   **Next action (who, by when):** The Maintenance Lead tags out both trucks tonight and checks cooling and oil before they move. The Operations Manager assigns spare trucks for drivers D-08 and D-37 before 6:00 a.m.

2. **Item:** Five trucks with engine misfires (P0300) have no work order: V-151, V-113, V-126, V-131 and V-111.
   **Why it matters:** A misfire should be inspected within 24 hours. These have been running for 2 to 12 days.
   **Evidence from the data:** 8 trucks logged a misfire; only 3 have work orders. 4 of the 5 without one are at Hamilton, where alerts reach the office up to 30 hours late. V-151 is also 2,350 km overdue for service, and its service isn't booked until Oct 5.
   **Next action (who, by when):** The Operations Manager sends all five to Maintenance tonight. V-151 is held from dispatch and its service moved up; the other four are inspected on Tuesday, Sep 22.

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
- Re-checked the numbers with a separate script (`scratch/validate.js`) and 22 automated tests (`npm test`).

## AI use
- **Tools I used:** Claude Code
- **What AI did for me:** Built the dashboard, read further into the data to action into the dashboard, set user permissions/visibility, pushed to GitHub.
- **One thing AI got wrong or incomplete, and how I caught it:** There was no user role for business managers / admin to oversee the entire dashboard and its metrics. Sales or finance also could not look into maintenance work order costs, or audit and cross-check data when quarterly reviews start. After reviewing the build, I noticed the gap and built business manager / admin / sales / finance roles with appropriate permissions for each user (view, edit, delete) to avoid last-minute issues.
- **Link to / export of my AI session:** Exported from the Claude desktop app and submitted with the Final Submission form. It's not in this public repo because the session log contains a credential that was revoked.

## If I had two more days

- Build a cleaner dashboard with less confusion across the board.
- Create workflow automations into the other programs Safety, Operations and Maintenance use, to make acting on alerts easier.

## What changed after the new information

Filtered in the three depots as a factor, so each alert shows vehicle details, driver details and the depot. This lets Maple Freight teams work by location.

It also flags communication / network failures at each location, and marks any alerts that came in after the network was restored.

The 10 alerts Hamilton held until 6:47 p.m. included V-108's overheating and oil-pressure faults, so V-108 was added to tonight's #1.
