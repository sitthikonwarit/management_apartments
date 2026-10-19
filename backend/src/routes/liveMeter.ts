import { Elysia } from "elysia";
import { randomBytes, timingSafeEqual } from "crypto";
import { db } from "../db";
import { liveMeters, liveMeterKeys, rooms } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { authDerive } from "../lib/authDerive";
import { broadcastChange } from "../lib/wsHub";

// ── Live Meter: มิเตอร์ไฟ/น้ำอัจฉริยะส่งค่าสดเข้าเว็บ (push) แล้วหน้า Dashboard แสดงว่าห้องไหนเชื่อมแล้ว/ออนไลน์/ออฟไลน์ ──
// อุปกรณ์ (เช่น ESP32 / Modbus gateway) ยิง POST /live-meter/ingest พร้อมคีย์ของหอพัก (header x-meter-key) ทุกไม่กี่วินาที
// เก็บเฉพาะค่าล่าสุดของแต่ละอุปกรณ์ (slaveId) ไม่เก็บประวัติ — ออนไลน์ = ส่งค่ามาล่าสุดไม่เกิน ONLINE_WINDOW_MS
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

function newKey() { return `lm_${randomBytes(24).toString("hex")}`; }

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a); const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function parseDevice(r: typeof liveMeters.$inferSelect) {
  const seen = r.lastSeenAt ? new Date(r.lastSeenAt).getTime() : 0;
  return {
    id: r.id, slaveId: r.slaveId, name: r.name, roomId: r.roomId, type: r.type === "water" ? "water" : "electric",
    lastSeenAt: r.lastSeenAt, value: r.value, voltage: r.voltage, current: r.current, power: r.power,
    online: !!seen && Date.now() - seen <= ONLINE_WINDOW_MS,
  };
}

const lastBroadcast = new Map<string, number>();

// สาธารณะ — ยืนยันตัวด้วยคีย์ของหอพัก (อุปกรณ์ไม่มีบัญชีผู้ใช้) ต้องเมานต์ก่อนการ์ดล็อกอินใน index.ts
export const liveMeterIngestRoute = new Elysia({ prefix: "/live-meter" })
  .post("/ingest", async ({ headers, body, set }) => {
    const key = String(headers["x-meter-key"] ?? "");
    if (!key) { set.status = 401; return { error: "ไม่พบคีย์" }; }
    const keyRows = await db.select().from(liveMeterKeys);
    const found = keyRows.find((k) => safeEqual(k.apiKey, key));
    if (!found) { set.status = 401; return { error: "คีย์ไม่ถูกต้อง" }; }
    const orgId = found.orgId;

    const b = body as any;
    const list: any[] = Array.isArray(b?.readings) ? b.readings : b && typeof b === "object" && b.slaveId !== undefined ? [b] : [];
    if (list.length === 0) { set.status = 400; return { error: "ไม่มีข้อมูลมิเตอร์ (ส่ง {slaveId, type, value, voltage, current, power} หรือ {readings:[...]})" }; }

    const now = new Date().toISOString();
    let accepted = 0;
    for (const r of list.slice(0, 200)) {
      const slaveId = String(r?.slaveId ?? "").trim();
      if (!slaveId) continue;
      const type = r?.type === "water" ? "water" : "electric";
      const num = (v: unknown) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? "" : String(Number(v)));
      const [existing] = await db.select().from(liveMeters).where(and(eq(liveMeters.orgId, orgId), eq(liveMeters.slaveId, slaveId)));
      if (existing) {
        await db.update(liveMeters).set({
          lastSeenAt: now, type: r?.type ? type : existing.type,
          value: num(r?.value), voltage: num(r?.voltage), current: num(r?.current), power: num(r?.power),
        }).where(eq(liveMeters.id, existing.id));
      } else {
        await db.insert(liveMeters).values({
          id: `LM-${Date.now()}-${Math.floor(Math.random() * 1000)}`, orgId, slaveId, name: String(r?.name ?? ""), roomId: "", type,
          lastSeenAt: now, value: num(r?.value), voltage: num(r?.voltage), current: num(r?.current), power: num(r?.power), createdAt: now,
        });
      }
      accepted++;
    }
    // แจ้งหน้าเว็บให้รีเฟรช (จำกัดไม่เกินทุก 3 วินาทีต่อองค์กร กันท่วมเมื่ออุปกรณ์ส่งถี่)
    if (Date.now() - (lastBroadcast.get(orgId) ?? 0) > 3000) {
      lastBroadcast.set(orgId, Date.now());
      broadcastChange(orgId, "live-meter", "update");
    }
    return { ok: true, accepted };
  });

export const liveMeterRoute = new Elysia({ prefix: "/live-meter" })
  .use(authDerive)
  .get("/devices", async ({ authUser }) => {
    const rows = await db.select().from(liveMeters).where(eq(liveMeters.orgId, authUser!.orgId));
    return rows.map(parseDevice);
  })
  // คีย์ของหอพัก: ไม่มี = สร้างให้ (regenerate=true = ออกคีย์ใหม่ คีย์เก่าใช้ไม่ได้ทันที)
  .post("/key", async ({ authUser, body }) => {
    const orgId = authUser!.orgId;
    const regenerate = (body as any)?.regenerate === true;
    const [row] = await db.select().from(liveMeterKeys).where(eq(liveMeterKeys.orgId, orgId));
    if (row && !regenerate) return { apiKey: row.apiKey };
    const apiKey = newKey();
    if (row) await db.update(liveMeterKeys).set({ apiKey }).where(eq(liveMeterKeys.orgId, orgId));
    else await db.insert(liveMeterKeys).values({ orgId, apiKey, createdAt: new Date().toISOString() });
    return { apiKey };
  })
  .put("/devices/:id", async ({ authUser, params, body, set }) => {
    const orgId = authUser!.orgId;
    const { roomId, name, type } = body as any;
    const [existing] = await db.select().from(liveMeters).where(and(eq(liveMeters.id, params.id), eq(liveMeters.orgId, orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบอุปกรณ์" }; }
    let nextRoom = existing.roomId;
    if (roomId !== undefined) {
      if (roomId) {
        const [room] = await db.select().from(rooms).where(and(eq(rooms.id, String(roomId)), eq(rooms.orgId, orgId)));
        if (!room) { set.status = 400; return { error: "ไม่พบห้อง" }; }
      }
      nextRoom = String(roomId || "");
    }
    await db.update(liveMeters).set({
      roomId: nextRoom,
      name: name !== undefined ? String(name) : existing.name,
      type: type === "water" ? "water" : type === "electric" ? "electric" : existing.type,
    }).where(eq(liveMeters.id, params.id));
    const [row] = await db.select().from(liveMeters).where(eq(liveMeters.id, params.id));
    return parseDevice(row);
  })
  .delete("/devices/:id", async ({ authUser, params, set }) => {
    const [existing] = await db.select().from(liveMeters).where(and(eq(liveMeters.id, params.id), eq(liveMeters.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบอุปกรณ์" }; }
    await db.delete(liveMeters).where(eq(liveMeters.id, params.id));
    return { deleted: params.id };
  });
