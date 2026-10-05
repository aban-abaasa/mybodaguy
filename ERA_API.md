# Era API in BodaGoEra (mybodaguy)

BodaGoEra (mybodaguy) is part of the ICANERA family's public developer API (public data, plus private business endpoints behind owner-issued keys). The page, the API gateway and the dev-panel
console are the same in all four apps; the database layer lives in the **ICAN** repo (all four apps share one Supabase
project). Full deploy notes: `ICAN/ERA_API_DEPLOY.md`.

What is here:

- `frontend/public/developers/` : the developer page (`/developers/`), the admin console module and a catalogue snapshot
- `frontend/api/v1/[...path].js` + `frontend/api/_lib/eraApi.js` : the gateway behind `/api/v1/*` on this app's own domain
- `frontend/src/mybodaguy/components/EraApiDevTab.tsx` : the **API** tab of `DeveloperDashboard.tsx`, for main developers only
- `frontend/src/mybodaguy/components/BookingConfirmPage.tsx` + `services/eraBooking.ts` : **`/book/<code>`**, the page where a customer confirms a ride or delivery that a business requested through the API (they book it themselves; nothing is dispatched until they do). Tests: `frontend/tests/eraBooking.test.js`
- `frontend/vercel.json` : rewrites so `/developers` serves the page and the SPA fallback leaves `/api/` and `/developers/` alone
- `frontend/public/sw.js` : the service worker now lets `/api/v1/*` and `/developers/*` go straight to the network
- `frontend/tests/eraApi.test.js` : gateway tests (`npm run test:era-api`)

Until the four ICAN migrations (`supabase/migrations/20261005100000_era_api.sql`, `..100100_era_api_endpoints.sql`, `20261006100000_era_api_business.sql` and `..100100_era_api_business_endpoints.sql`; or the single paste file `ICAN/ERA_API_PASTE_INTO_SUPABASE.sql`) are applied, the
page shows its built-in reference with a "not switched on yet" banner and nothing else changes.

The shared files are **copies**: change them in ICAN and run `node scripts/sync-era-api.mjs` there. Do not edit them here.

Environment: the gateway uses `SUPABASE_URL` (or `VITE_SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY` (preferred) or
`SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY`, which this project most likely already has.
