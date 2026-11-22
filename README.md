# Sour DataEF (សួរ DataEF)

Khmer Telegram bot + commune officer dashboard that turns DataEF open data into village-level advice.
CamDX Hackathon 2026 prototype. See the SRS and Technical Design PDFs for the product and design.

```
apps/server      Fastify API + grammY bot + node-cron jobs (one process)
apps/dashboard   React + Vite + Tailwind + Leaflet officer dashboard
packages/dataef  one wrapper per DataEF API + api_cache (30-min refresh, 5 s timeout, stale fallback)
packages/ai      advice writer, question answerer (Claude tool calling), tool registry
packages/db      Drizzle schema (11 tables), queries, seed + CSV import
packages/messages Khmer/English message templates
data/            advice_rules.json, sample_locations.json, CSVs, fixtures/
```

## Run locally

Needs Node 20+, pnpm 9 and Docker (or any PostgreSQL).

```bash
pnpm install
cp .env.example .env          # then fill in TELEGRAM_BOT_TOKEN (BotFather) and AI_API_KEY
pnpm db:up                    # Postgres in Docker
pnpm db:setup                 # create tables, import all of Cambodia from DataEF, create officer@demo.kh / demo1234
pnpm dev                      # server on :3000 (bot uses long polling) + dashboard on :5173
```

Dashboard accounts (all with password `demo1234`, created by `pnpm db:seed`):

| Account | Role | What they can do |
|---|---|---|
| `officer@demo.kh` | Commune officer | Risk map, AI-drafted weather alerts to villages of their commune, history |
| `ngo@demo.kh` | NGO partner | **The partnership dashboard** (the only place news is sent from): news & announcements to any province/district/commune, reach report; 10 per week |

Partner messages are always labelled with the sender ("📰 សេចក្តីជូនដំណឹងពី …") and farmers can turn them off in `/settings` → "📰 ព័ត៌មានពីអង្គការដៃគូ". New partner accounts: set `role='partner'`, `org_name`, `org_name_km` and `area_codes` (e.g. `["02"]`, `["0203","1401"]`) on a row in `officers`.

Open http://localhost:5173 and sign in as `officer@demo.kh` / `demo1234`. Pick any commune with "📍 change" in the header. Then open the bot in Telegram and send `/start`.

### Data sources (all real, all live)

