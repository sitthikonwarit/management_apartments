import { Elysia } from "elysia";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { tenants, tenantTags, rooms } from "../db/schema";
import { uploadFileToDrive } from "../services/sheets";
import { authDerive } from "../lib/authDerive";
import { encryptField, decryptField, signUploadPath } from "../lib/encryption";

function j<T>(val: string, def: T): T {
  try { return val ? JSON.parse(val) : def; } catch { return def; }
}

type TenantRow = typeof tenants.$inferSelect;

// เลขบัตร ปชช./ที่อยู่ เข้ารหัสไว้ในฐานข้อมูล (ดู lib/encryption.ts) ต้องถอดรหัสตรงนี้ทุกครั้งที่อ่านออกมา —
// decryptField เองรองรับข้อมูลเก่าที่ยังเป็น plaintext (ก่อน migrate) คืนค่าตรงๆ โดยอัตโนมัติอยู่แล้ว
function parseTenant(r: TenantRow) {
  return {
    id: r.id,
    checkInDate: r.checkInDate,
    amount: r.amount,
    idLicense: decryptField(r.idLicense),
    title: r.title,
    firstName: r.firstName,
    lastName: r.lastName,
    tel: r.tel,
    idLine: r.idLine,
    houseNo: decryptField(r.houseNo),
    soi: decryptField(r.soi),
    road: decryptField(r.road),
    province: decryptField(r.province),
    amphoe: decryptField(r.amphoe),
    tambon: decryptField(r.tambon),
    zipcode: decryptField(r.zipcode),
    address: decryptField(r.address),
    idRoom: r.idRoom,
    extraRoomIds: j(r.extraRoomIds, [] as string[]),
    contractStartDate: r.contractStartDate,
    contractEndDate: r.contractEndDate,
    tags: j(r.tags, []),
    lineUserId: r.lineUserId,
    // รูป/ไฟล์ที่อัปโหลดของผู้เช่า (ถ่ายรูปตอนเข้าอยู่, ผู้ร่วมพักอาศัย, ไฟล์แนบ) เก็บเป็น path ใต้
    // /uploads/tenants/ จริงๆ (ชื่อฟังก์ชัน uploadFileToDrive ใน services/sheets.ts เข้าใจผิดได้ — จริงๆ เขียน
    // ลงดิสก์เครื่องนี้ ไม่ใช่ Google Drive) ต้องเซ็นลายเซ็นก่อนส่งออกเหมือนรูป path อื่นๆ ทั้งหมด
    coResidents: j(r.coResidents, []).map((cr: any) => (cr?.image ? { ...cr, image: signUploadPath(cr.image) } : cr)),
    pdfLinks: j(r.pdfLinks, []).map((f: any) => (f?.url ? { ...f, url: signUploadPath(f.url) } : f)),
    driveImageUrl: signUploadPath(r.driveImageUrl),
    isTest: r.isTest === "true",
    overdue: {
      override: r.overdueOverride === "true",
      enabled: r.overdueEnabled === "true",
      day: Number(r.overdueDay) || 0,
      type: r.overdueFineType || "fixed",
      amount: Number(r.overdueFineAmount) || 0,
    },
  };
}

// อัปเดตสถานะห้อง "เฉพาะห้องขององค์กรนี้เท่านั้น" (กัน id ห้องจากองค์กรอื่นหลุดมากับ extraRoomIds/newRoomId)
async function setRoomStatus(orgId: string, roomId: string, status: string) {
  await db.update(rooms).set({ status }).where(and(eq(rooms.id, roomId), eq(rooms.orgId, orgId)));
}

