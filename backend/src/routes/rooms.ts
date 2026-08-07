import { Elysia } from "elysia";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { rooms, towers, roomTags, tenants, bookings } from "../db/schema";
import { authDerive } from "../lib/authDerive";
import { signUploadPath } from "../lib/encryption";

function j<T>(val: string, def: T): T {
  try { return val ? JSON.parse(val) : def; } catch { return def; }
}

// รูป path เก็บดิบๆ ไม่มีลายเซ็นในฐานข้อมูล (ดู lib/encryption.ts) — เซ็นตอนส่งออกให้ frontend ตรงนี้เท่านั้น
function signPictures(pics: { url: string; name?: string }[]): { url: string; name?: string }[] {
  return pics.map((p) => ({ ...p, url: signUploadPath(p.url) }));
}

function parseRoom(r: typeof rooms.$inferSelect) {
  return {
    id: r.id,
    code: r.code,
    number: r.number,
    detail: r.detail,
    price: Number(r.price) || 0,
    dailyPrice: Number(r.dailyPrice) || 0,
    pictures: signPictures(j(r.pictures, [])),
    status: r.status,
    floor: r.floor,
    towerId: r.towerId,
    tags: j(r.tags, []),
    meterWaterActive: r.meterWaterActive !== "false",
    meterElectricActive: r.meterElectricActive !== "false",
    isActive: r.isActive !== "false",
  };
}

function parseTower(r: typeof towers.$inferSelect) {
  return {
    id: r.id,
    prefix: r.prefix,
    name: r.name,
    color: r.color,
    floorCount: Number(r.floorCount) || 0,
    roomsPerFloor: j(r.roomsPerFloor, []),
    isActive: r.isActive !== "false",
    monthlyPrice: Number(r.monthlyPrice) || 0,
    dailyPrice: Number(r.dailyPrice) || 0,
    details: r.details,
  };
}

async function uploadRoomImage(orgId: string, filename: string, mimeType: string, base64Data: string): Promise<string> {
  const { writeFileSync, mkdirSync } = await import("fs");
  const { resolve } = await import("path");
  const uploadDir = resolve(process.cwd(), "uploads", "rooms", orgId);
  mkdirSync(uploadDir, { recursive: true });
  const base64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
  const buffer = Buffer.from(base64, "base64");
  const safeName = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  writeFileSync(resolve(uploadDir, safeName), buffer);
  // path สัมพัทธ์ล้วนๆ (ไม่ฝัง host:port) — ฝั่ง frontend พร็อกซี /uploads ไปที่ backend เอง (ดู vite.config.ts)
  // กัน URL รูปพังตอน IP เครื่องใน LAN เปลี่ยน (เช่น BASE_URL เดิมผูกกับ IP ที่ DHCP จ่ายใหม่ไปแล้ว)
  return `/uploads/rooms/${orgId}/${safeName}`;
}