| What | Source |
|---|---|
| 25 provinces, 210 districts, 1,662 communes, 14,522 villages (official 2025 codes, Khmer + English names) | DataEF *Cambodia Province/District/Commune/Villages List 2025* (imported by `pnpm db:import`) |
| Village coordinates (95 % of villages; the rest use the commune centre) | DataEF *Geographical coordinates of … Province* (25 files) |
| Current weather per province | DataEF `GET /api/v1/realtime-api/weather` |
| USD/KHR exchange rate | DataEF `GET /api/v1/realtime-api/exchange-rate?currency_id=USD` (NBC) |
| CSX index and per-company summary | DataEF `GET /api/v1/realtime-api/csx-index`, `csx-summary` |
| 3-day forecast (rain mm, max temperature, rain start hour) per village | [Open-Meteo](https://open-meteo.com), free, no key. **DataEF has no forecast endpoint**, only current conditions. |

DataEF needs no API key. Its catalogue API is rate-limited, so the import goes one request at a time and caches downloads in `data/dataef-cache/` for a week (`pnpm db:import -- --fresh` to force a re-download).

- **No Telegram token:** the API and dashboard still run; deliveries are recorded as failed.
- **AI provider:** `AI_PROVIDER=gemini` (default, key from https://aistudio.google.com/apikey, model `gemini-3.8-flash`) or `AI_PROVIDER=anthropic` (Claude). Set `AI_API_KEY` and optionally `AI_MODEL`.
- **No AI key:** advice uses the approved templates, and the bot still answers "$25 in riel?" and "rain tomorrow?" with rule-based replies.
- **No internet on stage:** set `DATAEF_MODE=mock` for deterministic offline data. Villages listed in `DEMO_RED_LOCATIONS` then always show an urgent storm (a guaranteed red village for the demo).

### Useful commands

| Command | What it does |
|---|---|
| `pnpm --filter @sour/server job brief` | Send the 6 AM brief now (also: `refresh`, `weather`, `rate`, `csx`) |
| Dashboard → "Run job…" | Same, from the browser (handy on stage) |
| `pnpm probe` | Call every live source, save the raw DataEF replies to `data/fixtures/`, and print what we parse |
| `pnpm db:import` | Re-import all locations and coordinates from DataEF |
| `pnpm typecheck` | Type-check every package |

## Schedule (Asia/Phnom_Penh)

| Job | When |
|---|---|
| Refresh cache | every 30 min, and at boot |
| Morning brief | 06:00 |
| Urgent weather check | hourly at :05 (same alert at most once per 6 h per village) |
| Rate check | 08:30 daily; hourly 09:35–17:35 for users whose change threshold is crossed |
| CSX brief + big-move (> 2 %) alert | 16:00 Mon–Fri |

## Before 12 December (cannot be done in code)

1. **Pitch wording:** say clearly that the 3-day forecast comes from Open-Meteo, because DataEF's weather API only has current conditions per province. Everything else is DataEF.
2. **Content checks:** a Khmer speaker checks `packages/messages/src` and an agriculture source checks `data/advice_rules.json`.
3. **Thresholds:** confirm the `THRESHOLDS` in `packages/dataef/src/risk.ts` against MOWRAM's warning levels.

## Deploy

### Render (recommended, one click)

`render.yaml` creates **one web service** (bot + scheduler + API + dashboard on the same address) and **one Postgres database**.

1. Render dashboard → **New → Blueprint** → choose this GitHub repo.
2. Fill in the two secrets it asks for: `TELEGRAM_BOT_TOKEN` and `AI_API_KEY` (Gemini; may be left empty). `SEED_OFFICER_PASSWORD` is only needed when `DEMO_MODE=false`.
3. **Apply.** On first start the server creates the tables, loads all 25 provinces / 14,522 villages from `data/locations.json.gz`, creates `officer@demo.kh` and `ngo@demo.kh`, and connects the Telegram webhook to `https://<service>.onrender.com/telegram/webhook` (Render's `RENDER_EXTERNAL_URL`).
4. Open `https://<service>.onrender.com` for the dashboard.

Notes:
- **Free plan sleeps** after 15 minutes without traffic. A Telegram message wakes it (first reply ~1 min), but the **6 AM brief and hourly alerts don't run while it sleeps**. Switch the web service to **Starter** for the demo week.
- **Free Postgres expires after 30 days.**
- **One bot, one server.** Once the webhook is set, a local `pnpm dev` with the same token will *not* start polling (it would cut off the live bot). Use a second BotFather bot for local development, or set `ALLOW_WEBHOOK_TAKEOVER=true` to take the bot back locally.
- `DATABASE_URL` must be the Render Postgres **Internal Database URL**, never the `localhost` value from your local `.env`.

### Vercel (optional: dashboard only)

The Render service already serves the dashboard. To host it on Vercel instead:

1. Vercel → **Add New → Project** → import this repo.
2. **Root Directory:** `apps/dashboard` (framework Vite; build/output come from `apps/dashboard/vercel.json`).
3. **Environment variable:** `VITE_API_URL` = your Render URL, e.g. `https://sour-dataef.onrender.com` (no trailing `/api`).
4. On Render, make sure `DASHBOARD_URL` allows the Vercel address (default `https://*.vercel.app`).

- Locations snapshot: refresh with `pnpm db:import && pnpm --filter @sour/db export-locations`.

## Privacy

Bot users are stored only as Telegram ID, language, village and update choices. Questions and answers are not stored, apart from a 10-minute in-memory answer cache.
