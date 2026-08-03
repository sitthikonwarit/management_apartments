import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { tenants, tenantTags, rooms } from "../db/schema";
import { uploadFileToDrive } from "../services/sheets";

function j<T>(val: string, def: T): T {
  try { return val ? JSON.parse(val) : def; } catch { return def; }
}

type TenantRow = typeof tenants.$inferSelect;

function parseTenant(r: TenantRow) {
  return {
    id: r.id,
    checkInDate: r.checkInDate,
    amount: r.amount,
    idLicense: r.idLicense,
    title: r.title,
    firstName: r.firstName,
    lastName: r.lastName,
    tel: r.tel,
    idLine: r.idLine,
    houseNo: r.houseNo,
    soi: r.soi,
    road: r.road,
    province: r.province,
    amphoe: r.amphoe,
    tambon: r.tambon,
    zipcode: r.zipcode,
    address: r.address,
    idRoom: r.idRoom,
    extraRoomIds: j(r.extraRoomIds, [] as string[]),
    contractStartDate: r.contractStartDate,
    contractEndDate: r.contractEndDate,
    tags: j(r.tags, []),
    lineUserId: r.lineUserId,
    coResidents: j(r.coResidents, []),
    pdfLinks: j(r.pdfLinks, []),
    driveImageUrl: r.driveImageUrl,
    overdue: {
      override: r.overdueOverride === "true",
      enabled: r.overdueEnabled === "true",
      day: Number(r.overdueDay) || 0,
      type: r.overdueFineType || "fixed",
      amount: Number(r.overdueFineAmount) || 0,
    },
  };
}

