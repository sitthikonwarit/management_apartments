// ── หน้า LIFF ฝั่งผู้เช่า (Login/Payment) — สาธารณะ ไม่ต้องล็อกอินด้วย Bearer ของระบบเรา (เหมือน
// lineWebhook.ts) เพราะผู้เช่าไม่มีบัญชีพนักงาน ยืนยันตัวตนด้วย LIFF access token (ของผู้ใช้ LINE เอง)
// กับ LINE ตรงๆ แทน (ดู verifyLiffAccessToken ใน services/line.ts) เมานต์คู่กับ authPublicRoute ใน
// index.ts ก่อนการ์ด authDerive เสมอ ─────────────────────────────────────────────────────────────
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { appConfig, rooms, tenants } from "../db/schema";
import {
  getLineSettings, verifyLiffAccessToken, findTenantByLineUserId, findTenantsByPhone, getOutstandingBillsForTenant,
} from "../services/line";
import { linkRichMenuToUser } from "../services/richMenu";
import { broadcastChange } from "../lib/wsHub";

const CONFIG_ID = "default";

async function getConfigRow() {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.id, CONFIG_ID));
  return row;
}

function tenantDisplayName(tenant: { title: string | null; firstName: string | null; lastName: string | null }): string {
  return `${tenant.title ?? ""}${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim();
}

async function tenantRoomNumber(idRoom: string | null): Promise<string> {
  if (!idRoom) return "";
  const [room] = await db.select().from(rooms).where(eq(rooms.id, idRoom));
  return room?.number ?? "";
}

// สลับจาก Rich Menu Guest เป็น Member เฉพาะ LINE User ID นี้ — ใช้ทั้งตอน login ปกติ (เจอว่าผูกไว้แล้ว)
// และตอนผูกบัญชีเองผ่านเบอร์โทร (link-phone) เพิ่งผูกสำเร็จหมาดๆ
async function linkMemberMenu(userId: string): Promise<boolean> {
  const row = await getConfigRow();
  const settings = await getLineSettings();
  if (!settings.token || !row?.richMenuMemberId) return false;
  return linkRichMenuToUser(settings.token, userId, row.richMenuMemberId);
}

export const liffRoute = new Elysia({ prefix: "/liff" })
  // ข้อมูลตั้งค่าที่จำเป็นก่อนเรียก liff.init() ฝั่ง frontend (LIFF ID ฝังอยู่ใน URL รูปแบบ
  // https://liff.line.me/{liffId}) + โลโก้/ชื่อระบบไว้ตกแต่งหน้าให้ตรงธีมเว็บหลัก — ไม่ใช่ข้อมูลลับ
  .get("/config", async () => {
    const row = await getConfigRow();
    return {
      liffLoginUrl: row?.liffLoginUrl || "",
      liffPaymentUrl: row?.liffPaymentUrl || "",
      appIdentity: {
        logoUrl: row?.logoUrl || "",
        nameText: row?.appName || "",
        logoBg: { enabled: row?.logoBgEnabled === "true", color: row?.logoBgColor || "#ffffff" },
      },
    };
  })
  // ปุ่ม "เข้าสู่ระบบ" บนเมนู Guest — ตรวจ access token กับ LINE แล้วหาว่าผูกกับผู้เช่าคนไหนไว้หรือยัง
  // ถ้าเจอ ผูก Rich Menu แบบ Member ให้อัตโนมัติ (สลับจาก Guest เป็น Member เฉพาะคนนี้)
  .post("/login", async ({ body, set }) => {
    const { accessToken } = body as { accessToken?: string };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const tenant = await findTenantByLineUserId(profile.userId);
    if (!tenant) {
      return { linked: false, lineUserId: profile.userId, displayName: profile.displayName };
    }

    const menuLinked = await linkMemberMenu(profile.userId);

    return {
      linked: true,
      tenantName: tenantDisplayName(tenant),
      roomNumber: await tenantRoomNumber(tenant.idRoom),
      menuLinked,
    };
  })
  // ผูกบัญชี LINE เข้ากับผู้เช่าเองผ่านเบอร์โทร (ทางเลือกในหน้า LIFF Login ตอนยังไม่พบว่าผูกไว้) — ยึดหลัก
  // "1 เบอร์ต่อ 1 คน": ผูกได้ครั้งแรกที่เบอร์นี้ยังไม่เคยผูก LINE ไว้เท่านั้น ถ้ามีคนผูกไปแล้ว (ไม่ว่าจะเป็น
  // LINE ID เดียวกันหรือคนละคน) จะไม่ยอมให้เบอร์นี้ผูกทับ ป้องกันคนอื่นแอบพิมพ์เบอร์คนอื่นเพื่อขโมยบัญชีไปก่อน
  .post("/link-phone", async ({ body, set }) => {
    const { accessToken, phone } = body as { accessToken?: string; phone?: string };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }
    if (!phone?.trim()) { set.status = 400; return { error: "กรุณากรอกเบอร์โทรศัพท์" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const matches = await findTenantsByPhone(phone);
    if (matches.length === 0) { set.status = 404; return { error: "ไม่พบเบอร์โทรศัพท์นี้ในระบบ กรุณาติดต่อผู้ดูแลหอพัก" }; }
    if (matches.length > 1) { set.status = 409; return { error: "พบเบอร์นี้ซ้ำกันมากกว่า 1 คนในระบบ กรุณาติดต่อผู้ดูแลหอพัก" }; }

    const tenant = matches[0];
    const existingLineUserId = (tenant.lineUserId ?? "").trim();
    if (existingLineUserId) {
      set.status = 409;
      return { error: "เบอร์นี้ผูกกับบัญชี LINE ไว้แล้ว หากไม่ใช่คุณ กรุณาติดต่อผู้ดูแลหอพัก" };
    }

    await db.update(tenants).set({ lineUserId: profile.userId }).where(eq(tenants.id, tenant.id));
    broadcastChange("tenant", "update", "ผู้เช่าผูกบัญชี LINE เอง (เบอร์โทร)", tenantDisplayName(tenant));

    const menuLinked = await linkMemberMenu(profile.userId);

    return {
      linked: true,
      tenantName: tenantDisplayName(tenant),
      roomNumber: await tenantRoomNumber(tenant.idRoom),
      menuLinked,
    };
  })
  // ปุ่ม "ชำระเงิน" บนเมนู Member — แสดงยอดค้างชำระ + ข้อมูลบัญชี/QR ที่ตั้งค่าไว้ในหน้า Settings
  .post("/payment", async ({ body, set }) => {
    const { accessToken } = body as { accessToken?: string };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const tenant = await findTenantByLineUserId(profile.userId);
    if (!tenant) return { linked: false };

    const row = await getConfigRow();
    const outstanding = await getOutstandingBillsForTenant(tenant.id);

    return {
      linked: true,
      tenantName: tenantDisplayName(tenant),
      roomNumber: await tenantRoomNumber(tenant.idRoom),
      outstanding,
      paymentInfo: {
        bankName: row?.paymentBankName || "",
        accountName: row?.paymentAccountName || "",
        accountNumber: row?.paymentAccountNumber || "",
        qrImage: row?.paymentQrImage || "",
      },
    };
  });
