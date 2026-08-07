import { Elysia } from "elysia";
import { db } from "../db";
import { vehicles, vehicleTypes } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { authDerive } from "../lib/authDerive";
import { signUploadPath } from "../lib/encryption";

// ปกติ images คือ array ของ url string ล้วนๆ (ตามที่ uploadVehicleImage คืนค่ามาเสมอ) แต่ข้อมูลเก่ายุค
// Google Sheets/Drive (ก่อนย้ายมาเก็บไฟล์เองใน uploads/vehicles/) บางคันยังเป็น array ของ object
// {id, url, viewUrl, name} อยู่ — ต้องดึง url ออกมาก่อนเสมอ ไม่งั้น signUploadPath จะพังตอนเจอ object แทน
// string (ดู lib/encryption.ts) และฝั่ง frontend ที่ประกาศ type ไว้เป็น string[] ก็จะได้ url ที่ถูกต้องด้วย
function normalizeImageEntry(img: unknown): string {
  if (typeof img === "string") return img;
  if (img && typeof img === "object" && typeof (img as any).url === "string") return (img as any).url;
  return "";
}

function parseVehicle(r: typeof vehicles.$inferSelect) {
  let images: unknown[] = [];
  try { images = r.images ? JSON.parse(r.images) : []; } catch {}
  return {
    id: r.id,
    customerId: r.customerId,
    licensePlate: r.licensePlate,
    vehicleTypeId: r.vehicleTypeId,
    brand: r.brand,
    color: r.color,
    parkingFee: Number(r.parkingFee) || 0,
    // path เก็บดิบๆ ไม่มีลายเซ็นในฐานข้อมูล (ดู lib/encryption.ts) — เซ็นตอนส่งออกให้ frontend ตรงนี้เท่านั้น
    // (URL ของ Google Drive เดิม ไม่ใช่ path ใต้ /uploads/ signUploadPath จะข้ามให้เองอัตโนมัติ)
    images: images.map(normalizeImageEntry).filter(Boolean).map(signUploadPath),
    createdAt: r.createdAt,
  };
}

function parseType(r: typeof vehicleTypes.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    defaultFee: Number(r.defaultFee) || 0,
    isActive: r.isActive !== "false",
  };
}

async function uploadVehicleImage(orgId: string, filename: string, mimeType: string, base64Data: string): Promise<string> {
  const { writeFileSync, mkdirSync } = await import("fs");
  const { resolve } = await import("path");
  const uploadDir = resolve(process.cwd(), "uploads", "vehicles", orgId);
  mkdirSync(uploadDir, { recursive: true });
  const base64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
  const buffer = Buffer.from(base64, "base64");
  const safeName = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  writeFileSync(resolve(uploadDir, safeName), buffer);
  // path สัมพัทธ์ล้วนๆ (ไม่ฝัง host:port) — ฝั่ง frontend พร็อกซี /uploads ไปที่ backend เอง (ดู vite.config.ts)
  // กัน URL รูปพังตอน IP เครื่องใน LAN เปลี่ยน (เช่น BASE_URL เดิมผูกกับ IP ที่ DHCP จ่ายใหม่ไปแล้ว)
  return `/uploads/vehicles/${orgId}/${safeName}`;
}

async function uploadNewImages(orgId: string, newImages: { base64: string; name: string }[] | undefined): Promise<string[]> {
  const uploaded: string[] = [];
  for (const img of (newImages ?? [])) {
    const mimeType = img.base64.match(/data:([^;]+);/)?.[1] ?? "image/jpeg";
    const ext = mimeType.split("/")[1] || "jpg";
    uploaded.push(await uploadVehicleImage(orgId, img.name || `vehicle.${ext}`, mimeType, img.base64));
  }
  return uploaded;
}