export const tenantsRoute = new Elysia({ prefix: "/tenants" })
  .use(authDerive)
  .get("/", async ({ authUser }) => {
    const rows = await db.select().from(tenants).where(eq(tenants.orgId, authUser!.orgId));
    return rows.map(parseTenant);
  })
  .get("/tags", async ({ authUser }) => {
    const rows = await db.select().from(tenantTags).where(eq(tenantTags.orgId, authUser!.orgId));
    return rows.map((r) => ({
      id: r.id, name: r.name, icon: r.icon, color: r.color, price: Number(r.price) || 0,
    }));
  })
  .post("/tags", async ({ authUser, body }) => {
    const { name, icon, color, price } = body as any;
    const id = `TAG-${Date.now()}`;
    await db.insert(tenantTags).values({
      id, orgId: authUser!.orgId, name: String(name ?? ""), icon: String(icon ?? "fas fa-tag"),
      color: String(color ?? "#6C9BCF"), price: String(Number(price) || 0),
    });
    const [row] = await db.select().from(tenantTags).where(eq(tenantTags.id, id));
    return { id: row.id, name: row.name, icon: row.icon, color: row.color, price: Number(row.price) || 0 };
  })
  .put("/tags/:tagId", async ({ authUser, params, body, set }) => {
    const { name, icon, color, price } = body as any;
    const { tagId } = params;
    const [existing] = await db.select().from(tenantTags).where(and(eq(tenantTags.id, tagId), eq(tenantTags.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบแท็ก" }; }
    await db.update(tenantTags).set({
      name: String(name ?? ""), icon: String(icon ?? ""), color: String(color ?? ""), price: String(Number(price) || 0),
    }).where(eq(tenantTags.id, tagId));
    const [row] = await db.select().from(tenantTags).where(eq(tenantTags.id, tagId));
    return { id: row.id, name: row.name, icon: row.icon, color: row.color, price: Number(row.price) || 0 };
  })
  .delete("/tags/:tagId", async ({ authUser, params }) => {
    const { tagId } = params;
    await db.delete(tenantTags).where(and(eq(tenantTags.id, tagId), eq(tenantTags.orgId, authUser!.orgId)));
    return { success: true };
  })
  .post("/", async ({ authUser, body }) => {
    const orgId = authUser!.orgId;
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
      orgId,
      checkInDate,
      amount: String(formData.amount ?? ""),
      idLicense: encryptField(String(formData.idLicense ?? "")),
      title: String(formData.title ?? ""),
      firstName: String(formData.firstName ?? ""),
      lastName: String(formData.lastName ?? ""),
      houseNo: encryptField(String(formData.houseNo ?? "")),
      soi: encryptField(String(formData.soi ?? "")),
      road: encryptField(String(formData.road ?? "")),
      province: encryptField(String(formData.province ?? "")),
      amphoe: encryptField(String(formData.amphoe ?? "")),
      tambon: encryptField(String(formData.tambon ?? "")),
      zipcode: encryptField(String(formData.zipcode ?? "")),
      address: encryptField(String(formData.address ?? "")),
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
      await setRoomStatus(orgId, rid, "ไม่ว่าง");
    }
    const [inserted] = await db.select().from(tenants).where(eq(tenants.id, id));
    return parseTenant(inserted);
  })
  .put("/:id", async ({ authUser, params, body, set }) => {
    const { formData, imageBase64, pdfFiles, pdfLinksToKeep } = body as any;
    const { id } = params;

    const [existing] = await db.select().from(tenants).where(and(eq(tenants.id, id), eq(tenants.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบผู้เช่า" }; }

    let driveImageUrl = existing.driveImageUrl;
    if (imageBase64) {
      const mimeType = imageBase64.match(/data:([^;]+);/)?.[1] ?? "image/jpeg";
      const ext = mimeType.split("/")[1] || "jpg";
      driveImageUrl = await uploadFileToDrive(`${id}_photo.${ext}`, mimeType, imageBase64);
    }

    // pdfLinksToKeep มาจาก frontend ที่ถือ url "เซ็นแล้ว" (ได้จาก parseTenant ด้านบน) ต้องตัด ?sig=... ทิ้ง
    // ก่อนเก็บกลับเข้าฐานข้อมูล ไม่งั้นจะมี path ที่มีลายเซ็นติดค้างอยู่ในฐานข้อมูลถาวร (ผิดหลักที่ตั้งไว้ว่า
    // ฐานข้อมูลเก็บ path ดิบเสมอ เซ็นตอนส่งออกเท่านั้น — ดู lib/encryption.ts) แล้วพังถ้าหมุนกุญแจเซ็นทีหลัง
    // ต้องกรองด้วยว่า url ที่ส่งมามีอยู่จริงใน pdfLinks เดิมของผู้เช่ารายนี้เท่านั้น (เหมือน kept ใน rooms.ts:
    // PATCH /:id/pictures และ vehicles.ts: PATCH /:id/images) ห้ามเก็บ url ใดๆ ที่ client ยัดมาเองตรงๆ โดยไม่
    // เช็ค ไม่งั้นใครก็แนบ path ไฟล์ขององค์กรอื่นมาได้ แล้วฟังก์ชัน signUploadPath จะเซ็นให้เปิดดูได้จริงตอน
    // GET /tenants (ไม่มีการเช็คว่าไฟล์นั้นเป็นขององค์กร/ผู้เช่ารายนี้จริงหรือไม่ นอกจากเช็คแค่ลายเซ็น HMAC)
    const existingPdfLinks: any[] = j(existing.pdfLinks, []);
    const existingPdfUrls = new Set(existingPdfLinks.map((f: any) => f?.url).filter(Boolean));
    let pdfLinksArr: any[] = Array.isArray(pdfLinksToKeep)
      ? pdfLinksToKeep
          .map((f: any) => (f?.url ? { ...f, url: String(f.url).split("?")[0] } : f))
          .filter((f: any) => f?.url && existingPdfUrls.has(f.url))
      : existingPdfLinks;
    if (Array.isArray(pdfFiles)) {
      for (const pdf of pdfFiles) {
        const url = await uploadFileToDrive(pdf.name, "application/pdf", pdf.data);
        pdfLinksArr.push({ name: pdf.name, url });
      }
    }

    await db.update(tenants).set({
      amount: String(formData.amount ?? ""),
      idLicense: encryptField(String(formData.idLicense ?? "")),
      title: String(formData.title ?? ""),
      firstName: String(formData.firstName ?? ""),
      lastName: String(formData.lastName ?? ""),
      tel: String(formData.tel ?? ""),
      idLine: String(formData.idLine ?? ""),
      lineUserId: String(formData.lineUserId ?? ""),
      houseNo: encryptField(String(formData.houseNo ?? "")),
      soi: encryptField(String(formData.soi ?? "")),
      road: encryptField(String(formData.road ?? "")),
      province: encryptField(String(formData.province ?? "")),
      amphoe: encryptField(String(formData.amphoe ?? "")),
      tambon: encryptField(String(formData.tambon ?? "")),
      zipcode: encryptField(String(formData.zipcode ?? "")),
      address: encryptField(String(formData.address ?? "")),
      contractStartDate: String(formData.contractStartDate ?? ""),
      contractEndDate: String(formData.contractEndDate ?? ""),
      driveImageUrl,
      pdfLinks: JSON.stringify(pdfLinksArr),
      isTest: formData.isTest ? "true" : "false",
      overdueOverride: formData.overdue?.override ? "true" : "false",
      overdueEnabled: formData.overdue?.enabled ? "true" : "false",
      overdueDay: String(Number(formData.overdue?.day) || 0),
      overdueFineType: String(formData.overdue?.type ?? "fixed"),
      overdueFineAmount: String(Number(formData.overdue?.amount) || 0),
    }).where(eq(tenants.id, id));

    const [updated] = await db.select().from(tenants).where(eq(tenants.id, id));
    return parseTenant(updated);
  })
  .patch("/:id/tags", async ({ authUser, params, body, set }) => {
    const { tags } = body as any;
    const { id } = params;
    const [existing] = await db.select().from(tenants).where(and(eq(tenants.id, id), eq(tenants.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบผู้เช่า" }; }
    await db.update(tenants).set({ tags: JSON.stringify(tags ?? []) }).where(eq(tenants.id, id));
    const [updated] = await db.select().from(tenants).where(eq(tenants.id, id));
    return parseTenant(updated);
  })
  .patch("/:id/co-residents", async ({ authUser, params, body, set }) => {
    const { coResidents } = body as any;
    const { id } = params;

    const [existing] = await db.select().from(tenants).where(and(eq(tenants.id, id), eq(tenants.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบผู้เช่า" }; }

    // รูปเดิมของผู้ร่วมพักอาศัยที่มีอยู่จริงในฐานข้อมูลตอนนี้ — ใช้กรอง cr.image ที่ frontend ส่งกลับมาด้านล่าง
    // (เหมือน pdfLinksToKeep ด้านบน) ห้ามเก็บ url ใดๆ ที่ client ยัดมาเองตรงๆ โดยไม่เช็คว่ามีอยู่จริงในรายการเดิม
    const existingCoResidentImages = new Set(
      j(existing.coResidents, []).map((cr: any) => cr?.image).filter(Boolean)
    );

    const processed = await Promise.all(
      (coResidents ?? []).map(async (cr: any) => {
        if (cr.imageBase64) {
          const mimeType = cr.imageBase64.match(/data:([^;]+);/)?.[1] ?? "image/jpeg";
          const ext = mimeType.split("/")[1] || "jpg";
          const url = await uploadFileToDrive(`${id}_co_${Date.now()}.${ext}`, mimeType, cr.imageBase64);
          const { imageBase64: _b, ...rest } = cr;
          return { ...rest, image: url };
        }
        // ไม่มีรูปใหม่ = เก็บรูปเดิมไว้ — cr.image ที่ frontend ส่งมาอาจเป็น url "เซ็นแล้ว" (ได้จาก parseTenant
        // ด้านบน) ต้องตัด ?sig=... ทิ้งก่อนเก็บกลับ เหมือน pdfLinksToKeep ด้านบน (ดู lib/encryption.ts) แล้วเช็ค
        // ว่า path ที่เหลือ (หลังตัด ?sig=...) ตรงกับรูปเดิมของผู้ร่วมพักอาศัยรายนี้จริง ไม่งั้นทิ้งรูปนั้นไป
        if (!cr.image) return cr;
        const rawImage = String(cr.image).split("?")[0];
        return existingCoResidentImages.has(rawImage) ? { ...cr, image: rawImage } : { ...cr, image: "" };
      })
    );

    await db.update(tenants).set({ coResidents: JSON.stringify(processed) }).where(eq(tenants.id, id));
    const [updated] = await db.select().from(tenants).where(eq(tenants.id, id));
    return parseTenant(updated);
  })
  .delete("/:id", async ({ authUser, params, set }) => {
    const orgId = authUser!.orgId;
    const { id } = params;
    const [tenant] = await db.select().from(tenants).where(and(eq(tenants.id, id), eq(tenants.orgId, orgId)));
    if (!tenant) { set.status = 404; return { error: "ไม่พบผู้เช่า" }; }
    const vacatedRoomIds = [tenant.idRoom, ...j(tenant.extraRoomIds, [] as string[])].filter(Boolean);
    for (const rid of vacatedRoomIds) {
      await setRoomStatus(orgId, rid, "ว่าง");
    }
    await db.delete(tenants).where(eq(tenants.id, id));
    return { success: true };
  })
  .patch("/:id/room", async ({ authUser, params, body, set }) => {
    const orgId = authUser!.orgId;
    const { newRoomId } = body as any;
    const { id } = params;

    const [tenant] = await db.select().from(tenants).where(and(eq(tenants.id, id), eq(tenants.orgId, orgId)));
    if (!tenant) { set.status = 404; return { error: "ไม่พบผู้เช่า" }; }

    const oldRoomId = tenant.idRoom;

    if (oldRoomId && oldRoomId !== newRoomId) {
      await setRoomStatus(orgId, oldRoomId, "ว่าง");
    }
    if (newRoomId) {
      await setRoomStatus(orgId, newRoomId, "ไม่ว่าง");
    }

    await db.update(tenants).set({ idRoom: newRoomId ?? "" }).where(eq(tenants.id, id));

    const [updated] = await db.select().from(tenants).where(eq(tenants.id, id));
    return parseTenant(updated);
  })
  // ห้องเพิ่มเติมนอกเหนือจากห้องหลัก (idRoom) — รองรับ 1 ผู้เช่า เช่าได้หลายห้อง
  .patch("/:id/extra-rooms", async ({ authUser, params, body, set }) => {
    const orgId = authUser!.orgId;
    const { extraRoomIds } = body as any;
    const { id } = params;

    const [tenant] = await db.select().from(tenants).where(and(eq(tenants.id, id), eq(tenants.orgId, orgId)));
    if (!tenant) { set.status = 404; return { error: "ไม่พบผู้เช่า" }; }

    const oldIds = j(tenant.extraRoomIds, [] as string[]);
    const newIds: string[] = Array.isArray(extraRoomIds) ? extraRoomIds.filter(Boolean) : [];

    const removed = oldIds.filter((rid) => !newIds.includes(rid));
    const added = newIds.filter((rid) => !oldIds.includes(rid));
    for (const rid of removed) {
      await setRoomStatus(orgId, rid, "ว่าง");
    }
    for (const rid of added) {
      await setRoomStatus(orgId, rid, "ไม่ว่าง");
    }

    await db.update(tenants).set({ extraRoomIds: JSON.stringify(newIds) }).where(eq(tenants.id, id));

    const [updated] = await db.select().from(tenants).where(eq(tenants.id, id));
    return parseTenant(updated);
  });
