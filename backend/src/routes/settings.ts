import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { appSettings, appConfig, tenants } from "../db/schema";
import { createAllRichMenus, relinkRichMenuForUsers } from "../services/richMenu";
import { toPublicUrl } from "../services/line";

const CONFIG_ID = "default";

function j<T>(val: string, def: T): T {
  try { return val ? JSON.parse(val) : def; } catch { return def; }
}

function parseFormula(r: typeof appSettings.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    formula: r.formula,
    isDefault: r.isDefault === "true",
    updatedAt: r.updatedAt,
  };
}

function parseConfig(r: typeof appConfig.$inferSelect) {
  return {
    electricRate: Number(r.electricRate) || 0,
    waterRate: Number(r.waterRate) || 0,
    overdue: {
      enabled: r.overdueEnabled === "true",
      day: Number(r.overdueDay) || 0,
      type: r.overdueFineType || "fixed",
      amount: Number(r.overdueFineAmount) || 0,
    },
    appIdentity: {
      logoUrl: r.logoUrl,
      logoBg: { enabled: r.logoBgEnabled === "true", color: r.logoBgColor || "#ffffff" },
      nameText: r.appName,
      nameColors: j(r.appNameColors, [] as string[]),
    },
    features: {
      liveMeterEnabled: r.liveMeterEnabled !== "false",
      splitRentByResidents: r.splitRentByResidents === "true",
    },
    meterDigits: Math.max(3, Math.min(9, Number(r.meterDigits) || 5)),
    yearFormat: r.yearFormat === "CE" ? "CE" : "BE",
    // นาทีไม่มีการใช้งานแล้วเด้งออกจากระบบอัตโนมัติ — 0 = ปิดใช้งาน
    sessionTimeoutMinutes: Math.max(0, Number(r.sessionTimeoutMinutes) || 0),
    lineMessaging: {
      enabled: r.lineMessagingEnabled === "true",
      channelAccessToken: r.lineChannelAccessToken || "",
      channelSecret: r.lineChannelSecret || "",
      autoSendEnabled: r.lineAutoSendEnabled === "true",
      sendBillToCoResidents: r.lineSendBillToCoResidents !== "false",
    },
    richMenu: {
      liffLoginUrl: r.liffLoginUrl || "",
      liffPaymentUrl: r.liffPaymentUrl || "",
      liffProfileUrl: r.liffProfileUrl || "",
      liffRepairUrl: r.liffRepairUrl || "",
      liffRoomsUrl: r.liffRoomsUrl || "",
      liffBookingUrl: r.liffBookingUrl || "",
      contactPhone: r.contactPhone || "",
      images: {
        guest: r.richMenuGuestImage || "",
        member: r.richMenuMemberImage || "",
        admin: r.richMenuAdminImage || "",
      },
      menuIds: {
        guest: r.richMenuGuestId || "",
        member: r.richMenuMemberId || "",
        admin: r.richMenuAdminId || "",
      },
    },
    payment: {
      bankName: r.paymentBankName || "",
      accountName: r.paymentAccountName || "",
      accountNumber: r.paymentAccountNumber || "",
      qrImage: r.paymentQrImage || "",
      easySlipApiKey: r.easySlipApiKey || "",
      promptPayId: r.paymentPromptPayId || "",
    },
    updatedAt: r.updatedAt,
  };
}

async function getOrCreateConfig() {
  const [existing] = await db.select().from(appConfig).where(eq(appConfig.id, CONFIG_ID));
  if (existing) return existing;
  await db.insert(appConfig).values({
    id: CONFIG_ID,
    electricRate: "7",
    waterRate: "18",
    logoUrl: "",
    appName: "",
    appNameColors: "[]",
    updatedAt: new Date().toISOString(),
  });
  const [row] = await db.select().from(appConfig).where(eq(appConfig.id, CONFIG_ID));
  return row;
}