export const vehiclesRoute = new Elysia({ prefix: "/vehicles" })
  .use(authDerive)
  // ── static routes ต้องอยู่ก่อน /:id ──────────────────────────────────────
  .get("/types", async ({ authUser }) => {
    const rows = await db.select().from(vehicleTypes).where(eq(vehicleTypes.orgId, authUser!.orgId));
    return rows.map(parseType);
  })
  .post("/types", async ({ authUser, body, set }) => {
    const { name, icon, defaultFee } = body as any;
    if (!name?.trim()) { set.status = 400; return { error: "ต้องระบุชื่อประเภท" }; }
    const id = `VT-${Date.now()}`;
    await db.insert(vehicleTypes).values({
      id, orgId: authUser!.orgId, name: name.trim(),
      icon: icon ?? "fas fa-car",
      defaultFee: String(defaultFee ?? 0),
      isActive: "true",
    });
    const [row] = await db.select().from(vehicleTypes).where(eq(vehicleTypes.id, id));
    return parseType(row);
  })
  .put("/types/:id", async ({ authUser, params, body, set }) => {
    const { id } = params;
    const { name, icon, defaultFee } = body as any;
    const [existing] = await db.select().from(vehicleTypes).where(and(eq(vehicleTypes.id, id), eq(vehicleTypes.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบข้อมูล" }; }
    await db.update(vehicleTypes).set({
      name:       name       ?? existing.name,
      icon:       icon       ?? existing.icon,
      defaultFee: String(defaultFee ?? existing.defaultFee),
    }).where(eq(vehicleTypes.id, id));
    const [row] = await db.select().from(vehicleTypes).where(eq(vehicleTypes.id, id));
    return parseType(row);
  })
  .delete("/types/:id", async ({ authUser, params, set }) => {
    const [existing] = await db.select().from(vehicleTypes).where(and(eq(vehicleTypes.id, params.id), eq(vehicleTypes.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบข้อมูล" }; }
    await db.delete(vehicleTypes).where(eq(vehicleTypes.id, params.id));
    return { deleted: params.id };
  })
  // ── vehicle CRUD ──────────────────────────────────────────────────────────
  .get("/", async ({ authUser }) => {
    const rows = await db.select().from(vehicles).where(eq(vehicles.orgId, authUser!.orgId));
    return rows.map(parseVehicle);
  })
  .post("/", async ({ authUser, body, set }) => {
    const orgId = authUser!.orgId;
    const { customerId, licensePlate, vehicleTypeId, brand, color, parkingFee, newImages } = body as any;
    if (!licensePlate?.trim()) { set.status = 400; return { error: "ต้องระบุป้ายทะเบียน" }; }
    const id = `VH-${Date.now()}`;
    const ts = new Date().toISOString();
    const images = await uploadNewImages(orgId, newImages);
    await db.insert(vehicles).values({
      id,
      orgId,
      customerId:    customerId    ?? "",
      licensePlate:  licensePlate.trim(),
      vehicleTypeId: vehicleTypeId ?? "",
      brand:         brand         ?? "",
      color:         color         ?? "",
      parkingFee:    String(parkingFee ?? 0),
      images:        JSON.stringify(images),
      createdAt:     ts,
    });
    const [row] = await db.select().from(vehicles).where(eq(vehicles.id, id));
    return parseVehicle(row);
  })
  .put("/:id", async ({ authUser, params, body, set }) => {
    const { id } = params;
    const { customerId, licensePlate, vehicleTypeId, brand, color, parkingFee } = body as any;
    const [existing] = await db.select().from(vehicles).where(and(eq(vehicles.id, id), eq(vehicles.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบข้อมูล" }; }
    await db.update(vehicles).set({
      customerId:    customerId    ?? existing.customerId,
      licensePlate:  licensePlate  ?? existing.licensePlate,
      vehicleTypeId: vehicleTypeId ?? existing.vehicleTypeId,
      brand:         brand         ?? existing.brand,
      color:         color         ?? existing.color,
      parkingFee:    String(parkingFee ?? existing.parkingFee),
    }).where(eq(vehicles.id, id));
    const [row] = await db.select().from(vehicles).where(eq(vehicles.id, id));
    return parseVehicle(row);
  })
  .delete("/:id", async ({ authUser, params, set }) => {
    const [existing] = await db.select().from(vehicles).where(and(eq(vehicles.id, params.id), eq(vehicles.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบข้อมูล" }; }
    await db.delete(vehicles).where(eq(vehicles.id, params.id));
    return { deleted: params.id };
  })
  .patch("/:id/images", async ({ authUser, params, body, set }) => {
    const { id } = params;
    const { keepUrls, newImages } = body as {
      keepUrls: string[];
      newImages: { base64: string; name: string }[];
    };
    const [existing] = await db.select().from(vehicles).where(and(eq(vehicles.id, id), eq(vehicles.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบข้อมูล" }; }
    let existingImages: string[] = [];
    try { existingImages = ((existing.images ? JSON.parse(existing.images) : []) as unknown[]).map(normalizeImageEntry).filter(Boolean); } catch {}
    // keepUrls มาจาก frontend ที่ถือ URL "เซ็นแล้ว" (ได้จาก parseVehicle ด้านบน) ต้องตัด ?sig=... ทิ้งก่อน
    // เทียบกับ path ดิบที่เก็บไว้ในฐานข้อมูล ไม่งั้นจะไม่ตรงกันเลยสักรูป
    const cleanKeepUrls = (keepUrls ?? []).map((u) => u.split("?")[0]);
    const kept = existingImages.filter((u) => cleanKeepUrls.includes(u));
    const uploaded = await uploadNewImages(authUser!.orgId, newImages);
    const allImages = [...kept, ...uploaded];
    await db.update(vehicles).set({ images: JSON.stringify(allImages) }).where(eq(vehicles.id, id));
    return { images: allImages.map(signUploadPath) };
  });
