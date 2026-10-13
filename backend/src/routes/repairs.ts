import { Elysia } from "elysia";
import { db } from "../db";
import { repairItems, repairMovements, rooms, chatMessages } from "../db/schema";
import { signUploadPath } from "../lib/encryption";
import { and, eq } from "drizzle-orm";
import { authDerive } from "../lib/authDerive";

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function parseMovement(r: typeof repairMovements.$inferSelect) {
  return {
    id: r.id, itemId: r.itemId, type: r.type === "out" ? "out" : "in",
    quantity: num(r.quantity), unitPrice: num(r.unitPrice),
    roomId: r.roomId, roomNumber: r.roomNumber, date: r.date, note: r.note,
    createdBy: r.createdBy, createdAt: r.createdAt,
  };
}

// ยอดคงเหลือ + ราคารับเข้าล่าสุดของของแต่ละชิ้น คำนวณจากประวัติทั้งหมด
function summarize(items: (typeof repairItems.$inferSelect)[], moves: (typeof repairMovements.$inferSelect)[]) {
  return items.map((it) => {
    const mine = moves.filter((m) => m.itemId === it.id);
    const stock = mine.reduce((s, m) => s + (m.type === "out" ? -num(m.quantity) : num(m.quantity)), 0);
    const lastIn = mine.filter((m) => m.type === "in").sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt))[0];
    return {
      id: it.id, name: it.name, unit: it.unit, minStock: num(it.minStock), note: it.note, createdAt: it.createdAt,
      stock, lastPrice: lastIn ? num(lastIn.unitPrice) : 0,
    };
  });
}

// คำขอแจ้งซ่อมจากผู้เช่า (ปุ่ม "แจ้งซ่อม" ใน LIFF) เก็บเป็นข้อความแชท messageType "repair" — snapshot อยู่ใน text (JSON)
// status: "pending" รอซ่อม | "completed" พนักงานยืนยันปิดงานแล้ว (ดู PATCH /chat/.../repair)
async function loadRepairRequests(orgId: string) {
  const rows = await db.select().from(chatMessages).where(and(eq(chatMessages.orgId, orgId), eq(chatMessages.messageType, "repair")));
  return rows.map((r) => {
    let snap: any = {};
    try { snap = r.text ? JSON.parse(r.text) : {}; } catch {}
    const photos = (arr: unknown) => (Array.isArray(arr) ? arr.filter((u) => typeof u === "string").map(signUploadPath) : []);
    return {
      id: r.id,
      lineUserId: r.lineUserId,
      tenantName: r.senderName || "",
      roomNumber: String(snap.roomNumber ?? ""),
      title: String(snap.title ?? ""),
      details: String(snap.details ?? ""),
      tenantPhotos: photos(snap.tenantPhotos),
      status: snap.status === "completed" ? "completed" : "pending",
      adminNote: String(snap.adminNote ?? ""),
      confirmedBy: String(snap.confirmedBy ?? ""),
      confirmedAt: String(snap.confirmedAt ?? ""),
      createdAt: r.createdAt,
    };
  });
}

