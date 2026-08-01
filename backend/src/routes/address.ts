import { Elysia } from "elysia";
import db from "../thaiAddress.json";

const records = db as Array<{ district: string; amphoe: string; province: string; zipcode: number }>;

export const addressRoute = new Elysia({ prefix: "/address" })
  .get("/provinces", () =>
    [...new Set(records.map((r) => r.province))].sort()
  )
  .get("/amphoes", ({ query }) => {
    const p = (query as any).province as string;
    if (!p) return [];
    return [...new Set(records.filter((r) => r.province === p).map((r) => r.amphoe))].sort();
  })
  .get("/tambons", ({ query }) => {
    const p = (query as any).province as string;
    const a = (query as any).amphoe as string;
    if (!p || !a) return [];
    const seen = new Set<string>();
    return records
      .filter((r) => r.province === p && r.amphoe === a)
      .filter((r) => { if (seen.has(r.district)) return false; seen.add(r.district); return true; })
      .map((r) => ({ tambon: r.district, zipcode: r.zipcode }));
  });