export const roomsRoute = new Elysia({ prefix: "/rooms" })
  .use(authDerive)
  // ─── Rooms ────────────────────────────────────────────────────────────────
  .get("/", async ({ authUser }) => {
    const rows = await db.select().from(rooms).where(eq(rooms.orgId, authUser!.orgId));
    return rows.map(parseRoom);
  })
  .post("/", async ({ authUser, body }) => {
    const { number, floor, towerId, price, dailyPrice, detail, tags, code, status, isActive } = body as any;
    const id = `RM-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await db.insert(rooms).values({
      id,
      orgId: authUser!.orgId,
      code: String(code ?? ""),
      number: String(number ?? ""),
      detail: String(detail ?? ""),
      price: String(Number(price) || 0),
      dailyPrice: String(Number(dailyPrice) || 0),
      pictures: "[]",
      status: String(status ?? "ว่าง"),
      floor: String(floor ?? ""),
      towerId: String(towerId ?? ""),
      tags: JSON.stringify(Array.isArray(tags) ? tags : []),
      isActive: isActive === false ? "false" : "true",
    });
    const [row] = await db.select().from(rooms).where(eq(rooms.id, id));
    return parseRoom(row);
  })
  .post("/bulk-delete", async ({ authUser, body, set }) => {
    const orgId = authUser!.orgId;
    const { ids } = body as { ids: string[] };
    if (!ids?.length) return { deleted: [] };
    const targetRooms = await db.select().from(rooms).where(and(inArray(rooms.id, ids), eq(rooms.orgId, orgId)));
    const roomNumbers = targetRooms.map((r) => r.number).filter((n) => n);
    const targetSet = new Set([...ids, ...roomNumbers]);
    // เช็คทั้งห้องหลัก (idRoom) และห้องเพิ่มเติม (extraRoomIds, เก็บเป็น JSON text ค้นด้วย inArray ตรงๆ ไม่ได้)
    const allTenants = await db.select().from(tenants).where(eq(tenants.orgId, orgId));
    const occupants = allTenants.filter((t) =>
      targetSet.has(t.idRoom) || j(t.extraRoomIds, [] as string[]).some((rid) => targetSet.has(rid))
    );
    if (occupants.length > 0) {
      set.status = 400;
      return { error: `ไม่สามารถลบห้องได้ เนื่องจากมีผู้เช่าอยู่ในห้องที่เลือก ${occupants.length} ห้อง` };
    }
    const targetIds = targetRooms.map((r) => r.id);
    await db.delete(rooms).where(inArray(rooms.id, targetIds));
    return { deleted: targetIds };
  })
  .post("/generate", async ({ authUser, body, set }) => {
    const orgId = authUser!.orgId;
    const { towerId, roomsToCreate } = body as {
      towerId: string;
      roomsToCreate: { number: string; floor: number; price: number; dailyPrice: number; detail: string; tags?: string[] }[];
    };
    if (!towerId || !roomsToCreate?.length) { set.status = 400; return { error: "ข้อมูลไม่ครบ" }; }
    const created = [];
    for (const r of roomsToCreate) {
      const id = `RM-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await db.insert(rooms).values({
        id,
        orgId,
        code: "",
        number: String(r.number),
        detail: String(r.detail ?? ""),
        price: String(Number(r.price) || 0),
        dailyPrice: String(Number(r.dailyPrice) || 0),
        pictures: "[]",
        status: "ว่าง",
        floor: String(r.floor ?? ""),
        towerId,
        tags: JSON.stringify(Array.isArray(r.tags) ? r.tags : []),
        isActive: "true",
      });
      const [row] = await db.select().from(rooms).where(eq(rooms.id, id));
      created.push(parseRoom(row));
    }
    return { created };
  })
  .put("/:id", async ({ authUser, params, body, set }) => {
    const { id } = params;
    const [existing] = await db.select().from(rooms).where(and(eq(rooms.id, id), eq(rooms.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบห้อง" }; }
    const { number, floor, towerId, price, dailyPrice, detail, tags, code, status, isActive,
            meterWaterActive, meterElectricActive } = body as any;
    await db.update(rooms).set({
      ...(number !== undefined && { number: String(number) }),
      ...(floor !== undefined && { floor: String(floor) }),
      ...(towerId !== undefined && { towerId: String(towerId) }),
      ...(price !== undefined && { price: String(Number(price) || 0) }),
      ...(dailyPrice !== undefined && { dailyPrice: String(Number(dailyPrice) || 0) }),
      ...(detail !== undefined && { detail: String(detail) }),
      ...(tags !== undefined && { tags: JSON.stringify(Array.isArray(tags) ? tags : []) }),
      ...(code !== undefined && { code: String(code) }),
      ...(status !== undefined && { status: String(status) }),
      ...(isActive !== undefined && { isActive: isActive === false ? "false" : "true" }),
      ...(meterWaterActive !== undefined && { meterWaterActive: meterWaterActive === false ? "false" : "true" }),
      ...(meterElectricActive !== undefined && { meterElectricActive: meterElectricActive === false ? "false" : "true" }),
    }).where(eq(rooms.id, id));
    const [row] = await db.select().from(rooms).where(eq(rooms.id, id));
    return parseRoom(row);
  })
  .delete("/:id", async ({ authUser, params, set }) => {
    const orgId = authUser!.orgId;
    const [room] = await db.select().from(rooms).where(and(eq(rooms.id, params.id), eq(rooms.orgId, orgId)));
    if (!room) { set.status = 404; return { error: "ไม่พบห้อง" }; }
    const targetSet = new Set([room.id, room.number].filter(Boolean));
    const allTenants = await db.select().from(tenants).where(eq(tenants.orgId, orgId));
    const occupant = allTenants.find((t) =>
      targetSet.has(t.idRoom) || j(t.extraRoomIds, [] as string[]).some((rid) => targetSet.has(rid))
    );
    if (occupant) {
      set.status = 400;
      return { error: `ไม่สามารถลบห้องได้ เนื่องจากมีผู้เช่าอยู่ในห้องนี้ (${occupant.firstName} ${occupant.lastName})` };
    }
    await db.delete(rooms).where(eq(rooms.id, params.id));
    return { deleted: params.id };
  })
  .patch("/:id/pictures", async ({ authUser, params, body, set }) => {
    const { id } = params;
    const { keepUrls, newImages } = body as {
      keepUrls: string[];
      newImages: { base64: string; name: string }[];
    };
    const [existing] = await db.select().from(rooms).where(and(eq(rooms.id, id), eq(rooms.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบห้อง" }; }
    const existingPics: { url: string; name?: string }[] = j(existing.pictures, []);
    // keepUrls มาจาก frontend ที่ถือ URL "เซ็นแล้ว" (ได้จาก parseRoom ด้านบน) ต้องตัด ?sig=... ทิ้งก่อนเทียบ
    // กับ path ดิบที่เก็บไว้ในฐานข้อมูล ไม่งั้นจะไม่ตรงกันเลยสักรูป (กันของเก่าถูกลบทิ้งผิดพลาดหมด)
    const cleanKeepUrls = (keepUrls ?? []).map((u) => u.split("?")[0]);
    const kept = existingPics.filter((p) => cleanKeepUrls.includes(p.url));
    const uploaded: { url: string; name: string }[] = [];
    for (const img of (newImages ?? [])) {
      const mimeType = img.base64.match(/data:([^;]+);/)?.[1] ?? "image/jpeg";
      const ext = mimeType.split("/")[1] || "jpg";
      const url = await uploadRoomImage(authUser!.orgId, img.name || `room.${ext}`, mimeType, img.base64);
      uploaded.push({ url, name: img.name || "" });
    }
    const allPictures = [...kept, ...uploaded];
    await db.update(rooms).set({ pictures: JSON.stringify(allPictures) }).where(eq(rooms.id, id));
    return { pictures: signPictures(allPictures) };
  })
  .patch("/:id/active", async ({ authUser, params, body, set }) => {
    const { id } = params;
    const { isActive } = body as { isActive: boolean };
    const [existing] = await db.select().from(rooms).where(and(eq(rooms.id, id), eq(rooms.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบห้อง" }; }
    await db.update(rooms).set({ isActive: isActive ? "true" : "false" }).where(eq(rooms.id, id));
    const [row] = await db.select().from(rooms).where(eq(rooms.id, id));
    return parseRoom(row);
  })

  // ห้องที่มีคนจองเองผ่าน LIFF อยู่ (ดู POST /liff/rooms/book) แต่ยังไม่ได้ผูกเป็นผู้เช่าจริง — ใช้ในหน้า
  // "จัดการห้องพัก" แสดง "ผู้จอง" แทนช่องผู้เช่าปกติ พร้อมปุ่มนำทางไปแชทกับคนนั้น (ดู RoomsPage.tsx)
  .get("/bookings/active", async ({ authUser }) => {
    const rows = await db.select().from(bookings).where(and(eq(bookings.status, "active"), eq(bookings.orgId, authUser!.orgId)));
    return rows.map((b) => ({
      id: b.id,
      roomId: b.roomId,
      roomNumber: b.roomNumber,
      name: `${b.firstName} ${b.lastName}`.trim(),
      tel: b.tel,
      idLine: b.idLine,
      bookedAt: b.timestamp,
    }));
  })

  // ─── Towers ───────────────────────────────────────────────────────────────
  .get("/towers", async ({ authUser }) => {
    const rows = await db.select().from(towers).where(eq(towers.orgId, authUser!.orgId));
    return rows.map(parseTower);
  })
  .post("/towers", async ({ authUser, body }) => {
    const { name, prefix, color, floorCount, roomsPerFloor, monthlyPrice, dailyPrice, details } = body as any;
    const id = `TWR-${Date.now()}`;
    await db.insert(towers).values({
      id,
      orgId: authUser!.orgId,
      name: String(name ?? ""),
      prefix: String(prefix ?? ""),
      color: String(color ?? "#6C9BCF"),
      floorCount: String(Number(floorCount) || 1),
      roomsPerFloor: JSON.stringify(Array.isArray(roomsPerFloor) ? roomsPerFloor : []),
      isActive: "true",
      monthlyPrice: String(Number(monthlyPrice) || 0),
      dailyPrice: String(Number(dailyPrice) || 0),
      details: String(details ?? ""),
    });
    const [row] = await db.select().from(towers).where(eq(towers.id, id));
    return parseTower(row);
  })
  .put("/towers/:id", async ({ authUser, params, body, set }) => {
    const { id } = params;
    const [existing] = await db.select().from(towers).where(and(eq(towers.id, id), eq(towers.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบตึก" }; }
    const { name, prefix, color, floorCount, roomsPerFloor, monthlyPrice, dailyPrice, details } = body as any;
    await db.update(towers).set({
      name: String(name ?? existing.name),
      prefix: String(prefix ?? existing.prefix),
      color: String(color ?? existing.color),
      floorCount: String(Number(floorCount) || Number(existing.floorCount) || 1),
      roomsPerFloor: JSON.stringify(Array.isArray(roomsPerFloor) ? roomsPerFloor : j(existing.roomsPerFloor, [])),
      monthlyPrice: String(Number(monthlyPrice) || 0),
      dailyPrice: String(Number(dailyPrice) || 0),
      details: String(details ?? existing.details),
    }).where(eq(towers.id, id));
    const [row] = await db.select().from(towers).where(eq(towers.id, id));
    return parseTower(row);
  })
  .delete("/towers/:id", async ({ authUser, params, set }) => {
    const orgId = authUser!.orgId;
    const [existing] = await db.select().from(towers).where(and(eq(towers.id, params.id), eq(towers.orgId, orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบตึก" }; }
    const roomsInTower = await db.select().from(rooms).where(and(eq(rooms.towerId, params.id), eq(rooms.orgId, orgId)));
    if (roomsInTower.length > 0) {
      set.status = 400;
      return { error: `ไม่สามารถลบตึกได้ เนื่องจากยังมีห้องพัก ${roomsInTower.length} ห้องอยู่ในตึกนี้` };
    }
    await db.delete(towers).where(eq(towers.id, params.id));
    return { deleted: params.id };
  })
  .patch("/towers/:id/active", async ({ authUser, params, body, set }) => {
    const { id } = params;
    const { isActive } = body as { isActive: boolean };
    const [existing] = await db.select().from(towers).where(and(eq(towers.id, id), eq(towers.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบตึก" }; }
    await db.update(towers).set({ isActive: isActive ? "true" : "false" }).where(eq(towers.id, id));
    const [row] = await db.select().from(towers).where(eq(towers.id, id));
    return parseTower(row);
  })

  // ─── Tags ─────────────────────────────────────────────────────────────────
  .get("/tags", async ({ authUser }) => {
    const rows = await db.select().from(roomTags).where(eq(roomTags.orgId, authUser!.orgId));
    return rows.map((r) => ({
      id: r.id, name: r.name, icon: r.icon, color: r.color, price: Number(r.price) || 0,
    }));
  })
  .post("/tags", async ({ authUser, body }) => {
    const { name, icon, color, price } = body as any;
    const id = `RTAG-${Date.now()}`;
    await db.insert(roomTags).values({
      id, orgId: authUser!.orgId, name: String(name ?? ""), icon: String(icon ?? "fas fa-tag"),
      color: String(color ?? "#6c757d"), price: String(Number(price) || 0),
    });
    const [row] = await db.select().from(roomTags).where(eq(roomTags.id, id));
    return { id: row.id, name: row.name, icon: row.icon, color: row.color, price: Number(row.price) || 0 };
  })
  .put("/tags/:tagId", async ({ authUser, params, body, set }) => {
    const { tagId } = params;
    const [existing] = await db.select().from(roomTags).where(and(eq(roomTags.id, tagId), eq(roomTags.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบแท็ก" }; }
    const { name, icon, color, price } = body as any;
    await db.update(roomTags).set({
      name: String(name ?? ""), icon: String(icon ?? ""), color: String(color ?? ""), price: String(Number(price) || 0),
    }).where(eq(roomTags.id, tagId));
    const [row] = await db.select().from(roomTags).where(eq(roomTags.id, tagId));
    return { id: row.id, name: row.name, icon: row.icon, color: row.color, price: Number(row.price) || 0 };
  })
  .delete("/tags/:tagId", async ({ authUser, params }) => {
    await db.delete(roomTags).where(and(eq(roomTags.id, params.tagId), eq(roomTags.orgId, authUser!.orgId)));
    return { success: true };
  });
