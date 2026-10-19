import { Router, type Request, type Response } from "express";
import { like } from "drizzle-orm";
import { db, tripsTable, tripExpensesTable } from "@workspace/db";
import { supabaseServer } from "../lib/supabase.js";

const router = Router();

// Uploaded trip images (odometer photos, expense receipts) are only needed
// for a short verification window; after that they are removed from Storage
// to keep storage and egress usage down.
const TRIP_IMAGE_BUCKETS = ["odometer-photos", "expense-receipts"];
const RETENTION_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;

async function expiredPaths(bucket: string, cutoff: number): Promise<string[]> {
  const storage = supabaseServer.storage.from(bucket);
  const expired: string[] = [];

  // Objects live under one folder per driver/user: <id>/<file>
  const { data: folders, error } = await storage.list("", { limit: PAGE_SIZE });
  if (error) throw error;

  for (const entry of folders ?? []) {
    // Folders come back without an id/metadata; loose files have both.
    if (entry.id) {
      if (new Date(entry.created_at ?? 0).getTime() < cutoff) expired.push(entry.name);
      continue;
    }
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data: files, error: listError } = await storage.list(entry.name, { limit: PAGE_SIZE, offset });
      if (listError) throw listError;
      for (const file of files ?? []) {
        if (file.id && new Date(file.created_at ?? 0).getTime() < cutoff) expired.push(`${entry.name}/${file.name}`);
      }
      if (!files || files.length < PAGE_SIZE) break;
    }
  }
  return expired;
}

/**
 * Scheduled by Vercel Cron (see vercel.json). Vercel sends
 * `Authorization: Bearer $CRON_SECRET`; without CRON_SECRET set the endpoint
 * stays disabled so it can't be triggered anonymously.
 */
router.get("/cron/cleanup-trip-images", async (req: Request, res: Response): Promise<void> => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid cron credentials" } });
    return;
  }

  const cutoff = Date.now() - RETENTION_MS;
  const summary: Record<string, number> = {};

  try {
    for (const bucket of TRIP_IMAGE_BUCKETS) {
      const paths = await expiredPaths(bucket, cutoff);
      summary[bucket] = 0;

      for (let i = 0; i < paths.length; i += 100) {
        const batch = paths.slice(i, i + 100);
        const { error } = await supabaseServer.storage.from(bucket).remove(batch);
        if (error) throw error;
        summary[bucket] += batch.length;

        // Clear the now-dead links so the app doesn't render broken images.
        for (const path of batch) {
          const match = `%/${bucket}/${path}`;
          await db.update(tripsTable).set({ startKmPhoto: null }).where(like(tripsTable.startKmPhoto, match));
          await db.update(tripsTable).set({ endKmPhoto: null }).where(like(tripsTable.endKmPhoto, match));
          await db.update(tripsTable).set({ standStartPhoto: null }).where(like(tripsTable.standStartPhoto, match));
          await db.update(tripsTable).set({ standReturnPhoto: null }).where(like(tripsTable.standReturnPhoto, match));
          await db
            .update(tripExpensesTable)
            .set({ receiptPath: null })
            .where(like(tripExpensesTable.receiptPath, `%${path}`));
        }
      }
    }
    res.json({ success: true, deleted: summary });
  } catch (err: any) {
    console.error("[cron/cleanup-trip-images] Failed:", err?.message);
    res.status(500).json({ success: false, deleted: summary, error: { code: "CLEANUP_FAILED", message: err?.message } });
  }
});

export default router;
