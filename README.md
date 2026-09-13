# Smart Commuter Companion — RailPulse

A local Singapore train and bus journey planner using LTA DataMall. It compares scheduled train journeys with direct bus options, monitors service advisories, and displays station crowd levels and bus arrivals.

## Run locally

Requires Node.js 20 or later and an LTA DataMall AccountKey.

```sh
npm ci
```

Copy `.env.example` to `.env` and set `LTA_DATAMALL_API_KEY`. `.env` is ignored by Git and is never served to the browser.

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000). Use `npm run dev` for automatic backend restarts. Refresh the browser after frontend edits. `PORT` defaults to 3000.

## What works

- **Phone and laptop layouts:** full-height Plan and Buses views with bottom navigation on phones; a floating side panel beside the map on laptops. Phone station selection is searchable by name or code, and bus arrivals use readable rows with crowd levels. Map is one tap away, and returning to Plan retains journey results and scroll position. The phone layout adapts to short screens and the visible keyboard viewport. A saved light/dark preference works across both layouts. The bus-arrivals tab is independent of the train-only journey filter and shares the wheelchair requirement.
- **Train only:** plan a scheduled train journey with disruption checks and station crowd levels, without fetching bus alternatives or showing bus results.
- **Journey preferences stay open:** the settings section is always expanded. Keep the time/walking/transfer priority, choose a maximum estimated walk at each end of a bus alternative (250 m–1.5 km, or automatic), select a walking/rolling pace (3, 4.5 or 6 km/h), and allow 4–30 minutes for every train transfer. Controls that do not apply to the journey mode are hidden. The transfer allowance also applies to departure-time comparisons without requiring wheelchair mode.
- **Bus comfort filters:** “Avoid high crowding” accepts LTA `SEA` or `SDA`; “Seats reported available” accepts `SEA`. These are strict filters on upcoming predictions, shared with the Buses tab. Missing, expired or stale crowd readings do not qualify. The search may choose a later matching bus or return no matching arrivals. Seats and wheelchair-bay space are not reserved or guaranteed.
- **Remember preferences:** optional, off by default. Saves just the selected settings in this browser's local storage, without requiring login. Unchecking removes that copy; Reset restores defaults and turns remembering off. This does not save routes or locations, or sync to another device.
- **Compare departure times:** choose two stations, then compare six half-hour options starting at a chosen Singapore date/time. Each row shows scheduled journey duration, arrival time and LTA's station crowd forecast, with expandable train details. A quieter option is highlighted only when available forecasts differ. Phone comparisons open full screen; laptops use a centred dialog.
- **Nearby road alerts:** check LTA Traffic Incidents within 1.5 km of the boarding station or a bus stop. Open them from the time comparison or the next-buses checker. These are current incident reports, not a congestion score or a forecast for a future bus journey.
- **Wheelchair access:** an independent requirement for any journey mode. Filter bus arrivals using LTA’s `Feature=WAB`, check live lift-maintenance notices at boarding/transfer/destination stations, and avoid platform transfers at stations with reported lift outages. Choose a train transfer allowance of 4–30 minutes (default eight when enabled). Your time/transfer preference remains separate.
- **Train & bus:** select two active train stations and compare a scheduled train itinerary with nearby direct bus services. Choose shorter travel time, less walking, or fewer train transfers.
- **Bus only:** search bus stops by name or code, then find direct services between them.
- **Next buses:** show the next three arrivals, LTA occupancy categories, single/double/bendy bus type, and the provider’s monitored/scheduled indicator.
- **Bus crowding:** prominent crowd indicators on journey cards and each upcoming bus. Low = `SEA` (seats available), moderate = `SDA` (standing available), high = `LSD` (limited standing). These app labels map directly to LTA categories, not measured percentages. Unknown values stay unavailable, and cached or passed-arrival readings are marked old.
- **Journey monitoring:** refresh the selected journey every 30 seconds while the page is visible. Check every train segment against every reported affected segment and look for an alternative train route. Surface relevant textual service advisories for review.
- **Train timetable:** use GTFS service calendars, date exceptions, directed trips, platform transfers and trips after midnight. Include only stations served by active trips for the current Singapore date.
- **Station crowding:** show low/moderate/high or unavailable, with the source observation interval. Old readings are marked. This describes station crowding, not carriage occupancy.
- **Map:** display LTA station/stop coordinates and schematic connections on a muted street map. Selected routes use thick outlined lines, A/B endpoints and numbered transfers with station names in the route legend. Other lines and stations fade, and “Fit route” restores the journey view. Two MRT/LRT interchanges represented by separate parents in GTFS are joined: Choa Chu Kang and Bukit Panjang.

