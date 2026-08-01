import { Elysia } from "elysia";
import { db } from "../db";
import { vehicles, vehicleTypes } from "../db/schema";
import { eq } from "drizzle-orm";

function parseVehicle(r: typeof vehicles.$inferSelect) {
  let images: string[] = [];
  try { images = r.images ? JSON.parse(r.images) : []; } catch {}
  return {
    id: r.id,
    customerId: r.customerId,
    licensePlate: r.licensePlate,
    vehicleTypeId: r.vehicleTypeId,
    brand: r.brand,
    color: r.color,
    parkingFee: Number(r.parkingFee) || 0,
    images,
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

async function uploadVehicleImage(filename: string, mimeType: string, base64Data: string): Promise<string> {
  const { writeFileSync, mkdirSync } = await import("fs");
  const { resolve } = await import("path");
  const uploadDir = resolve(process.cwd(), "uploads", "vehicles");
  mkdirSync(uploadDir, { recursive: true });
  const base64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
  const buffer = Buffer.from(base64, "base64");
  const safeName = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  writeFileSync(resolve(uploadDir, safeName), buffer);
  // path สัมพัทธ์ล้วนๆ (ไม่ฝัง host:port) — ฝั่ง frontend พร็อกซี /uploads ไปที่ backend เอง (ดู vite.config.ts)
  // กัน URL รูปพังตอน IP เครื่องใน LAN เปลี่ยน (เช่น BASE_URL เดิมผูกกับ IP ที่ DHCP จ่ายใหม่ไปแล้ว)
  return `/uploads/vehicles/${safeName}`;
}

async function uploadNewImages(newImages: { base64: string; name: string }[] | undefined): Promise<string[]> {
  const uploaded: string[] = [];
  for (const img of (newImages ?? [])) {
    const mimeType = img.base64.match(/data:([^;]+);/)?.[1] ?? "image/jpeg";
    const ext = mimeType.split("/")[1] || "jpg";
    uploaded.push(await uploadVehicleImage(img.name || `vehicle.${ext}`, mimeType, img.base64));
  }
  return uploaded;
}

export const vehiclesRoute = new Elysia({ prefix: "/vehicles" })
  // ── static routes ต้องอยู่ก่อน /:id ──────────────────────────────────────
  .get("/types", async () => {
    const rows = await db.select().from(vehicleTypes);
    return rows.map(parseType);
  })
  .post("/types", async ({ body, set }) => {
    const { name, icon, defaultFee } = body as any;
    if (!name?.trim()) { set.status = 400; return { error: "ต้องระบุชื่อประเภท" }; }
    const id = `VT-${Date.now()}`;
    await db.insert(vehicleTypes).values({
      id, name: name.trim(),
      icon: icon ?? "fas fa-car",
      defaultFee: String(defaultFee ?? 0),
      isActive: "true",
    });
    const [row] = await db.select().from(vehicleTypes).where(eq(vehicleTypes.id, id));
    return parseType(row);
  })
  .put("/types/:id", async ({ params, body, set }) => {
    const { id } = params;
    const { name, icon, defaultFee } = body as any;
    const [existing] = await db.select().from(vehicleTypes).where(eq(vehicleTypes.id, id));
    if (!existing) { set.status = 404; return { error: "ไม่พบข้อมูล" }; }
    await db.update(vehicleTypes).set({
      name:       name       ?? existing.name,
      icon:       icon       ?? existing.icon,
      defaultFee: String(defaultFee ?? existing.defaultFee),
    }).where(eq(vehicleTypes.id, id));
    const [row] = await db.select().from(vehicleTypes).where(eq(vehicleTypes.id, id));
    return parseType(row);
  })
  .delete("/types/:id", async ({ params, set }) => {
    const [existing] = await db.select().from(vehicleTypes).where(eq(vehicleTypes.id, params.id));
    if (!existing) { set.status = 404; return { error: "ไม่พบข้อมูล" }; }
    await db.delete(vehicleTypes).where(eq(vehicleTypes.id, params.id));
    return { deleted: params.id };
  })
  // ── vehicle CRUD ──────────────────────────────────────────────────────────
  .get("/", async () => {
    const rows = await db.select().from(vehicles);
    return rows.map(parseVehicle);
  })
  .post("/", async ({ body, set }) => {
    const { customerId, licensePlate, vehicleTypeId, brand, color, parkingFee, newImages } = body as any;
    if (!licensePlate?.trim()) { set.status = 400; return { error: "ต้องระบุป้ายทะเบียน" }; }
    const id = `VH-${Date.now()}`;
    const ts = new Date().toISOString();
    const images = await uploadNewImages(newImages);
    await db.insert(vehicles).values({
      id,
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
  .put("/:id", async ({ params, body, set }) => {
    const { id } = params;
    const { customerId, licensePlate, vehicleTypeId, brand, color, parkingFee } = body as any;
    const [existing] = await db.select().from(vehicles).where(eq(vehicles.id, id));
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
  .delete("/:id", async ({ params, set }) => {
    const [existing] = await db.select().from(vehicles).where(eq(vehicles.id, params.id));
    if (!existing) { set.status = 404; return { error: "ไม่พบข้อมูล" }; }
    await db.delete(vehicles).where(eq(vehicles.id, params.id));
    return { deleted: params.id };
  })
  .patch("/:id/images", async ({ params, body, set }) => {
    const { id } = params;
    const { keepUrls, newImages } = body as {
      keepUrls: string[];
      newImages: { base64: string; name: string }[];
    };
    const [existing] = await db.select().from(vehicles).where(eq(vehicles.id, id));
    if (!existing) { set.status = 404; return { error: "ไม่พบข้อมูล" }; }
    let existingImages: string[] = [];
    try { existingImages = existing.images ? JSON.parse(existing.images) : []; } catch {}
    const kept = existingImages.filter((u) => (keepUrls ?? []).includes(u));
    const uploaded = await uploadNewImages(newImages);
    const allImages = [...kept, ...uploaded];
    await db.update(vehicles).set({ images: JSON.stringify(allImages) }).where(eq(vehicles.id, id));
    return { images: allImages };
  });
