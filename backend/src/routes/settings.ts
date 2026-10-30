import { Elysia } from "elysia";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { appSettings, appConfig, tenants } from "../db/schema";
import { createAllRichMenus, relinkRichMenuForUsers } from "../services/richMenu";
import { toPublicUrl, getBotUserId } from "../services/line";
import { authDerive } from "../lib/authDerive";
import { ensureOrgSlug } from "../lib/orgContext";
import { encryptField, decryptField, signUploadPath } from "../lib/encryption";

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

function parseConfig(r: typeof appConfig.$inferSelect, orgSlug: string) {
  return {
    // รหัสองค์กรไว้ต่อท้าย ?org= ใน Endpoint URL ของ LIFF app แต่ละองค์กร (ดู lib/orgContext.ts,
    // routes/liff.ts) — แสดงให้เจ้าของหอพักก็อปไปตั้งค่าเองในหน้า Settings > LINE Messaging
    orgSlug,
    electricRate: Number(r.electricRate) || 0,
    waterRate: Number(r.waterRate) || 0,
    serviceFee: {
      enabled: r.serviceFeeEnabled === "true",
      waterRate: Number(r.serviceFeeWaterRate) || 0,
      electricRate: Number(r.serviceFeeElectricRate) || 0,
      mode: r.serviceFeeMode === "flat" ? "flat" : "unit",
      waterFlat: Number(r.serviceFeeWaterFlat) || 0,
      electricFlat: Number(r.serviceFeeElectricFlat) || 0,
      displayMode: r.serviceFeeDisplayMode === "separate" ? "separate" : "combined",
    },
    overdue: {
      enabled: r.overdueEnabled === "true",
      day: Number(r.overdueDay) || 0,
      type: r.overdueFineType || "fixed",
      amount: Number(r.overdueFineAmount) || 0,
    },
    rounding: {
      enabled: r.roundingEnabled === "true",
      unit: Math.max(1, Number(r.roundingUnit) || 5),
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
    contract: (() => { try { const v = JSON.parse(r.contractConfig || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } })(),
    meterDigits: Math.max(3, Math.min(9, Number(r.meterDigits) || 5)),
    yearFormat: r.yearFormat === "CE" ? "CE" : "BE",
    // นาทีไม่มีการใช้งานแล้วเด้งออกจากระบบอัตโนมัติ — 0 = ปิดใช้งาน
    sessionTimeoutMinutes: Math.max(0, Number(r.sessionTimeoutMinutes) || 0),
    // token/secret/API key เข้ารหัสไว้ในฐานข้อมูล (ดู lib/encryption.ts) — ถอดรหัสตรงนี้ก่อนส่งกลับให้
    // หน้า Settings แสดง/แก้ไข (ยังคงพฤติกรรมเดิมที่ส่งค่าจริงกลับไปให้เจ้าขององค์กรแก้ไขได้ ไม่เปลี่ยน API
    // contract แค่เปลี่ยนวิธีเก็บใน DB เท่านั้น)
    lineMessaging: {
      enabled: r.lineMessagingEnabled === "true",
      channelAccessToken: decryptField(r.lineChannelAccessToken || ""),
      channelSecret: decryptField(r.lineChannelSecret || ""),
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
      contactUrl: r.contactUrl || "",
      // path เก็บดิบๆ ไม่มีลายเซ็นในฐานข้อมูล (ดู lib/encryption.ts) — เซ็นตอนส่งออกให้หน้า Settings แสดง
      // preview ตรงนี้เท่านั้น (ไม่กระทบตอนสร้าง Rich Menu จริงกับ LINE — จุดนั้นอ่านไฟล์จากดิสก์ตรงๆ ไม่ผ่าน
      // /uploads/* เลย ดู loadImage() ใน POST /richmenu/create ด้านล่าง)
      images: {
        guest: signUploadPath(r.richMenuGuestImage || ""),
        member: signUploadPath(r.richMenuMemberImage || ""),
        admin: signUploadPath(r.richMenuAdminImage || ""),
      },
      menuIds: {
        guest: r.richMenuGuestId || "",
        member: r.richMenuMemberId || "",
        admin: r.richMenuAdminId || "",
      },
    },
    payment: {
      // ฟิลด์เดี่ยวเก่า — เก็บไว้เพื่อ backward-compat (โค้ดเก่า/หน้าจออื่นที่ยังอ้างอิง payment.bankName
      // ตรงๆ) แต่ค่าที่ใช้แสดงผลจริงในหน้า Settings คือ payment.accounts ด้านล่างเท่านั้น
      bankName: r.paymentBankName || "",
      accountName: r.paymentAccountName || "",
      accountNumber: r.paymentAccountNumber || "",
      qrImage: r.paymentQrImage || "",
      bankLogoImage: r.paymentBankLogoImage || "",
      easySlipEnabled: r.easySlipEnabled === "true",
      easySlipApiKey: decryptField(r.easySlipApiKey || ""),
      promptPayId: r.paymentPromptPayId || "",
      // รองรับหลายบัญชี — ถ้ายังไม่เคยตั้งค่าเลย (แถวเก่าก่อนมีฟีเจอร์นี้) synthesize บัญชีเดียวจากฟิลด์เดี่ยว
      // เก่าให้อัตโนมัติ (mode "all" = โชว์ให้ทุกห้องเหมือนพฤติกรรมเดิมเป๊ะ) กันหน้า Settings เห็นรายการว่างเปล่า
      // ทั้งที่จริงมีบัญชีตั้งไว้แล้วจากฟอร์มเก่า
      accounts: j(r.paymentAccounts, [] as any[]).length > 0
        ? j(r.paymentAccounts, [] as any[])
        : (r.paymentBankName || r.paymentAccountNumber || r.paymentQrImage)
          ? [{
              id: "acct-legacy",
              bankName: r.paymentBankName || "",
              accountName: r.paymentAccountName || "",
              accountNumber: r.paymentAccountNumber || "",
              qrImage: r.paymentQrImage || "",
              bankLogoImage: r.paymentBankLogoImage || "",
              promptPayId: r.paymentPromptPayId || "",
              assign: { mode: "all" },
            }]
          : [],
      // คลังโลโก้ธนาคารจริงที่เคยอัปโหลดไว้ (ดู comment ที่คอลัมน์ bankLogoLibrary ใน schema.ts)
      bankLogoLibrary: j(r.bankLogoLibrary, {} as Record<string, string>),
    },
    setupCompleted: r.setupCompleted === "true",
    ratesConfirmed: r.ratesConfirmed === "true",
    updatedAt: r.updatedAt,
  };
}

// id ของแถว app_config "คือ" orgId ตรงๆ (แถวละ 1 องค์กร — เดิมเป็น sentinel "default" แถวเดียวทั้งระบบ)
export async function getOrCreateConfig(orgId: string) {
  const [existing] = await db.select().from(appConfig).where(eq(appConfig.id, orgId));
  if (existing) return existing;
  await db.insert(appConfig).values({
    id: orgId,
    electricRate: "7",
    waterRate: "18",
    logoUrl: "",
    appName: "",
    appNameColors: "[]",
    updatedAt: new Date().toISOString(),
  });
  const [row] = await db.select().from(appConfig).where(eq(appConfig.id, orgId));
  return row;
}

export const settingsRoute = new Elysia({ prefix: "/settings" })
  .use(authDerive)
  // ── สูตรคำนวณค่าน้ำ/ค่าไฟ ──────────────────────────────────────────────────
  .get("/", async ({ authUser }) => {
    const rows = await db.select().from(appSettings).where(eq(appSettings.orgId, authUser!.orgId));
    return rows.map(parseFormula);
  })
  .post("/", async ({ authUser, body, set }) => {
    const { name, type, formula, isDefault } = body as any;
    if (!name?.trim() || !formula?.trim()) { set.status = 400; return { error: "กรุณากรอกชื่อสูตรและโค้ดคำนวณ" }; }
    const id = `FML-${Date.now()}`;
    const ts = new Date().toISOString();
    if (isDefault) {
      await db.update(appSettings).set({ isDefault: "false" }).where(and(eq(appSettings.type, String(type)), eq(appSettings.orgId, authUser!.orgId)));
    }
    await db.insert(appSettings).values({
      id, orgId: authUser!.orgId, name: name.trim(), type: String(type ?? "electric"),
      formula: formula.trim(), isDefault: isDefault ? "true" : "false", updatedAt: ts,
    });
    const [row] = await db.select().from(appSettings).where(eq(appSettings.id, id));
    return parseFormula(row);
  })
  .put("/:id", async ({ authUser, params, body, set }) => {
    const { id } = params;
    const [existing] = await db.select().from(appSettings).where(and(eq(appSettings.id, id), eq(appSettings.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบสูตร" }; }
    const { name, type, formula, isDefault } = body as any;
    const finalType = String(type ?? existing.type);
    if (isDefault) {
      await db.update(appSettings).set({ isDefault: "false" }).where(and(eq(appSettings.type, finalType), eq(appSettings.orgId, authUser!.orgId)));
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
  .delete("/:id", async ({ authUser, params }) => {
    await db.delete(appSettings).where(and(eq(appSettings.id, params.id), eq(appSettings.orgId, authUser!.orgId)));
    return { deleted: params.id };
  })
  // ── ค่าคอนฟิกระบบ (อัตราค่าบริการ, ค่าปรับ, รูปลักษณ์, ฟีเจอร์) ──────────────
  .get("/config", async ({ authUser }) => {
    const [row, orgSlug] = await Promise.all([
      getOrCreateConfig(authUser!.orgId),
      ensureOrgSlug(authUser!.orgId),
    ]);
    return parseConfig(row, orgSlug);
  })
  // กดยืนยันว่าตั้งค่าเริ่มต้นเสร็จแล้ว (ปุ่ม "เสร็จสิ้นการตั้งค่าเริ่มต้น" ในหน้า Settings ตอน setupCompleted
  // ยังเป็น false) — ปลดล็อกให้เข้าหน้าอื่นในระบบได้ตามปกติ (ดู AuthenticatedShell ใน frontend/src/App.tsx)
  // เป็น action แยกจาก PUT /config ทั่วไปเพราะไม่อยากให้การ "บันทึกทั้งหมด" ระหว่างทางตอนตั้งค่าไปปลดล็อกโดย
  // ไม่ตั้งใจ ต้องกดปุ่มนี้ตรงๆ เท่านั้นถึงจะเปลี่ยนสถานะ
  .post("/config/complete-setup", async ({ authUser }) => {
    const orgId = authUser!.orgId;
    await getOrCreateConfig(orgId);
    await db.update(appConfig).set({ setupCompleted: "true", updatedAt: new Date().toISOString() }).where(eq(appConfig.id, orgId));
    return { setupCompleted: true };
  })
  .put("/config", async ({ authUser, body }) => {
    const orgId = authUser!.orgId;
    const b = body as any;
    const existingConfig = await getOrCreateConfig(orgId);
    const newToken = String(b.lineMessaging?.channelAccessToken ?? "");
    // ดึง LINE User ID ของบอท (ใช้จับคู่ webhook destination — ดู resolveOrgIdByDestination ใน
    // lib/orgContext.ts) เฉพาะตอน token เปลี่ยนจริงเท่านั้น กันยิง LINE API ทุกครั้งที่กดบันทึกหน้า Settings
    // ทั้งที่ token เดิมไม่ได้แก้ไข — best-effort เฉยๆ (getBotUserId คืน null เองถ้าเรียกไม่สำเร็จ) ไม่บล็อก
    // การบันทึกค่าอื่นทั้งหมดถ้า LINE API ล่ม/token ผิด แค่ทำให้ webhook จับคู่องค์กรนี้ไม่ได้จนกว่าจะแก้ token
    let lineBotUserId = existingConfig.lineBotUserId ?? "";
    // ต้องถอดรหัส token เดิมก่อนเทียบ (เก็บเข้ารหัสไว้ในฐานข้อมูล — ดู lib/encryption.ts) ไม่งั้นจะเทียบกับ
    // newToken (plaintext จาก request body) ไม่ตรงทุกครั้งแม้ผู้ใช้ไม่ได้แก้ไข ทำให้ยิง LINE API ทุกครั้งที่
    // กดบันทึกโดยไม่จำเป็น — ยิงซ้ำเมื่อ token เปลี่ยน "หรือ" ยังไม่เคยแคช bot user id ไว้เลยทั้งที่มี token แล้ว
    // (แถวเก่าที่ตั้ง token ไว้ก่อนมีฟีเจอร์ multi-tenant webhook — self-heal ให้ตอนกดบันทึกครั้งถัดไป)
    if (newToken !== decryptField(existingConfig.lineChannelAccessToken ?? "") || (newToken && !lineBotUserId)) {
      lineBotUserId = newToken ? (await getBotUserId(newToken)) ?? "" : "";
    }
    await db.update(appConfig).set({
      lineBotUserId,
      electricRate: String(Number(b.electricRate) || 0),
      waterRate: String(Number(b.waterRate) || 0),
      serviceFeeEnabled: b.serviceFee?.enabled ? "true" : "false",
      serviceFeeWaterRate: String(Number(b.serviceFee?.waterRate) || 0),
      serviceFeeElectricRate: String(Number(b.serviceFee?.electricRate) || 0),
      serviceFeeMode: b.serviceFee?.mode === "flat" ? "flat" : "unit",
      serviceFeeWaterFlat: String(Number(b.serviceFee?.waterFlat) || 0),
      serviceFeeElectricFlat: String(Number(b.serviceFee?.electricFlat) || 0),
      serviceFeeDisplayMode: b.serviceFee?.displayMode === "separate" ? "separate" : "combined",
      overdueEnabled: b.overdue?.enabled ? "true" : "false",
      overdueDay: String(Number(b.overdue?.day) || 0),
      overdueFineType: String(b.overdue?.type ?? "fixed"),
      overdueFineAmount: String(Number(b.overdue?.amount) || 0),
      roundingEnabled: b.rounding?.enabled ? "true" : "false",
      roundingUnit: String(Math.max(1, Number(b.rounding?.unit) || 5)),
      logoUrl: String(b.appIdentity?.logoUrl ?? ""),
      logoBgEnabled: b.appIdentity?.logoBg?.enabled ? "true" : "false",
      logoBgColor: String(b.appIdentity?.logoBg?.color ?? "#ffffff"),
      appName: String(b.appIdentity?.nameText ?? ""),
      appNameColors: JSON.stringify(Array.isArray(b.appIdentity?.nameColors) ? b.appIdentity.nameColors : []),
      liveMeterEnabled: b.features?.liveMeterEnabled === false ? "false" : "true",
      splitRentByResidents: b.features?.splitRentByResidents ? "true" : "false",
      contractConfig: JSON.stringify(b.contract && typeof b.contract === "object" ? b.contract : {}),
      meterDigits: String(Math.max(3, Math.min(9, Number(b.meterDigits) || 5))),
      yearFormat: b.yearFormat === "CE" ? "CE" : "BE",
      sessionTimeoutMinutes: String(Math.max(0, Number(b.sessionTimeoutMinutes) || 0)),
      lineMessagingEnabled: b.lineMessaging?.enabled ? "true" : "false",
      lineChannelAccessToken: encryptField(newToken),
      lineChannelSecret: encryptField(String(b.lineMessaging?.channelSecret ?? "")),
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
      contactUrl: String(b.richMenu?.contactUrl ?? ""),
      // ฟิลด์เดี่ยวเก่า — ยังอัปเดตตามบัญชีแรกใน accounts ไว้เสมอ (เผื่อโค้ด/หน้าจอเก่าจุดไหนยังอ่านตรงๆ อยู่)
      // ค่าจริงที่ใช้แสดงผลคือ paymentAccounts ด้านล่าง
      paymentBankName: String(b.payment?.accounts?.[0]?.bankName ?? b.payment?.bankName ?? ""),
      paymentAccountName: String(b.payment?.accounts?.[0]?.accountName ?? b.payment?.accountName ?? ""),
      paymentAccountNumber: String(b.payment?.accounts?.[0]?.accountNumber ?? b.payment?.accountNumber ?? ""),
      paymentQrImage: String(b.payment?.accounts?.[0]?.qrImage ?? b.payment?.qrImage ?? ""),
      paymentBankLogoImage: String(b.payment?.accounts?.[0]?.bankLogoImage ?? b.payment?.bankLogoImage ?? ""),
      easySlipEnabled: b.payment?.easySlipEnabled ? "true" : "false",
      easySlipApiKey: encryptField(String(b.payment?.easySlipApiKey ?? "")),
      paymentPromptPayId: String(b.payment?.accounts?.[0]?.promptPayId ?? b.payment?.promptPayId ?? ""),
      // รองรับหลายบัญชี — เก็บทั้งก้อนเป็น JSON (ดู comment ที่คอลัมน์ paymentAccounts ใน schema.ts)
      paymentAccounts: JSON.stringify(Array.isArray(b.payment?.accounts) ? b.payment.accounts : []),
      // คลังโลโก้ธนาคารจริงที่อัปโหลดไว้ (ดู comment ที่คอลัมน์ bankLogoLibrary ใน schema.ts)
      bankLogoLibrary: JSON.stringify(
        b.payment?.bankLogoLibrary && typeof b.payment.bankLogoLibrary === "object" ? b.payment.bankLogoLibrary : {}
      ),
      // ตั้งใจไม่เขียนทับด้วย "false" ถ้า body ไม่ได้ส่งฟิลด์นี้มา (เช่น payload จาก SettingsPage.tsx หลัง
      // ผ่านขั้นตอนตั้งค่าเริ่มต้นไปแล้ว ไม่มีฟิลด์นี้ในฟอร์มเลย) — คงค่าที่มีอยู่เดิมไว้เสมอ ต่างจากฟิลด์อื่นๆ
      // ด้านบนที่ยอมให้ "ไม่ส่งมา = false" ได้ เพราะฟิลด์นี้ตั้งใจให้เขียนได้จากจุดเดียวคือ
      // OnboardingWizard.tsx (ที่ clone ค่า config เดิมมาด้วยเสมอ จึงส่งค่าที่ถูกต้องมาให้ทุกครั้งอยู่แล้ว)
      ...(b.ratesConfirmed !== undefined ? { ratesConfirmed: b.ratesConfirmed ? "true" : "false" } : {}),
      updatedAt: new Date().toISOString(),
    }).where(eq(appConfig.id, orgId));
    const [row, orgSlug] = await Promise.all([
      db.select().from(appConfig).where(eq(appConfig.id, orgId)).then((r) => r[0]),
      ensureOrgSlug(orgId),
    ]);
    return parseConfig(row, orgSlug);
  })
  // ── LINE Rich Menu ───────────────────────────────────────────────────────────
  // อัปโหลดรูปเมนูหนึ่งแบบ (guest/member/admin) — เซฟไฟล์ทันที (แพทเทิร์นเดียวกับ uploadRoomImage ใน
  // routes/rooms.ts) ไม่รอปุ่ม "บันทึกการตั้งค่าทั้งหมด" เพราะไฟล์ต้องมีอยู่จริงบนดิสก์ตอนกด "สร้าง Rich Menu"
  .post("/richmenu/image", async ({ authUser, body, set }) => {
    const orgId = authUser!.orgId;
    const { menu, base64 } = body as { menu: "guest" | "member" | "admin"; base64: string; name?: string };
    if (menu !== "guest" && menu !== "member" && menu !== "admin") { set.status = 400; return { error: "ประเภทเมนูไม่ถูกต้อง" }; }
    if (!base64) { set.status = 400; return { error: "ไม่พบไฟล์รูป" }; }

    const mimeType = base64.match(/data:([^;]+);/)?.[1] ?? "image/png";
    const ext = (mimeType.split("/")[1] || "png").replace("jpeg", "jpg");
    const { mkdirSync, writeFileSync } = await import("fs");
    const { resolve } = await import("path");
    // แยกโฟลเดอร์ตามองค์กร กันชื่อไฟล์ชนกันข้ามองค์กร (แม้ path จะสุ่มด้วย timestamp อยู่แล้ว)
    const uploadDir = resolve(process.cwd(), "uploads", "richmenu", orgId);
    mkdirSync(uploadDir, { recursive: true });
    const raw = base64.includes(",") ? base64.split(",")[1] : base64;
    const buffer = Buffer.from(raw, "base64");
    const fileName = `${menu}_${Date.now()}.${ext}`;
    writeFileSync(resolve(uploadDir, fileName), buffer);
    const url = `/uploads/richmenu/${orgId}/${fileName}`;

    await getOrCreateConfig(orgId);
    if (menu === "guest") await db.update(appConfig).set({ richMenuGuestImage: url }).where(eq(appConfig.id, orgId));
    else if (menu === "member") await db.update(appConfig).set({ richMenuMemberImage: url }).where(eq(appConfig.id, orgId));
    else await db.update(appConfig).set({ richMenuAdminImage: url }).where(eq(appConfig.id, orgId));

    return { url: signUploadPath(url) };
  })
  // สร้าง Rich Menu ทั้ง 3 แบบจริงผ่าน LINE API โดยอ่าน token/LIFF URL/รูปที่ตั้งค่าไว้แล้วจาก app_config
  // ลบเมนูชุดเดิม (ถ้าเคยสร้างไว้) ทิ้งก่อนเสมอ กัน Rich Menu ค้างซ้อนกันในบัญชี LINE OA
  .post("/richmenu/create", async ({ authUser, set }) => {
    const orgId = authUser!.orgId;
    const row = await getOrCreateConfig(orgId);
    const token = decryptField(row.lineChannelAccessToken || "");
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
        contactUrl: row.contactUrl || toPublicUrl("/contact"),
      }, images, {
        guest: row.richMenuGuestId || undefined,
        member: row.richMenuMemberId || undefined,
        admin: row.richMenuAdminId || undefined,
      });
      await db.update(appConfig).set({
        richMenuGuestId: result.ids.guest,
        richMenuMemberId: result.ids.member,
        richMenuAdminId: result.ids.admin,
      }).where(eq(appConfig.id, orgId));

      // เมนูชุดเก่าถูกลบไปแล้วข้างใน createAllRichMenus ทำให้ทุกคนที่เคยผูกเมนู Member ไว้ "หลุด" กลับไปเห็น
      // เมนู Guest ทันที (ผู้ใช้ทั่วไปที่ยังไม่ผูกอะไรไม่กระทบ เพราะ createAllRichMenus ตั้ง Guest เป็นค่า
      // เริ่มต้นของทุกคนให้อัตโนมัติอยู่แล้ว) — ผูกเมนู Member ชุดใหม่ให้ทุกคนที่เคยผูกไว้กลับคืนทันที ไม่ต้อง
      // รอให้แต่ละคน login ผ่าน LIFF ใหม่เอง ครอบคลุมทั้งผู้เช่าหลัก (lineUserId) และผู้ร่วมพักอาศัยที่เคย
      // login ด้วยบัญชี LINE ตัวเอง (coResidents[].lineId — ดู findTenantByLineUserId ใน services/line.ts)
      // จำกัดเฉพาะผู้เช่าขององค์กรนี้เท่านั้น (Rich Menu ก็เป็นของ LINE OA ขององค์กรนี้โดยเฉพาะ)
      const tenantRows = await db.select().from(tenants).where(eq(tenants.orgId, orgId));
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