## Where each result comes from

| Display | Source | Meaning |
| --- | --- | --- |
| Train stations, trips, departure and arrival times | `GTFSScheduleTrain` → LTA ZIP | Published schedule, **not live train prediction** |
| Service notices and affected segments | `TrainServiceAlerts` | Current LTA service advisories |
| Station crowd levels | `PCDRealTime` | LTA observations at ten-minute intervals |
| Future station crowd levels | `PCDForecast` | LTA's daily forecast in 30-minute intervals; exact station and forecast date must match |
| Nearby road alerts | `TrafficIncidents`, all pages | Current reported incidents within 1.5 km; no reports does not mean roads are clear |
| Lift-maintenance notices | `v2/FacilitiesMaintenance` | LTA reported lift outages; no report does not guarantee a working step-free path |
| Bus stop names and coordinates | `BusStops`, all pages | LTA reference data |
| Bus direction, stop order and route distance | `BusRoutes`, all pages | Published LTA service routes |
| Bus arrival, occupancy and vehicle type | `v3/BusArrival` | Provider prediction; `Monitored` distinguishes live and scheduled arrivals |
| Total bus journey duration | App calculation | **Estimate:** provider arrival + estimated ride + final walk |
| Basemap | OpenStreetMap via Leaflet | Map tiles; overlays are schematic |

The backend downloads train timetables and the full bus reference datasets to the ignored `.cache/` directory and refreshes them daily. Live data uses shorter caches: arrivals 20 seconds, alerts 30 seconds, crowd readings 10 minutes. Responses include `updatedAt` and `stale`. A failed refresh may return a labelled cached real response; with no real cache, the API returns an error. **The app never substitutes mock data for unavailable live data.**

Lift-maintenance data is cached for one minute. Failed or stale lift checks are explicitly marked. Wheelchair-equipped bus filtering also applies to the standalone next-buses search. Missing accessibility flags are treated as unconfirmed, not as proof that a vehicle is inaccessible.

Station forecasts are cached for 30 minutes, with a separate key for each Singapore date; road incidents for two minutes. `GET /api/travel-times?origin=EW24&destination=EW23` defaults to the next half-hour. Optional `start` uses `YYYY-MM-DDTHH:00:00+08:00` or `HH:30` (URL-encode the `+`); it accepts the coming seven days. It also accepts `wheelchair`, `transferMinutes` and `preference`. `GET /api/road-conditions?BusStopCode=01012` checks current reports near that stop.