export const tenantsRoute = new Elysia({ prefix: "/tenants" })
  .get("/", async () => {
    const rows = await db.select().from(tenants);
    return rows.map(parseTenant);
  })
  .get("/tags", async () => {
    const rows = await db.select().from(tenantTags);
    return rows.map((r) => ({
      id: r.id, name: r.name, icon: r.icon, color: r.color, price: Number(r.price) || 0,
    }));
  })
  .post("/tags", async ({ body }) => {
    const { name, icon, color, price } = body as any;
    const id = `TAG-${Date.now()}`;
    await db.insert(tenantTags).values({
      id, name: String(name ?? ""), icon: String(icon ?? "fas fa-tag"),
      color: String(color ?? "#6C9BCF"), price: String(Number(price) || 0),
    });
    const [row] = await db.select().from(tenantTags).where(eq(tenantTags.id, id));
    return { id: row.id, name: row.name, icon: row.icon, color: row.color, price: Number(row.price) || 0 };
  })
  .put("/tags/:tagId", async ({ params, body, set }) => {
    const { name, icon, color, price } = body as any;
    const { tagId } = params;
    const [existing] = await db.select().from(tenantTags).where(eq(tenantTags.id, tagId));
    if (!existing) { set.status = 404; return { error: "ไม่พบแท็ก" }; }
    await db.update(tenantTags).set({
      name: String(name ?? ""), icon: String(icon ?? ""), color: String(color ?? ""), price: String(Number(price) || 0),
    }).where(eq(tenantTags.id, tagId));
    const [row] = await db.select().from(tenantTags).where(eq(tenantTags.id, tagId));
    return { id: row.id, name: row.name, icon: row.icon, color: row.color, price: Number(row.price) || 0 };
  })
  .delete("/tags/:tagId", async ({ params }) => {
    const { tagId } = params;
    await db.delete(tenantTags).where(eq(tenantTags.id, tagId));
    return { success: true };
  })
  .post("/", async ({ body }) => {
    const { formData, imageBase64, pdfFiles } = body as any;

    const id = `CUS-${Date.now()}`;
    const now = new Date();
    // ISO ค.ศ. เหมือน contractStartDate/contractEndDate — แปลงเป็น พ.ศ./ค.ศ. แค่ตอนแสดงผลฝั่ง frontend
    const checkInDate = now.toISOString().slice(0, 10);

    let driveImageUrl = "";
    if (imageBase64) {
      const mimeType = imageBase64.match(/data:([^;]+);/)?.[1] ?? "image/jpeg";
      const ext = mimeType.split("/")[1] || "jpg";
      driveImageUrl = await uploadFileToDrive(`${id}_photo.${ext}`, mimeType, imageBase64);
    }

    let pdfLinksArr: any[] = [];
    if (Array.isArray(pdfFiles)) {
      for (const pdf of pdfFiles) {
        const url = await uploadFileToDrive(pdf.name, "application/pdf", pdf.data);
        pdfLinksArr.push({ name: pdf.name, url });
      }
    }

    const newTenant = {
      id,
      checkInDate,
      amount: String(formData.amount ?? ""),
      idLicense: String(formData.idLicense ?? ""),
      title: String(formData.title ?? ""),
      firstName: String(formData.firstName ?? ""),
      lastName: String(formData.lastName ?? ""),
      houseNo: String(formData.houseNo ?? ""),
      soi: String(formData.soi ?? ""),
      road: String(formData.road ?? ""),
      province: String(formData.province ?? ""),
      amphoe: String(formData.amphoe ?? ""),
      tambon: String(formData.tambon ?? ""),
      zipcode: String(formData.zipcode ?? ""),
      address: String(formData.address ?? ""),
      tel: String(formData.tel ?? ""),
      idLine: String(formData.idLine ?? ""),
      pdfLinks: JSON.stringify(pdfLinksArr),
      driveImageUrl,
      idRoom: String(formData.roomId ?? ""),
      extraRoomIds: JSON.stringify(Array.isArray(formData.extraRoomIds) ? formData.extraRoomIds.filter(Boolean) : []),
      contractStartDate: "",
      contractEndDate: "",
      tags: "[]",
      lineUserId: String(formData.lineUserId ?? ""),
      coResidents: "[]",
    };

    await db.insert(tenants).values(newTenant);
    const occupiedRoomIds = [newTenant.idRoom, ...j(newTenant.extraRoomIds, [] as string[])].filter(Boolean);
    for (const rid of occupiedRoomIds) {
      await db.update(rooms).set({ status: "ไม่ว่าง" }).where(eq(rooms.id, rid));
    }
    const [inserted] = await db.select().from(tenants).where(eq(tenants.id, id));
    return parseTenant(inserted);
  })
  .put("/:id", async ({ params, body, set }) => {
    const { formData, imageBase64, pdfFiles, pdfLinksToKeep } = body as any;
    const { id } = params;

    const [existing] = await db.select().from(tenants).where(eq(tenants.id, id));
    if (!existing) { set.status = 404; return { error: "ไม่พบผู้เช่า" }; }

    let driveImageUrl = existing.driveImageUrl;
    if (imageBase64) {
      const mimeType = imageBase64.match(/data:([^;]+);/)?.[1] ?? "image/jpeg";
      const ext = mimeType.split("/")[1] || "jpg";
      driveImageUrl = await uploadFileToDrive(`${id}_photo.${ext}`, mimeType, imageBase64);
    }

    let pdfLinksArr: any[] = Array.isArray(pdfLinksToKeep) ? pdfLinksToKeep : j(existing.pdfLinks, []);
    if (Array.isArray(pdfFiles)) {
      for (const pdf of pdfFiles) {
        const url = await uploadFileToDrive(pdf.name, "application/pdf", pdf.data);
        pdfLinksArr.push({ name: pdf.name, url });
      }
    }

    await db.update(tenants).set({
      amount: String(formData.amount ?? ""),
      idLicense: String(formData.idLicense ?? ""),
      title: String(formData.title ?? ""),
      firstName: String(formData.firstName ?? ""),
      lastName: String(formData.lastName ?? ""),
      tel: String(formData.tel ?? ""),
      idLine: String(formData.idLine ?? ""),
      lineUserId: String(formData.lineUserId ?? ""),
      houseNo: String(formData.houseNo ?? ""),
      soi: String(formData.soi ?? ""),
      road: String(formData.road ?? ""),
      province: String(formData.province ?? ""),
      amphoe: String(formData.amphoe ?? ""),
      tambon: String(formData.tambon ?? ""),
      zipcode: String(formData.zipcode ?? ""),
      address: String(formData.address ?? ""),
      contractStartDate: String(formData.contractStartDate ?? ""),
      contractEndDate: String(formData.contractEndDate ?? ""),
      driveImageUrl,
      pdfLinks: JSON.stringify(pdfLinksArr),
      overdueOverride: formData.overdue?.override ? "true" : "false",
      overdueEnabled: formData.overdue?.enabled ? "true" : "false",
      overdueDay: String(Number(formData.overdue?.day) || 0),
      overdueFineType: String(formData.overdue?.type ?? "fixed"),
      overdueFineAmount: String(Number(formData.overdue?.amount) || 0),
    }).where(eq(tenants.id, id));

    const [updated] = await db.select().from(tenants).where(eq(tenants.id, id));
    return parseTenant(updated);
  })
  .patch("/:id/tags", async ({ params, body, set }) => {
    const { tags } = body as any;
    const { id } = params;
    const [existing] = await db.select().from(tenants).where(eq(tenants.id, id));
    if (!existing) { set.status = 404; return { error: "ไม่พบผู้เช่า" }; }
    await db.update(tenants).set({ tags: JSON.stringify(tags ?? []) }).where(eq(tenants.id, id));
    const [updated] = await db.select().from(tenants).where(eq(tenants.id, id));
    return parseTenant(updated);
  })
  .patch("/:id/co-residents", async ({ params, body, set }) => {
    const { coResidents } = body as any;
    const { id } = params;

    const [existing] = await db.select().from(tenants).where(eq(tenants.id, id));
    if (!existing) { set.status = 404; return { error: "ไม่พบผู้เช่า" }; }

    const processed = await Promise.all(
      (coResidents ?? []).map(async (cr: any) => {
        if (cr.imageBase64) {
          const mimeType = cr.imageBase64.match(/data:([^;]+);/)?.[1] ?? "image/jpeg";
          const ext = mimeType.split("/")[1] || "jpg";
          const url = await uploadFileToDrive(`${id}_co_${Date.now()}.${ext}`, mimeType, cr.imageBase64);
          const { imageBase64: _b, ...rest } = cr;
          return { ...rest, image: url };
        }
        return cr;
      })
    );

    await db.update(tenants).set({ coResidents: JSON.stringify(processed) }).where(eq(tenants.id, id));
    const [updated] = await db.select().from(tenants).where(eq(tenants.id, id));
    return parseTenant(updated);
  })
  .delete("/:id", async ({ params, set }) => {
    const { id } = params;
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
    if (!tenant) { set.status = 404; return { error: "ไม่พบผู้เช่า" }; }
    const vacatedRoomIds = [tenant.idRoom, ...j(tenant.extraRoomIds, [] as string[])].filter(Boolean);
    for (const rid of vacatedRoomIds) {
      await db.update(rooms).set({ status: "ว่าง" }).where(eq(rooms.id, rid));
    }
    await db.delete(tenants).where(eq(tenants.id, id));
    return { success: true };
  })
  .patch("/:id/room", async ({ params, body, set }) => {
    const { newRoomId } = body as any;
    const { id } = params;

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
    if (!tenant) { set.status = 404; return { error: "ไม่พบผู้เช่า" }; }

    const oldRoomId = tenant.idRoom;

    if (oldRoomId && oldRoomId !== newRoomId) {
      await db.update(rooms).set({ status: "ว่าง" }).where(eq(rooms.id, oldRoomId));
    }
    if (newRoomId) {
      await db.update(rooms).set({ status: "ไม่ว่าง" }).where(eq(rooms.id, newRoomId));
    }

    await db.update(tenants).set({ idRoom: newRoomId ?? "" }).where(eq(tenants.id, id));

    const [updated] = await db.select().from(tenants).where(eq(tenants.id, id));
    return parseTenant(updated);
  })
  // ห้องเพิ่มเติมนอกเหนือจากห้องหลัก (idRoom) — รองรับ 1 ผู้เช่า เช่าได้หลายห้อง
  .patch("/:id/extra-rooms", async ({ params, body, set }) => {
    const { extraRoomIds } = body as any;
    const { id } = params;

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
    if (!tenant) { set.status = 404; return { error: "ไม่พบผู้เช่า" }; }

    const oldIds = j(tenant.extraRoomIds, [] as string[]);
    const newIds: string[] = Array.isArray(extraRoomIds) ? extraRoomIds.filter(Boolean) : [];

    const removed = oldIds.filter((rid) => !newIds.includes(rid));
    const added = newIds.filter((rid) => !oldIds.includes(rid));
    for (const rid of removed) {
      await db.update(rooms).set({ status: "ว่าง" }).where(eq(rooms.id, rid));
    }
    for (const rid of added) {
      await db.update(rooms).set({ status: "ไม่ว่าง" }).where(eq(rooms.id, rid));
    }

    await db.update(tenants).set({ extraRoomIds: JSON.stringify(newIds) }).where(eq(tenants.id, id));

    const [updated] = await db.select().from(tenants).where(eq(tenants.id, id));
    return parseTenant(updated);
  });
