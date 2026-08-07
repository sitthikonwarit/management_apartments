import { Elysia } from "elysia";
import { and, eq } from "drizzle-orm";
import { existsSync } from "fs";
import { db } from "../db";
import { meterReadings } from "../db/schema";
import { getRows } from "../services/sheets";
import { COL } from "../config";
import { authDerive } from "../lib/authDerive";

function parseRow(r: typeof meterReadings.$inferSelect) {
  let data: any = {};
  try { data = r.data ? JSON.parse(r.data) : {}; } catch {}
  return { id: r.id, monthYear: r.monthYear, data, recordDate: r.recordDate, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

export const metersRoute = new Elysia({ prefix: "/meters" })
  .use(authDerive)
  .get("/", async ({ authUser }) => {
    const rows = await db.select().from(meterReadings).where(eq(meterReadings.orgId, authUser!.orgId));
    return rows.map(parseRow).sort((a, b) => b.monthYear.localeCompare(a.monthYear));
  })
  // ── sync-sheets ต้องอยู่ก่อน /:id เพื่อไม่ให้ชนกับ dynamic route ──
  .post("/sync-sheets", async ({ authUser, set }) => {
    const orgId = authUser!.orgId;
    // ปิดชั่วคราว — ตั้ง GOOGLE_INTEGRATION_ENABLED=true ใน .env เพื่อเปิดกลับมาใช้งาน
    if (process.env.GOOGLE_INTEGRATION_ENABLED !== "true") {
      set.status = 503;
      return { error: "การซิงก์จาก Google Sheets ถูกปิดใช้งานชั่วคราว" };
    }
    if (!process.env.SPREADSHEET_ID) {
      set.status = 500;
      return { error: "ไม่พบ SPREADSHEET_ID ใน environment variables กรุณาตั้งค่าให้ถูกต้อง" };
    }
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_PATH && !existsSync("./service-account.json")) {
      set.status = 500;
      return { error: "ไม่พบ service-account.json กรุณาวางไฟล์ใน root หรือตั้ง GOOGLE_SERVICE_ACCOUNT_PATH" };
    }
    try {
      console.log("[sync-sheets] Fetching MeterReadings from Google Sheets...");
      const rows = await getRows("MeterReadings");
      console.log(`[sync-sheets] Got ${rows.length} rows`);
      // log first row's DATA field to understand structure
      if (rows.length > 0) {
        const sampleData = rows[0][COL.METER_READINGS.DATA];
        console.log("[sync-sheets] Sample DATA (row 0):", typeof sampleData, JSON.stringify(String(sampleData).slice(0, 300)));
      }
      const s = (v: any) => (v === null || v === undefined ? "" : String(v).trim());
      let inserted = 0, updated = 0, skipped = 0;
      for (const r of rows) {
        const id = s(r[COL.METER_READINGS.ID]);
        if (!id) { skipped++; continue; }
        // แปลง array format จาก Sheets → object format {roomNumber: {currElectric, currWater}}
        let dataStr = s(r[COL.METER_READINGS.DATA]);
        if (dataStr) {
          try {
            const parsed = JSON.parse(dataStr);
            if (Array.isArray(parsed)) {
              const obj: Record<string, any> = {};
              parsed.forEach((item: any) => {
                const key = item.roomNumber ?? item.roomId ?? item.id;
                if (!key) return;
                obj[String(key)] = {
                  prevElectric: "",
                  currElectric: item.electricReading ?? item.currElectric ?? item.electric ?? "",
                  prevWater:    "",
                  currWater:    item.waterReading ?? item.currWater ?? item.water ?? "",
                };
              });
              dataStr = JSON.stringify(obj);
            }
          } catch {}
        }
        const record = {
          id,
          orgId,
          monthYear:  s(r[COL.METER_READINGS.MONTH_YEAR]),
          data:       dataStr || "{}",
          recordDate: s(r[COL.METER_READINGS.RECORD_DATE]),
          createdAt:  s(r[COL.METER_READINGS.CREATED_AT]),
          updatedAt:  s(r[COL.METER_READINGS.UPDATED_AT]),
        };
        const [existing] = await db.select().from(meterReadings).where(and(eq(meterReadings.id, id), eq(meterReadings.orgId, orgId)));
        if (existing) {
          await db.update(meterReadings).set(record).where(eq(meterReadings.id, id));
          updated++;
        } else {
          await db.insert(meterReadings).values(record);
          inserted++;
        }
      }
      const all = await db.select().from(meterReadings).where(eq(meterReadings.orgId, orgId));
      const sampleRaw = rows.length > 0 ? String(rows[0][COL.METER_READINGS.DATA] ?? "").slice(0, 500) : "";
      return { inserted, updated, skipped, total: all.length, records: all.map(parseRow), sampleRaw };
    } catch (e: any) {
      set.status = 500;
      const msg = e?.message ?? String(e);
      console.error("[sync-sheets]", msg);
      return { error: msg };
    }
  })
  .post("/", async ({ authUser, body, set }) => {
    const orgId = authUser!.orgId;
    const { monthYear } = body as any;
    if (!monthYear) { set.status = 400; return { error: "ต้องระบุเดือน/ปี" }; }
    const existing = await db.select().from(meterReadings).where(and(eq(meterReadings.monthYear, monthYear), eq(meterReadings.orgId, orgId)));
    if (existing.length) { set.status = 409; return { error: "มีข้อมูลเดือนนี้อยู่แล้ว" }; }
    const now = new Date();
    const id = `MTR-${Date.now()}`;
    const ts = now.toISOString();
    await db.insert(meterReadings).values({
      id, orgId, monthYear, data: "{}", recordDate: ts.slice(0, 10), createdAt: ts, updatedAt: ts,
    });
    const [row] = await db.select().from(meterReadings).where(eq(meterReadings.id, id));
    return parseRow(row);
  })
  .put("/:id", async ({ authUser, params, body, set }) => {
    const { id } = params;
    const { data } = body as any;
    const [existing] = await db.select().from(meterReadings).where(and(eq(meterReadings.id, id), eq(meterReadings.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบข้อมูล" }; }
    const updatedAt = new Date().toISOString();
    await db.update(meterReadings).set({
      data: JSON.stringify(data ?? {}),
      updatedAt,
    }).where(eq(meterReadings.id, id));
    const [row] = await db.select().from(meterReadings).where(eq(meterReadings.id, id));
    return parseRow(row);
  })
  .delete("/:id", async ({ authUser, params, set }) => {
    const [existing] = await db.select().from(meterReadings).where(and(eq(meterReadings.id, params.id), eq(meterReadings.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบข้อมูล" }; }
    await db.delete(meterReadings).where(eq(meterReadings.id, params.id));
    return { deleted: params.id };
  });