Source documentation: [LTA DataMall API guide](https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf), [GTFS schedule reference](https://gtfs.org/documentation/schedule/reference/).

## Limits and estimates

- Train journeys use timetables and the selected allowance for platform transfers (four minutes by default). Enabling wheelchair access starts with at least eight minutes, which can then be changed. They do not promise the actual next train time. The search looks up to three hours ahead; it does not recommend waiting until the next morning.
- Time comparisons start **at the origin station**, excluding the trip from home/work. Crowding is for that station and the initial boarding line at the selected time, not a train carriage, transfers or the entire journey. Future dates show unavailable when LTA has not supplied matching forecasts; today's forecast is never reused for tomorrow. Current disruption/lift notices are applied conservatively and may change before a future departure. Expired timetables never produce a journey recommendation.
- Future bus occupancy and route traffic forecasts are not provided by these feeds. The next-buses checker continues to show the real upcoming arrivals and occupancy categories; nearby road reports are separate. An empty incident feed is not evidence of free-flowing traffic.
- Published service calendars apply planned adjustments. Text advisories are surfaced, but the app does not attempt to turn arbitrary text into verified closure geometry. Platform announcements and operator instructions still matter.
- Bus alternatives include **direct services only**, within the selected estimated walk at either end. Automatic uses 1 km, or 450 m for less walking; explicit walking limits override the automatic radius. The search checks up to 12 nearby stops at either end and up to ten candidate service/direction pairs. Bus transfers and mixed train/bus itineraries are not yet supported.
- Bus ride estimates use the published route distance at 18 km/h plus 21 seconds per stop. Walk estimates use straight-line distance multiplied by 1.3 at the selected pace (50, 75 or 100 m/min; default 75). Pace affects the walk estimate, whether an upcoming bus can be reached, and the final journey estimate. These are transparent planning assumptions, not measured journey times or pedestrian directions.
- Bus matching checks direction, origin/destination codes, loop visit number and whether the prediction allows enough time to walk to the boarding stop. No total is shown when a usable arrival cannot be confirmed.
- Disruption avoidance conservatively blocks train edges touching affected stations on the affected line in both directions. It may exclude journeys that remain possible in one direction.
- Occupancy is reported by LTA and may change before boarding. Route data can be affected by diversions; service advisories are shown alongside options.
- Wheelchair access is a constraint supported by partial source data, **not a verified door-to-door step-free route**. Accessible entrances, pedestrian paths to bus stops and wheelchair-bay availability are not in these feeds. Bus access times use the selected walking/rolling pace and estimated distance. Lift outages at an origin or destination are flagged for staff assistance; they do not automatically close the station. Transfers at reported outage stations are conservatively avoided, even where another working lift might exist. Intermediate stations can still be passed through without using their lifts. See [LTA accessibility information](https://www.lta.gov.sg/content/ltagov/en/getting_around/public_transport/a_better_public_transport_experience/an_inclusive_public_transport_system.html).
- The legacy `public/stations.geojson`, `MRT_Stations.xlsx` and `mock-data/` remain in the repository for reference; the running planner does **not** use them.

## Validation

```sh
npm test
```

The tests cover intermediate-station disruptions, multiple affected segments, exact station-code matching, service calendars and exceptions, overnight trips, missed departures, directional bus routes, loop visits, walking constraints, stale responses and unavailable feeds. Time-comparison tests additionally cover date/interval matching, forecast gaps, live-reading expiry, independent future routes, accessibility settings, expired timetables and road-incident proximity.

On 10 September 2026, the source audit found 184 distinct active train stations, 5,207 bus stops and 26,808 bus-route records. Representative train legs were matched back to their source GTFS departure/arrival records; a bus journey was matched to its ordered LTA stop sequence. Bahar Junction was rejected as a departure station, and `/.env` returned 404. Counts change as LTA updates its data.

## Code

- `server.js`: Express API and journey orchestration.
- `lib/lta.js`: LTA requests, complete pagination, caches and provenance.
- `lib/rail.js`: GTFS download/parsing, active network and scheduled routing.
- `lib/bus.js`: stop proximity, direct route matching and arrival checks.
- `lib/accessibility.js`: wheelchair-bus filtering and station lift-notice matching.
- `lib/preferences.js`: shared preference validation and bus crowd filtering. Journey queries accept `maxWalk=auto|250|450|500|1000|1500`, `walkPace=50|75|100`, `transferMinutes=4..30` and `busCrowding=any|avoid-high|seats`; bus-arrival queries also accept `busCrowding`.
- `lib/travel-times.js`: time comparisons, source forecast matching and nearby road reports.
- `public/`: browser interface and map.
- `test/routing.test.js`: offline routing and data-integrity tests.
- `test/travel-times.test.js`: offline comparison and forecast-integrity tests.
- `test/preferences.test.js`: preference validation, filtered arrival freshness, combined access/crowd requirements and effects of walking limits/pace on routing.

The first journey can take longer while all bus reference pages download. No API key is included in source code or returned to the frontend.
