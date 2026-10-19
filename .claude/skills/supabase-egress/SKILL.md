---
name: supabase-egress
description: Audit and reduce Supabase egress (bandwidth) usage in the NG Travels project. Use when the user mentions Supabase egress, bandwidth, quota, a usage bill/overage, "reduce data usage", or slow/heavy API responses that pull too much data from Postgres, Storage or Realtime.
---

# Supabase egress control (NG Travels)

Egress here comes from three places: Postgres reads by the API server, Storage downloads, and Realtime pushes. Work through them in this order and report what you changed vs. only recommended.

## 1. Confirm where it comes from
Ask the user to check Supabase dashboard → Reports → Egress (split by Database / Storage / Realtime). Don't guess the biggest source; if they can't share it, audit all three below.

## 2. Postgres reads (API server)
File: `artifacts/api-server/src/routes/ng-travels.ts` (Drizzle).
- Grep for `db.select().from(` — a bare `select()` pulls every column. Replace with a column list wherever the handler only needs a few fields (dashboard metrics, per-ping lookups, existence checks).
- Every list endpoint needs a `.limit()` (and `.offset()` where the client pages). Check `/trips`, `/payments`, `/expenses`, `/customers`, `/drivers`, `/enquiries`, `/notifications`, `/audit-logs`.
- Never load a whole lookup table to join in memory; use `inArray(table.id, ids)` on just the ids needed.
- Don't select full rows on hot paths (e.g. `POST /driver/trips/:id/location` runs every GPS ping).
- Unbounded append-only tables (`driver_locations`) need retention; pruning lives in `pruneOldLocations()`.
- Search that filters in JS after the query needs a bounded fetch, not the whole table.

## 3. Storage
- Uploads (`supabaseServer.storage...upload`) must pass `cacheControl: "31536000"` so browsers/CDN cache immutable files (paths are unique, so this is safe).
- Uploads allow 8 MB; client-side compression (~1280px, JPEG q≈0.7) before upload cuts every later download ~10x.
- Prefer thumbnails/Supabase image transforms for list views; load the full image only on open.

## 4. Realtime
- `artifacts/ng-travels/src/hooks/useRealtimeSync.ts` subscribes to `postgres_changes` on trips, drivers, vehicles, payments, trip_expenses, notifications; the API also pushes the same events over SSE (`/api/realtime/stream`). They overlap — dropping one removes duplicate traffic. Realtime-only changes (edits made directly in Supabase) would be lost if the Supabase side is removed, so confirm with the user first.
- Keep high-frequency tables (`driver_locations`) OUT of the `supabase_realtime` publication (`supabase/migrations/20260905040000_realtime_publication.sql`).
- Client invalidation is debounced and key-scoped (`EVENT_KEYS` / `TABLE_KEYS`); keep new events scoped to the endpoints they affect.

## 5. Client polling
- `artifacts/ng-travels/src/App.tsx`: `fallbackPoll` only polls when realtime is down; keep `staleTime` ≥ 30s and avoid new `refetchInterval`s.
- Live map polling (`RealtimeFleetMap.tsx`) is 15s and paused when the tab is hidden; don't speed it up.

## 6. Verify
- Run `npx tsc --noEmit -p .` in `artifacts/api-server`.
- Tell the user which endpoints changed behavior (e.g. `/trips` `total` is now page size) and recommend re-checking the egress report after a few days.
- Don't commit unless asked.