export const repairsRoute = new Elysia({ prefix: "/repairs" })
  .use(authDerive)
  .get("/requests", async ({ authUser }) => {
    const list = await loadRepairRequests(authUser!.orgId);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  })
  .get("/requests/pending-count", async ({ authUser }) => {
    const list = await loadRepairRequests(authUser!.orgId);
    return { count: list.filter((r) => r.status === "pending").length };
  })
  .get("/items", async ({ authUser }) => {
    const orgId = authUser!.orgId;
    const items = await db.select().from(repairItems).where(eq(repairItems.orgId, orgId));
    const moves = await db.select().from(repairMovements).where(eq(repairMovements.orgId, orgId));
    return summarize(items, moves);
  })
  .post("/items", async ({ authUser, body, set }) => {
    const { name, unit, minStock, note } = body as any;
    if (!String(name ?? "").trim()) { set.status = 400; return { error: "ต้องระบุชื่อของ" }; }
    const id = `RI-${Date.now()}`;
    await db.insert(repairItems).values({
      id, orgId: authUser!.orgId, name: String(name).trim(), unit: String(unit ?? "").trim() || "ชิ้น",
      minStock: String(num(minStock)), note: String(note ?? ""), createdAt: new Date().toISOString(),
    });
    const [row] = await db.select().from(repairItems).where(eq(repairItems.id, id));
    return summarize([row], [])[0];
  })
  .put("/items/:id", async ({ authUser, params, body, set }) => {
    const { name, unit, minStock, note } = body as any;
    const [existing] = await db.select().from(repairItems).where(and(eq(repairItems.id, params.id), eq(repairItems.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบข้อมูล" }; }
    await db.update(repairItems).set({
      name: name !== undefined ? String(name).trim() || existing.name : existing.name,
      unit: unit !== undefined ? String(unit).trim() || existing.unit : existing.unit,
      minStock: minStock !== undefined ? String(num(minStock)) : existing.minStock,
      note: note !== undefined ? String(note) : existing.note,
    }).where(eq(repairItems.id, params.id));
    const [row] = await db.select().from(repairItems).where(eq(repairItems.id, params.id));
    const moves = await db.select().from(repairMovements).where(eq(repairMovements.itemId, params.id));
    return summarize([row], moves)[0];
  })
  .delete("/items/:id", async ({ authUser, params, set }) => {
    const [existing] = await db.select().from(repairItems).where(and(eq(repairItems.id, params.id), eq(repairItems.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบข้อมูล" }; }
    const moves = await db.select().from(repairMovements).where(eq(repairMovements.itemId, params.id));
    if (moves.length > 0) { set.status = 400; return { error: "ของชิ้นนี้มีประวัติรับเข้า/เบิกใช้แล้ว ลบไม่ได้ (ลบประวัติทั้งหมดก่อน)" }; }
    await db.delete(repairItems).where(eq(repairItems.id, params.id));
    return { deleted: params.id };
  })
  .get("/movements", async ({ authUser }) => {
    const rows = await db.select().from(repairMovements).where(eq(repairMovements.orgId, authUser!.orgId));
    return rows.map(parseMovement);
  })
  // เติมของ (type=in) หรือเบิกใช้ (type=out + ห้อง) — เบิกเกินยอดคงเหลือไม่ได้
  .post("/movements", async ({ authUser, body, set }) => {
    const orgId = authUser!.orgId;
    const { itemId, type, quantity, unitPrice, roomId, date, note } = body as any;
    const qty = num(quantity);
    if (!(qty > 0)) { set.status = 400; return { error: "จำนวนต้องมากกว่า 0" }; }
    const [item] = await db.select().from(repairItems).where(and(eq(repairItems.id, String(itemId ?? "")), eq(repairItems.orgId, orgId)));
    if (!item) { set.status = 400; return { error: "ไม่พบของที่เลือก" }; }
    const kind = type === "out" ? "out" : "in";
    let roomNumber = "";
    if (kind === "out") {
      if (!roomId) { set.status = 400; return { error: "ต้องเลือกห้องที่นำไปใช้" }; }
      const [room] = await db.select().from(rooms).where(and(eq(rooms.id, String(roomId)), eq(rooms.orgId, orgId)));
      if (!room) { set.status = 400; return { error: "ไม่พบห้องที่เลือก" }; }
      roomNumber = room.number;
      const moves = await db.select().from(repairMovements).where(eq(repairMovements.itemId, item.id));
      const stock = summarize([item], moves)[0].stock;
      if (qty > stock) { set.status = 400; return { error: `ของคงเหลือไม่พอ (เหลือ ${stock} ${item.unit})` }; }
    }
    const id = `RM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await db.insert(repairMovements).values({
      id, orgId, itemId: item.id, type: kind, quantity: String(qty), unitPrice: String(Math.max(0, num(unitPrice))),
      roomId: kind === "out" ? String(roomId) : "", roomNumber,
      date: String(date || new Date().toISOString().slice(0, 10)), note: String(note ?? ""),
      createdBy: authUser!.username, createdAt: new Date().toISOString(),
    });
    const [row] = await db.select().from(repairMovements).where(eq(repairMovements.id, id));
    return parseMovement(row);
  })
  .delete("/movements/:id", async ({ authUser, params, set }) => {
    const orgId = authUser!.orgId;
    const [mv] = await db.select().from(repairMovements).where(and(eq(repairMovements.id, params.id), eq(repairMovements.orgId, orgId)));
    if (!mv) { set.status = 404; return { error: "ไม่พบข้อมูล" }; }
    // ยกเลิกรายการรับเข้า ต้องไม่ทำให้ยอดคงเหลือติดลบ (เช่น ของที่รับเข้าไปถูกเบิกใช้ไปแล้ว)
    if (mv.type !== "out") {
      const [item] = await db.select().from(repairItems).where(eq(repairItems.id, mv.itemId));
      const moves = await db.select().from(repairMovements).where(eq(repairMovements.itemId, mv.itemId));
      if (item && summarize([item], moves)[0].stock - num(mv.quantity) < 0) {
        set.status = 400; return { error: "ลบไม่ได้ เพราะของที่รับเข้ารายการนี้ถูกเบิกใช้ไปแล้ว" };
      }
    }
    await db.delete(repairMovements).where(eq(repairMovements.id, params.id));
    return { deleted: params.id };
  });
