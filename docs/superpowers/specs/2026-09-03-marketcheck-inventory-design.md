# Design: Live dealership inventory for advisor Step 2 (MarketCheck)

Date: 2026-09-03 · Status: approved by user · Project: freebuff-car-app

## Problem

Advisor Step 2 ("Compare your vehicles") renders a static three-car fleet
(`SAMPLE_VEHICLES` in `src/data/vehicles.ts`). The user wants live dealership
inventory from MarketCheck's `/v2/search/car/active` endpoint, with the Step 1
intake funneling into the search.

## Approach (chosen)

**Server-side `/api/inventory` route.** The API key never reaches the browser.
(Rejected: browser-direct — key exposure + CORS; rejected: build-time snapshot —
inventory is inherently live.)

## Data flow

1. Step 1 intake adds two optional fields: **ZIP** and **body style**. Saved to
   the advisor store as today (`intake`).
2. Advisor page passes `intake` into `VehicleNeeds`.
3. `VehicleNeeds` fetches `/api/inventory?budget=…&zip=…&bodyType=…`.
4. Route maps usable params to MarketCheck (`car_type=new`, `body_type`, `zip`,
   `rows=12`, `sort_by=msrp`), calls the API, maps the payload to the existing
   `Vehicle` shape, returns `{ source, vehicles }`.
5. **Needs-evaluation logic is untouched** — `vehicleMeetsNeeds`, met-fraction,
   red/green tags keep working, now against live data.

## Payload mapping (MarketCheck OpenAPI schema)

- `build.year/make/model/trim` → title fields
- `msrp ?? price` → `msrp`
- `build.mpge` or `(city_mpg + highway_mpg) / 2` → `fuelEconomyCombined`
- `build.drivetrain` → normalized `fwd|awd|4wd→awd` (else `fwd` default)
- `build.seats` → `seating`
- `build.high_value_features` → `tech` chips (deduped, capped at 6)
- **Honest limitations:** MarketCheck carries no IIHS ratings → `safetyRating`
  becomes "Not rated in this feed" (Top Safety Pick+ tag correctly goes red if
  that need is checked); MPG is sometimes absent → renders "n/a" and counts as
  unmet — never fabricated.
- Dedupe by `year|make|model|trim|price`; skip listings without make/model.

## Demo fallback (user-selected)

The route **always returns vehicles**:
- No key / upstream error → `{ source: 'demo', vehicles: <current fleet> }`
- Success → `{ source: 'marketcheck', vehicles: [...] }`

`VehicleNeeds` renders a small "Demo inventory — live feed not configured" banner
when `source === 'demo'`. One rendering path, no broken states, demos keep working.
When the user later sets `gh secret set MARKETCHECK_API_KEY`, one redeploy flips
Step 2 to live with zero code changes.

## Env plumbing

- `MARKETCHECK_API_KEY` in `.env.local` locally (gitignored)
- GitHub secret `MARKETCHECK_API_KEY` → mapped in `deploy-car-app.yml` →
  baked into `.env.production` by `deploy-car-app.sh` (same pattern as the
  portfolio deploy). `.env.example` added.

## Tests

- Mapper unit tests: normalization, dedupe, missing fields, 4wd→awd
- Route tests: demo fallback (no key), demo fallback (upstream error), live mapping
- `VehicleNeeds` tests rewritten to mock `fetch`: cards render, red/green tags
  from live data, demo banner, error banner. Existing needs-logic behavior
  is preserved and re-asserted.

## Error handling

Fetch failure → inline error banner with retry; loading → skeleton cards;
empty result → explicit "no matches" message. The route never throws to the
client; it always returns JSON with a `source` field.
