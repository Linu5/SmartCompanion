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

- **Phone and laptop layouts:** a map with an expandable bottom panel and fixed Plan / Map / Buses navigation on phones; a floating side panel on laptops. Map fitting accounts for the open panel. A saved light/dark preference works across both layouts. The bus-arrivals tab is independent of the train-only journey filter and shares the wheelchair requirement.
- **Train only:** plan a scheduled train journey with disruption checks and station crowd levels, without fetching bus alternatives or showing bus results.
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
| Lift-maintenance notices | `v2/FacilitiesMaintenance` | LTA reported lift outages; no report does not guarantee a working step-free path |
| Bus stop names and coordinates | `BusStops`, all pages | LTA reference data |
| Bus direction, stop order and route distance | `BusRoutes`, all pages | Published LTA service routes |
| Bus arrival, occupancy and vehicle type | `v3/BusArrival` | Provider prediction; `Monitored` distinguishes live and scheduled arrivals |
| Total bus journey duration | App calculation | **Estimate:** provider arrival + estimated ride + final walk |
| Basemap | OpenStreetMap via Leaflet | Map tiles; overlays are schematic |

The backend downloads train timetables and the full bus reference datasets to the ignored `.cache/` directory and refreshes them daily. Live data uses shorter caches: arrivals 20 seconds, alerts 30 seconds, crowd readings 10 minutes. Responses include `updatedAt` and `stale`. A failed refresh may return a labelled cached real response; with no real cache, the API returns an error. **The app never substitutes mock data for unavailable live data.**

Lift-maintenance data is cached for one minute. Failed or stale lift checks are explicitly marked. Wheelchair-equipped bus filtering also applies to the standalone next-buses search. Missing accessibility flags are treated as unconfirmed, not as proof that a vehicle is inaccessible.

Source documentation: [LTA DataMall API guide](https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf), [GTFS schedule reference](https://gtfs.org/documentation/schedule/reference/).

## Limits and estimates

- Train journeys use timetables and a four-minute allowance for platform transfers. They do not promise the actual next train time. The search looks up to three hours ahead; it does not recommend waiting until the next morning.
- Published service calendars apply planned adjustments. Text advisories are surfaced, but the app does not attempt to turn arbitrary text into verified closure geometry. Platform announcements and operator instructions still matter.
- Bus alternatives include **direct services only**, within an estimated 1 km walk at either end, or 450 m for less walking. The search checks up to 12 nearby stops at either end. Bus transfers and mixed train/bus itineraries are not yet supported.
- Bus ride estimates use the published route distance at 18 km/h plus 21 seconds per stop. Walk estimates use straight-line distance multiplied by 1.3 at 75 m/min. These are transparent planning assumptions, not measured journey times or pedestrian directions.
- Bus matching checks direction, origin/destination codes, loop visit number and whether the prediction allows enough time to walk to the boarding stop. No total is shown when a usable arrival cannot be confirmed.
- Disruption avoidance conservatively blocks train edges touching affected stations on the affected line in both directions. It may exclude journeys that remain possible in one direction.
- Occupancy is reported by LTA and may change before boarding. Route data can be affected by diversions; service advisories are shown alongside options.
- Wheelchair access is a constraint supported by partial source data, **not a verified door-to-door step-free route**. Accessible entrances, pedestrian paths to bus stops and wheelchair-bay availability are not in these feeds. Bus access times still use the general walking estimate. Lift outages at an origin or destination are flagged for staff assistance; they do not automatically close the station. Transfers at reported outage stations are conservatively avoided, even where another working lift might exist. Intermediate stations can still be passed through without using their lifts. See [LTA accessibility information](https://www.lta.gov.sg/content/ltagov/en/getting_around/public_transport/a_better_public_transport_experience/an_inclusive_public_transport_system.html).
- The legacy `public/stations.geojson`, `MRT_Stations.xlsx` and `mock-data/` remain in the repository for reference; the running planner does **not** use them.

## Validation

```sh
npm test
```

The tests cover intermediate-station disruptions, multiple affected segments, exact station-code matching, service calendars and exceptions, overnight trips, missed departures, directional bus routes, loop visits, walking constraints, stale responses and unavailable feeds.

On 10 September 2026, the source audit found 184 distinct active train stations, 5,207 bus stops and 26,808 bus-route records. Representative train legs were matched back to their source GTFS departure/arrival records; a bus journey was matched to its ordered LTA stop sequence. Bahar Junction was rejected as a departure station, and `/.env` returned 404. Counts change as LTA updates its data.

## Code

- `server.js`: Express API and journey orchestration.
- `lib/lta.js`: LTA requests, complete pagination, caches and provenance.
- `lib/rail.js`: GTFS download/parsing, active network and scheduled routing.
- `lib/bus.js`: stop proximity, direct route matching and arrival checks.
- `lib/accessibility.js`: wheelchair-bus filtering and station lift-notice matching.
- `public/`: browser interface and map.
- `test/routing.test.js`: offline routing and data-integrity tests.

The first journey can take longer while all bus reference pages download. No API key is included in source code or returned to the frontend.
