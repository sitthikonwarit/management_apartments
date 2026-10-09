import { Elysia } from "elysia";
import { db } from "../db";
import { specialDiscounts } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { authDerive } from "../lib/authDerive";

function parseDiscount(r: typeof specialDiscounts.$inferSelect) {
  let roomIds: string[] = [];
  try { roomIds = r.roomIds ? JSON.parse(r.roomIds) : []; } catch {}
  return {
    id: r.id,
    name: r.name,
    type: r.type === "percent" ? "percent" : "fixed",
    value: Number(r.value) || 0,
    roomIds: Array.isArray(roomIds) ? roomIds : [],
    expiryDate: r.expiryDate,
    startMonth: r.startMonth ?? "",
    createdAt: r.createdAt,
  };
}

export const specialDiscountsRoute = new Elysia({ prefix: "/special-discounts" })
  .use(authDerive)
  .get("/", async ({ authUser }) => {
    const rows = await db.select().from(specialDiscounts).where(eq(specialDiscounts.orgId, authUser!.orgId));
    return rows.map(parseDiscount);
  })
  .post("/", async ({ authUser, body, set }) => {
    const orgId = authUser!.orgId;
    const { name, type, value, roomIds, expiryDate, startMonth } = body as any;
    if (!name?.trim()) { set.status = 400; return { error: "ต้องระบุชื่อส่วนลด" }; }
    if (!Array.isArray(roomIds) || roomIds.length === 0) { set.status = 400; return { error: "ต้องเลือกห้องอย่างน้อย 1 ห้อง" }; }
    const id = `SD-${Date.now()}`;
    await db.insert(specialDiscounts).values({
      id,
      orgId,
      name: name.trim(),
      type: type === "percent" ? "percent" : "fixed",
      value: String(value ?? 0),
      roomIds: JSON.stringify(roomIds),
      expiryDate: String(expiryDate ?? ""),
      startMonth: String(startMonth ?? ""),
      createdAt: new Date().toISOString(),
    });
    const [row] = await db.select().from(specialDiscounts).where(eq(specialDiscounts.id, id));
    return parseDiscount(row);
  })
  .put("/:id", async ({ authUser, params, body, set }) => {
    const { id } = params;
    const { name, type, value, roomIds, expiryDate, startMonth } = body as any;
    const [existing] = await db.select().from(specialDiscounts).where(and(eq(specialDiscounts.id, id), eq(specialDiscounts.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบข้อมูล" }; }
    await db.update(specialDiscounts).set({
      name:       name?.trim() ?? existing.name,
      type:       type === "percent" ? "percent" : type === "fixed" ? "fixed" : existing.type,
      value:      value !== undefined ? String(value) : existing.value,
      roomIds:    Array.isArray(roomIds) ? JSON.stringify(roomIds) : existing.roomIds,
      expiryDate: expiryDate !== undefined ? String(expiryDate) : existing.expiryDate,
      startMonth: startMonth !== undefined ? String(startMonth) : existing.startMonth,
    }).where(eq(specialDiscounts.id, id));
    const [row] = await db.select().from(specialDiscounts).where(eq(specialDiscounts.id, id));
    return parseDiscount(row);
  })
  .delete("/:id", async ({ authUser, params, set }) => {
    const [existing] = await db.select().from(specialDiscounts).where(and(eq(specialDiscounts.id, params.id), eq(specialDiscounts.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบข้อมูล" }; }
    await db.delete(specialDiscounts).where(eq(specialDiscounts.id, params.id));
    return { deleted: params.id };
  });