export const settingsRoute = new Elysia({ prefix: "/settings" })
  // ── สูตรคำนวณค่าน้ำ/ค่าไฟ ──────────────────────────────────────────────────
  .get("/", async () => {
    const rows = await db.select().from(appSettings);
    return rows.map(parseFormula);
  })
  .post("/", async ({ body, set }) => {
    const { name, type, formula, isDefault } = body as any;
    if (!name?.trim() || !formula?.trim()) { set.status = 400; return { error: "กรุณากรอกชื่อสูตรและโค้ดคำนวณ" }; }
    const id = `FML-${Date.now()}`;
    const ts = new Date().toISOString();
    if (isDefault) {
      await db.update(appSettings).set({ isDefault: "false" }).where(eq(appSettings.type, String(type)));
    }
    await db.insert(appSettings).values({
      id, name: name.trim(), type: String(type ?? "electric"),
      formula: formula.trim(), isDefault: isDefault ? "true" : "false", updatedAt: ts,
    });
    const [row] = await db.select().from(appSettings).where(eq(appSettings.id, id));
    return parseFormula(row);
  })
  .put("/:id", async ({ params, body, set }) => {
    const { id } = params;
    const [existing] = await db.select().from(appSettings).where(eq(appSettings.id, id));
    if (!existing) { set.status = 404; return { error: "ไม่พบสูตร" }; }
    const { name, type, formula, isDefault } = body as any;
    const finalType = String(type ?? existing.type);
    if (isDefault) {
      await db.update(appSettings).set({ isDefault: "false" }).where(eq(appSettings.type, finalType));
    }
    await db.update(appSettings).set({
      name: name !== undefined ? String(name).trim() : existing.name,
      type: finalType,
      formula: formula !== undefined ? String(formula).trim() : existing.formula,
      isDefault: isDefault ? "true" : "false",
      updatedAt: new Date().toISOString(),
    }).where(eq(appSettings.id, id));
    const [row] = await db.select().from(appSettings).where(eq(appSettings.id, id));
    return parseFormula(row);
  })
  .delete("/:id", async ({ params }) => {
    await db.delete(appSettings).where(eq(appSettings.id, params.id));
    return { deleted: params.id };
  })
  // ── ค่าคอนฟิกระบบ (อัตราค่าบริการ, ค่าปรับ, รูปลักษณ์, ฟีเจอร์) ──────────────
  .get("/config", async () => {
    const row = await getOrCreateConfig();
    return parseConfig(row);
  })
  .put("/config", async ({ body }) => {
    const b = body as any;
    await getOrCreateConfig();
    await db.update(appConfig).set({
      electricRate: String(Number(b.electricRate) || 0),
      waterRate: String(Number(b.waterRate) || 0),
      overdueEnabled: b.overdue?.enabled ? "true" : "false",
      overdueDay: String(Number(b.overdue?.day) || 0),
      overdueFineType: String(b.overdue?.type ?? "fixed"),
      overdueFineAmount: String(Number(b.overdue?.amount) || 0),
      logoUrl: String(b.appIdentity?.logoUrl ?? ""),
      logoBgEnabled: b.appIdentity?.logoBg?.enabled ? "true" : "false",
      logoBgColor: String(b.appIdentity?.logoBg?.color ?? "#ffffff"),
      appName: String(b.appIdentity?.nameText ?? ""),
      appNameColors: JSON.stringify(Array.isArray(b.appIdentity?.nameColors) ? b.appIdentity.nameColors : []),
      liveMeterEnabled: b.features?.liveMeterEnabled === false ? "false" : "true",
      splitRentByResidents: b.features?.splitRentByResidents ? "true" : "false",
      meterDigits: String(Math.max(3, Math.min(9, Number(b.meterDigits) || 5))),
      yearFormat: b.yearFormat === "CE" ? "CE" : "BE",
      sessionTimeoutMinutes: String(Math.max(0, Number(b.sessionTimeoutMinutes) || 0)),
      lineMessagingEnabled: b.lineMessaging?.enabled ? "true" : "false",
      lineChannelAccessToken: String(b.lineMessaging?.channelAccessToken ?? ""),
      lineChannelSecret: String(b.lineMessaging?.channelSecret ?? ""),
      lineAutoSendEnabled: b.lineMessaging?.autoSendEnabled ? "true" : "false",
      lineSendBillToCoResidents: b.lineMessaging?.sendBillToCoResidents === false ? "false" : "true",
      // รูปเมนู/ID ที่สร้างไว้ตั้งใจไม่ใส่ในนี้ — จัดการแยกผ่าน /richmenu/image และ /richmenu/create
      // ด้านล่าง เพราะเป็น action ที่มีผลข้างเคียง (อัปโหลดไฟล์/เรียก LINE API จริง) ไม่ใช่แค่บันทึกค่าฟอร์ม
      liffLoginUrl: String(b.richMenu?.liffLoginUrl ?? ""),
      liffPaymentUrl: String(b.richMenu?.liffPaymentUrl ?? ""),
      liffProfileUrl: String(b.richMenu?.liffProfileUrl ?? ""),
      liffRepairUrl: String(b.richMenu?.liffRepairUrl ?? ""),
      liffRoomsUrl: String(b.richMenu?.liffRoomsUrl ?? ""),
      liffBookingUrl: String(b.richMenu?.liffBookingUrl ?? ""),
      contactPhone: String(b.richMenu?.contactPhone ?? ""),
      paymentBankName: String(b.payment?.bankName ?? ""),
      paymentAccountName: String(b.payment?.accountName ?? ""),
      paymentAccountNumber: String(b.payment?.accountNumber ?? ""),
      paymentQrImage: String(b.payment?.qrImage ?? ""),
      easySlipApiKey: String(b.payment?.easySlipApiKey ?? ""),
      paymentPromptPayId: String(b.payment?.promptPayId ?? ""),
      updatedAt: new Date().toISOString(),
    }).where(eq(appConfig.id, CONFIG_ID));
    const [row] = await db.select().from(appConfig).where(eq(appConfig.id, CONFIG_ID));
    return parseConfig(row);
  })
  // ── LINE Rich Menu ───────────────────────────────────────────────────────────
  // อัปโหลดรูปเมนูหนึ่งแบบ (guest/member/admin) — เซฟไฟล์ทันที (แพทเทิร์นเดียวกับ uploadRoomImage ใน
  // routes/rooms.ts) ไม่รอปุ่ม "บันทึกการตั้งค่าทั้งหมด" เพราะไฟล์ต้องมีอยู่จริงบนดิสก์ตอนกด "สร้าง Rich Menu"
  .post("/richmenu/image", async ({ body, set }) => {
    const { menu, base64 } = body as { menu: "guest" | "member" | "admin"; base64: string; name?: string };
    if (menu !== "guest" && menu !== "member" && menu !== "admin") { set.status = 400; return { error: "ประเภทเมนูไม่ถูกต้อง" }; }
    if (!base64) { set.status = 400; return { error: "ไม่พบไฟล์รูป" }; }

    const mimeType = base64.match(/data:([^;]+);/)?.[1] ?? "image/png";
    const ext = (mimeType.split("/")[1] || "png").replace("jpeg", "jpg");
    const { mkdirSync, writeFileSync } = await import("fs");
    const { resolve } = await import("path");
    const uploadDir = resolve(process.cwd(), "uploads", "richmenu");
    mkdirSync(uploadDir, { recursive: true });
    const raw = base64.includes(",") ? base64.split(",")[1] : base64;
    const buffer = Buffer.from(raw, "base64");
    const fileName = `${menu}_${Date.now()}.${ext}`;
    writeFileSync(resolve(uploadDir, fileName), buffer);
    const url = `/uploads/richmenu/${fileName}`;

    await getOrCreateConfig();
    if (menu === "guest") await db.update(appConfig).set({ richMenuGuestImage: url }).where(eq(appConfig.id, CONFIG_ID));
    else if (menu === "member") await db.update(appConfig).set({ richMenuMemberImage: url }).where(eq(appConfig.id, CONFIG_ID));
    else await db.update(appConfig).set({ richMenuAdminImage: url }).where(eq(appConfig.id, CONFIG_ID));

    return { url };
  })
  // สร้าง Rich Menu ทั้ง 3 แบบจริงผ่าน LINE API โดยอ่าน token/LIFF URL/รูปที่ตั้งค่าไว้แล้วจาก app_config
  // ลบเมนูชุดเดิม (ถ้าเคยสร้างไว้) ทิ้งก่อนเสมอ กัน Rich Menu ค้างซ้อนกันในบัญชี LINE OA
  .post("/richmenu/create", async ({ set }) => {
    const row = await getOrCreateConfig();
    const token = row.lineChannelAccessToken || "";
    if (!token) {
      set.status = 400;
      return { error: "ยังไม่ได้ตั้งค่า LINE Channel Access Token (ตั้งค่าที่หมวดฟีเจอร์เสริม > ส่งบิลแจ้งเตือนทาง LINE)" };
    }
    const liffLoginUrl = row.liffLoginUrl || "";
    const liffPaymentUrl = row.liffPaymentUrl || "";
    if (!liffLoginUrl || !liffPaymentUrl) {
      set.status = 400;
      return { error: "กรุณากรอกและบันทึก LIFF Login URL กับ LIFF Payment URL ให้ครบก่อน" };
    }
    const imagePaths = { guest: row.richMenuGuestImage, member: row.richMenuMemberImage, admin: row.richMenuAdminImage };
    if (!imagePaths.guest || !imagePaths.member || !imagePaths.admin) {
      set.status = 400;
      return { error: "กรุณาอัปโหลดรูปเมนูให้ครบทั้ง 3 แบบ (Guest / Member / Admin) ก่อน" };
    }

    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    function loadImage(relUrl: string) {
      const filePath = resolve(process.cwd(), relUrl.replace(/^\//, ""));
      const buffer = readFileSync(filePath);
      const ext = relUrl.split(".").pop()?.toLowerCase();
      const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
      return { buffer, mimeType };
    }

    let images;
    try {
      images = { guest: loadImage(imagePaths.guest), member: loadImage(imagePaths.member), admin: loadImage(imagePaths.admin) };
    } catch {
      set.status = 400;
      return { error: "ไม่พบไฟล์รูปเมนูบนเซิร์ฟเวอร์ กรุณาอัปโหลดรูปใหม่อีกครั้ง" };
    }

    try {
      const result = await createAllRichMenus(token, {
        liffLoginUrl, liffPaymentUrl,
        liffProfileUrl: row.liffProfileUrl || "",
        liffRepairUrl: row.liffRepairUrl || "",
        liffRoomsUrl: row.liffRoomsUrl || "",
        liffBookingUrl: row.liffBookingUrl || "",
        contactUrl: toPublicUrl("/contact"),
      }, images, {
        guest: row.richMenuGuestId || undefined,
        member: row.richMenuMemberId || undefined,
        admin: row.richMenuAdminId || undefined,
      });
      await db.update(appConfig).set({
        richMenuGuestId: result.ids.guest,
        richMenuMemberId: result.ids.member,
        richMenuAdminId: result.ids.admin,
      }).where(eq(appConfig.id, CONFIG_ID));

      // เมนูชุดเก่าถูกลบไปแล้วข้างใน createAllRichMenus ทำให้ทุกคนที่เคยผูกเมนู Member ไว้ "หลุด" กลับไปเห็น
      // เมนู Guest ทันที (ผู้ใช้ทั่วไปที่ยังไม่ผูกอะไรไม่กระทบ เพราะ createAllRichMenus ตั้ง Guest เป็นค่า
      // เริ่มต้นของทุกคนให้อัตโนมัติอยู่แล้ว) — ผูกเมนู Member ชุดใหม่ให้ทุกคนที่เคยผูกไว้กลับคืนทันที ไม่ต้อง
      // รอให้แต่ละคน login ผ่าน LIFF ใหม่เอง ครอบคลุมทั้งผู้เช่าหลัก (lineUserId) และผู้ร่วมพักอาศัยที่เคย
      // login ด้วยบัญชี LINE ตัวเอง (coResidents[].lineId — ดู findTenantByLineUserId ใน services/line.ts)
      const tenantRows = await db.select().from(tenants);
      const memberUserIds: string[] = [];
      for (const t of tenantRows) {
        if (t.lineUserId?.trim()) memberUserIds.push(t.lineUserId.trim());
        for (const cr of j<any[]>(t.coResidents, [])) {
          if (cr?.lineId?.trim?.()) memberUserIds.push(String(cr.lineId).trim());
        }
      }
      const relinked = await relinkRichMenuForUsers(token, result.ids.member, memberUserIds);

      return { menuIds: result.ids, defaultSet: result.defaultSet, warning: result.defaultSet ? undefined : result.defaultError, relinked };
    } catch (e: any) {
      set.status = 500;
      return { error: e?.message ?? "สร้าง Rich Menu ไม่สำเร็จ" };
    }
  });
