// ── หน้า LIFF ฝั่งผู้เช่า (Login/Payment) — สาธารณะ ไม่ต้องล็อกอินด้วย Bearer ของระบบเรา (เหมือน
// lineWebhook.ts) เพราะผู้เช่าไม่มีบัญชีพนักงาน ยืนยันตัวตนด้วย LIFF access token (ของผู้ใช้ LINE เอง)
// กับ LINE ตรงๆ แทน (ดู verifyLiffAccessToken ใน services/line.ts) เมานต์คู่กับ authPublicRoute ใน
// index.ts ก่อนการ์ด authDerive เสมอ ─────────────────────────────────────────────────────────────
// Multi-tenant: แต่ละ endpoint รู้ "องค์กร" ของตัวเองจาก ?org=<slug> ที่แนบท้าย LIFF Endpoint URL ของแต่ละ
// องค์กร (ตั้งค่าเองใน LINE Developers Console ตอนสร้าง LIFF app — ดู resolveOrgId ด้านล่าง, slug แสดงอยู่ใน
// หน้า Settings > LINE Messaging) ถ้าไม่มี/slug ไม่ตรงกับองค์กรไหนเลย จะ fallback ไปองค์กรเดียวที่มีอยู่ใน
// ระบบก็ต่อเมื่อระบบมีองค์กรเดียวจริงๆ เท่านั้น (ดู resolveOrgIdWithFallback ใน lib/orgContext.ts) — มีตั้งแต่
// 2 องค์กรขึ้นไปแล้ว request ที่ไม่มี ?org= ที่ถูกต้องจะได้ 503 แทนที่จะหลุดไปอ่าน/เขียนข้อมูลองค์กรอื่นผิดๆ
import { Elysia } from "elysia";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db";
import { appConfig, rooms, towers, bookings, tenants, chatMessages, lineProfiles, paymentIntents, vehicles, vehicleTypes } from "../db/schema";
import {
  getLineSettings, verifyLiffAccessToken, findTenantByLineUserId, findTenantsByPhone,
  getOutstandingBillsForTenant, getBillItemForTenant, getThisMonthBillItemForTenant,
  getAllBillsForTenant, getPaymentHistoryForTenant, uploadChatAttachment,
} from "../services/line";
import { linkRichMenuToUser } from "../services/richMenu";
import { generatePromptPayQr } from "../services/easyslip";
import { broadcastChange, broadcastChatMessage, broadcastWebPresence } from "../lib/wsHub";
import { resolveOrgIdBySlug, resolveOrgIdWithFallback } from "../lib/orgContext";
import { decryptField, signUploadPath } from "../lib/encryption";

async function resolveOrgId(orgSlug: unknown): Promise<string | null> {
  const candidate = typeof orgSlug === "string" && orgSlug ? await resolveOrgIdBySlug(orgSlug) : null;
  return resolveOrgIdWithFallback(candidate);
}

// ป้ายชื่อหน้า LIFF ภาษาไทย ให้ตรงกับข้อความปุ่มบน Rich Menu (ดู services/richMenu.ts) — ใช้ประกอบข้อความ
// แจ้งเตือน "กำลังใช้งานหน้า ... ผ่าน web" ใน POST /presence ด้านล่าง คีย์ (page) มาจากที่ frontend ส่งมาเอง
// ต่อหน้า LIFF หนึ่งๆ (ดู Liff*Page.tsx)
const LIFF_PAGE_LABELS: Record<string, string> = {
  login: "เข้าสู่ระบบ",
  rooms: "ดูห้องว่าง",
  booking: "จองห้อง",
  payment: "ชำระเงิน",
  profile: "ข้อมูลผู้เช่า",
  repair: "แจ้งซ่อม",
};

async function getConfigRow(orgId: string) {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.id, orgId));
  return row;
}

interface PaymentAccountAssign {
  mode: "all" | "rooms" | "tower" | "floor" | "random" | "auto";
  roomIds?: string[];
  towerIds?: string[];
  floors?: string[];
}
interface PaymentAccount {
  id: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  qrImage: string;
  bankLogoImage: string;
  promptPayId: string;
  assign?: PaymentAccountAssign;
}

function parsePaymentAccounts(raw: string | null | undefined): PaymentAccount[] {
  try {
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// สุ่ม/หมุนแบบ "คงที่" ต่อห้อง (hash เลขห้อง) — ไม่ใช่สุ่มใหม่ทุกครั้งที่เปิดหน้า ไม่งั้นผู้เช่าจะเห็นบัญชีเปลี่ยน
// ไปมาสับสน (โอนเงินผิดบัญชีจากที่เคยเห็นครั้งก่อน) ห้องเดียวกันจะได้บัญชีเดิมเสมอตราบใดที่ยังอยู่ในกลุ่มเดิม
function stableHashIndex(seed: string, mod: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % mod;
}

// เลือกบัญชีรับชำระเงินที่ถูกต้องสำหรับห้องหนึ่งๆ จากรายการบัญชีที่ตั้งไว้หลายบัญชี (ดู payment.accounts ใน
// routes/settings.ts) ลำดับความสำคัญ: ห้องที่เลือกไว้ตรงๆ > ตึกที่เลือกไว้ > ชั้นที่เลือกไว้ > กลุ่ม "สุ่ม"
// (hash คงที่ต่อห้อง) > กลุ่ม "อัตโนมัติ" (hash คงที่ต่อห้องเหมือนกัน แค่แยกกลุ่ม ให้เลือกได้อิสระจากกลุ่มสุ่ม —
// ไม่ใช่การหมุนเวียนแบ่งเท่าๆ กันแบบเป๊ะ เพราะจุดนี้รู้แค่ห้องเดียวที่กำลังจะเลือก ไม่รู้ลำดับห้องทั้งหมด) >
// บัญชีที่ตั้งเป็น "ทั้งหมด" (ค่าเริ่มต้น) > บัญชีแรกสุดในรายการ (กันกรณีไม่มีบัญชีไหนตั้ง mode ไว้เลย)
async function resolvePaymentAccountForRoom(orgId: string, accounts: PaymentAccount[], roomId: string | null | undefined): Promise<PaymentAccount | null> {
  if (accounts.length === 0) return null;
  if (accounts.length === 1) return accounts[0];

  let room: { id: string; towerId: string | null; floor: string | null } | null = null;
  if (roomId) {
    const [r] = await db.select({ id: rooms.id, towerId: rooms.towerId, floor: rooms.floor })
      .from(rooms).where(and(eq(rooms.id, roomId), eq(rooms.orgId, orgId)));
    room = r ?? null;
  }

  if (room) {
    const byRoom = accounts.find((a) => a.assign?.mode === "rooms" && a.assign.roomIds?.includes(room!.id));
    if (byRoom) return byRoom;
    const byTower = room.towerId ? accounts.find((a) => a.assign?.mode === "tower" && a.assign.towerIds?.includes(room!.towerId!)) : undefined;
    if (byTower) return byTower;
    const byFloor = room.floor ? accounts.find((a) => a.assign?.mode === "floor" && a.assign.floors?.includes(room!.floor!)) : undefined;
    if (byFloor) return byFloor;
  }

  const seed = room?.id ?? roomId ?? "";
  if (seed) {
    const randomPool = accounts.filter((a) => a.assign?.mode === "random");
    if (randomPool.length > 0) return randomPool[stableHashIndex(seed, randomPool.length)];
    const autoPool = accounts.filter((a) => a.assign?.mode === "auto");
    if (autoPool.length > 0) return autoPool[stableHashIndex(`auto:${seed}`, autoPool.length)];
  }

  return accounts.find((a) => !a.assign || a.assign.mode === "all") ?? accounts[0];
}

function tenantDisplayName(tenant: { title: string | null; firstName: string | null; lastName: string | null }): string {
  return `${tenant.title ?? ""}${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim();
}

async function tenantRoomNumber(idRoom: string | null): Promise<string> {
  if (!idRoom) return "";
  const [room] = await db.select().from(rooms).where(eq(rooms.id, idRoom));
  return room?.number ?? "";
}

function parseJsonArray(raw: string | null): any[] {
  try {
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// กันเดารหัสเลขบัตรประชาชน 4 ตัวท้ายมั่วๆ ซ้ำๆ (มีแค่ 10,000 ความเป็นไปได้) — จำกัดจำนวนครั้งที่พลาดได้ต่อ
// ผู้เช่า 1 คนต่อช่วงเวลาหนึ่ง เก็บใน memory เฉยๆ พอ (ไม่ต้องมีตาราง DB แยก) รีเซ็ตตอนเซิร์ฟเวอร์รีสตาร์ท
// หรือทันทีที่ยืนยันถูกต้องครั้งถัดไป
const PROFILE_VERIFY_MAX_ATTEMPTS = 5;
const PROFILE_VERIFY_WINDOW_MS = 15 * 60 * 1000;
const profileVerifyAttempts = new Map<string, { count: number; windowStart: number }>();

function isProfileVerifyBlocked(tenantId: string): boolean {
  const entry = profileVerifyAttempts.get(tenantId);
  if (!entry) return false;
  if (Date.now() - entry.windowStart > PROFILE_VERIFY_WINDOW_MS) {
    profileVerifyAttempts.delete(tenantId);
    return false;
  }
  return entry.count >= PROFILE_VERIFY_MAX_ATTEMPTS;
}

function recordProfileVerifyFailure(tenantId: string): void {
  const now = Date.now();
  const entry = profileVerifyAttempts.get(tenantId);
  if (!entry || now - entry.windowStart > PROFILE_VERIFY_WINDOW_MS) {
    profileVerifyAttempts.set(tenantId, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

function resetProfileVerifyAttempts(tenantId: string): void {
  profileVerifyAttempts.delete(tenantId);
}

// สลับจาก Rich Menu Guest เป็น Member เฉพาะ LINE User ID นี้ — ใช้ทั้งตอน login ปกติ (เจอว่าผูกไว้แล้ว)
// และตอนผูกบัญชีเองผ่านเบอร์โทร (link-phone) เพิ่งผูกสำเร็จหมาดๆ
async function linkMemberMenu(orgId: string, userId: string): Promise<boolean> {
  const row = await getConfigRow(orgId);
  const settings = await getLineSettings(orgId);
  if (!settings.token || !row?.richMenuMemberId) return false;
  return linkRichMenuToUser(settings.token, userId, row.richMenuMemberId);
}

export const liffRoute = new Elysia({ prefix: "/liff" })
  // ข้อมูลตั้งค่าที่จำเป็นก่อนเรียก liff.init() ฝั่ง frontend (LIFF ID ฝังอยู่ใน URL รูปแบบ
  // https://liff.line.me/{liffId}) + โลโก้/ชื่อระบบไว้ตกแต่งหน้าให้ตรงธีมเว็บหลัก — ไม่ใช่ข้อมูลลับ
  .get("/config", async ({ query }) => {
    const orgId = await resolveOrgId(query.org);
    const row = orgId ? await getConfigRow(orgId) : undefined;
    return {
      liffLoginUrl: row?.liffLoginUrl || "",
      liffPaymentUrl: row?.liffPaymentUrl || "",
      liffProfileUrl: row?.liffProfileUrl || "",
      liffRepairUrl: row?.liffRepairUrl || "",
      liffRoomsUrl: row?.liffRoomsUrl || "",
      liffBookingUrl: row?.liffBookingUrl || "",
      contactPhone: row?.contactPhone || "",
      appIdentity: {
        logoUrl: row?.logoUrl || "",
        nameText: row?.appName || "",
        logoBg: { enabled: row?.logoBgEnabled === "true", color: row?.logoBgColor || "#ffffff" },
      },
      // ไม่ใช่ข้อมูลลับ — ให้หน้า LIFF Payment/Profile เรนเดอร์การ์ดบิลด้วย BillLinePreview แบบเดียวกับ
      // ที่พนักงานเห็นในหน้า Bills (ดู components/BillLinePreviewCard.tsx) ได้ครบ ไม่ต้องพึ่ง useAppConfig()
      // ที่ต้องล็อกอินพนักงานก่อนถึงจะดึงได้
      features: { splitRentByResidents: row?.splitRentByResidents === "true" },
      overdue: {
        enabled: row?.overdueEnabled === "true",
        day: Number(row?.overdueDay) || 0,
        type: row?.overdueFineType || "fixed",
        amount: Number(row?.overdueFineAmount) || 0,
      },
    };
  })
  // เรียกจากทุกหน้า LIFF (Liff*Page.tsx) ทันทีที่ได้ access token มา — แค่แจ้งเตือนชั่วคราวมุมขวาล่างของหน้า
  // แชท (ไม่บันทึกลง DB เลย ดู broadcastWebPresence ใน lib/wsHub.ts) ว่าใครกำลังเปิดหน้า LIFF ไหนอยู่ผ่านปุ่ม
  // Rich Menu ที่เป็น type: uri (ต่างจากปุ่ม type: message ที่มีข้อความจริงส่งเข้าแชทให้เห็นอยู่แล้วโดยอัตโนมัติ)
  // best-effort ล้วนๆ ไม่ throw ไม่บล็อกการโหลดหน้า LIFF ด้วยเหตุผลรอง
  .post("/presence", async ({ body, query }) => {
    const { accessToken, page } = body as { accessToken?: string; page?: string };
    const pageLabel = page ? LIFF_PAGE_LABELS[page] : undefined;
    if (!accessToken || !pageLabel) return { ok: false };
    const orgId = await resolveOrgId(query.org);
    if (!orgId) return { ok: false };

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) return { ok: false };

    const tenant = await findTenantByLineUserId(orgId, profile.userId);
    const displayName = tenant ? tenantDisplayName(tenant) : profile.displayName;
    const roomNumber = tenant ? await tenantRoomNumber(tenant.idRoom) : "";

    broadcastWebPresence(orgId, {
      lineUserId: profile.userId,
      displayName: displayName || "ไม่ทราบชื่อ",
      roomNumber: roomNumber || null,
      pictureUrl: profile.pictureUrl || null,
      pageLabel,
    });

    return { ok: true };
  })
  // ปุ่ม "เข้าสู่ระบบ" บนเมนู Guest — ตรวจ access token กับ LINE แล้วหาว่าผูกกับผู้เช่าคนไหนไว้หรือยัง
  // ถ้าเจอ ผูก Rich Menu แบบ Member ให้อัตโนมัติ (สลับจาก Guest เป็น Member เฉพาะคนนี้)
  .post("/login", async ({ body, set, query }) => {
    const { accessToken } = body as { accessToken?: string };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }
    const orgId = await resolveOrgId(query.org);
    if (!orgId) { set.status = 503; return { error: "ระบบยังไม่พร้อมใช้งาน" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const tenant = await findTenantByLineUserId(orgId, profile.userId);
    if (!tenant) {
      return { linked: false, lineUserId: profile.userId, displayName: profile.displayName };
    }

    const menuLinked = await linkMemberMenu(orgId, profile.userId);

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
  .post("/link-phone", async ({ body, set, query }) => {
    const { accessToken, phone } = body as { accessToken?: string; phone?: string };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }
    if (!phone?.trim()) { set.status = 400; return { error: "กรุณากรอกเบอร์โทรศัพท์" }; }
    const orgId = await resolveOrgId(query.org);
    if (!orgId) { set.status = 503; return { error: "ระบบยังไม่พร้อมใช้งาน" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const matches = await findTenantsByPhone(orgId, phone);
    if (matches.length === 0) { set.status = 404; return { error: "ไม่พบเบอร์โทรศัพท์นี้ในระบบ กรุณาติดต่อผู้ดูแลหอพัก" }; }
    if (matches.length > 1) { set.status = 409; return { error: "พบเบอร์นี้ซ้ำกันมากกว่า 1 คนในระบบ กรุณาติดต่อผู้ดูแลหอพัก" }; }

    const tenant = matches[0];
    const existingLineUserId = (tenant.lineUserId ?? "").trim();
    if (existingLineUserId) {
      set.status = 409;
      return { error: "เบอร์นี้ผูกกับบัญชี LINE ไว้แล้ว หากไม่ใช่คุณ กรุณาติดต่อผู้ดูแลหอพัก" };
    }

    await db.update(tenants).set({ lineUserId: profile.userId }).where(eq(tenants.id, tenant.id));
    broadcastChange(orgId, "tenant", "update", "ผู้เช่าผูกบัญชี LINE เอง (เบอร์โทร)", tenantDisplayName(tenant));

    const menuLinked = await linkMemberMenu(orgId, profile.userId);

    return {
      linked: true,
      tenantName: tenantDisplayName(tenant),
      roomNumber: await tenantRoomNumber(tenant.idRoom),
      menuLinked,
    };
  })
  // ปุ่ม "ชำระเงิน" บนเมนู Member — แสดงยอดค้างชำระ + ข้อมูลบัญชี/QR ที่ตั้งค่าไว้ในหน้า Settings
  .post("/payment", async ({ body, set, query }) => {
    const { accessToken } = body as { accessToken?: string };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }
    const orgId = await resolveOrgId(query.org);
    if (!orgId) { set.status = 503; return { error: "ระบบยังไม่พร้อมใช้งาน" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const tenant = await findTenantByLineUserId(orgId, profile.userId);
    if (!tenant) return { linked: false };

    const row = await getConfigRow(orgId);
    const outstanding = await getOutstandingBillsForTenant(orgId, tenant.id);

    // หลายบัญชี — เลือกบัญชีที่ถูกกำหนดไว้สำหรับห้องของผู้เช่าคนนี้ (ดู resolvePaymentAccountForRoom ด้านบน)
    // ไม่มีบัญชีที่ตั้งไว้เลยก็ fallback ไปฟิลด์เดี่ยวเก่า (องค์กรที่ยังไม่เคยบันทึกหน้านี้ใหม่)
    const accounts = parsePaymentAccounts(row?.paymentAccounts);
    const account = await resolvePaymentAccountForRoom(orgId, accounts, tenant.idRoom);

    return {
      linked: true,
      tenantName: tenantDisplayName(tenant),
      roomNumber: await tenantRoomNumber(tenant.idRoom),
      outstanding,
      paymentInfo: {
        bankName: account?.bankName || row?.paymentBankName || "",
        accountName: account?.accountName || row?.paymentAccountName || "",
        accountNumber: account?.accountNumber || row?.paymentAccountNumber || "",
        qrImage: account?.qrImage || row?.paymentQrImage || "",
        bankLogoUrl: account?.bankLogoImage || row?.paymentBankLogoImage || "",
        // เปิดสวิตช์ EasySlip ไว้ (easySlipEnabled) และมี API key ก็เลือกจำนวนเงินเอง+ตรวจสลิปอัตโนมัติได้แล้ว
        // (endpoint /payment/qr ด้านล่าง) — ไม่จำเป็นต้องมี PromptPay ID ด้วย (บางที่ผูกบัญชีธนาคารธรรมดากับ
        // EasySlip ไว้ ไม่มี PromptPay ID ให้ใช้สร้าง QR จริง) ถ้าไม่มี PromptPay ID จะโชว์เลขบัญชีให้คัดลอกแทน
        // QR แต่ยังตรวจสลิปอัตโนมัติได้เหมือนเดิม ปิดสวิตช์ไว้หรือไม่มี API key เลยถึงจะ fallback ไปโชว์แค่
        // QR/เลขบัญชีคงที่แบบไม่ตรวจสลิปให้ — promptPayId ต้องมาจากบัญชีที่เลือกไว้จริง (คนละบัญชีอาจผูก
        // PromptPay คนละเลขกัน) ไม่ใช่ฟิลด์เดี่ยวเก่าที่เป็นของบัญชีแรกเท่านั้น
        autoTrackingAvailable: row?.easySlipEnabled === "true" && !!row?.easySlipApiKey,
        qrGenerationAvailable: row?.easySlipEnabled === "true" && !!(row?.easySlipApiKey && (account?.promptPayId || row?.paymentPromptPayId)),
      },
    };
  })
  // กดปุ่ม "ดูรายละเอียด" ที่บิลเดือนใดเดือนหนึ่งในหน้า LIFF Payment/Profile — คืน item ดิบ (ตรงกับ
  // BillItem ใน frontend/src/utils/billCalc.ts) ให้ฝั่ง frontend เรนเดอร์ด้วย BillLinePreview เดียวกับที่
  // พนักงานเห็นในหน้า Bills (หน้าตาแบบ "บิลอิเล็กทรอนิกส์ LINE") ไม่ใช่การ์ดแบบย่อในหน้าแชท
  .post("/bill-detail", async ({ body, set, query }) => {
    const { accessToken, billId, roomId } = body as { accessToken?: string; billId?: string; roomId?: string };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }
    if (!billId || !roomId) { set.status = 400; return { error: "ข้อมูลไม่ครบ" }; }
    const orgId = await resolveOrgId(query.org);
    if (!orgId) { set.status = 503; return { error: "ระบบยังไม่พร้อมใช้งาน" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const tenant = await findTenantByLineUserId(orgId, profile.userId);
    if (!tenant) { set.status = 404; return { error: "ไม่พบข้อมูลผู้เช่า" }; }

    const found = await getBillItemForTenant(orgId, billId, roomId, tenant.id);
    if (!found) { set.status = 404; return { error: "ไม่พบข้อมูลบิล" }; }

    return { item: found.item, monthYear: found.monthYear };
  })
  // ปุ่ม "บิลเดือนนี้" บนเมนู Member (ลิงก์ "?view=thisMonth" ต่อท้าย LIFF Payment URL — ดู memberAreas ใน
  // services/richMenu.ts) ต่างจาก /bill-detail ตรงที่ไม่รู้ billId/roomId ล่วงหน้า (เมนูเป็น URL เดียวใช้ร่วมกัน
  // ทุกคน) ต้องไล่หาเองว่า "เดือนปัจจุบันตามเวลาไทย" ของผู้เช่าคนนี้คือบิลใบไหน (ดู getThisMonthBillItemForTenant)
  .post("/bill-detail/this-month", async ({ body, set, query }) => {
    const { accessToken } = body as { accessToken?: string };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }
    const orgId = await resolveOrgId(query.org);
    if (!orgId) { set.status = 503; return { error: "ระบบยังไม่พร้อมใช้งาน" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const tenant = await findTenantByLineUserId(orgId, profile.userId);
    if (!tenant) { set.status = 404; return { error: "ไม่พบข้อมูลผู้เช่า กรุณาเข้าสู่ระบบก่อน" }; }

    const found = await getThisMonthBillItemForTenant(orgId, tenant.id);
    if (!found) { set.status = 404; return { error: "ยังไม่มีบิลของคุณประจำเดือนนี้ในระบบ กรุณารอประกาศจากผู้ดูแลหอพัก" }; }

    return { billId: found.billId, roomId: found.roomId, item: found.item, monthYear: found.monthYear };
  })
  // เลือกจำนวนเงินที่จะจ่ายรอบนี้ (ไม่ต้องเต็มยอดบิล จ่ายเป็นงวดได้) แล้วบันทึก "รายการรอชำระ" ไว้จับคู่กับ
  // สลิปที่จะส่งเข้าแชทภายหลัง (ดู services/payments.ts) — สร้าง QR PromptPay ระบุยอดจริงให้ด้วยถ้ามี
  // PromptPay ID ตั้งไว้ ไม่งั้นคืนแค่เลขบัญชีให้โชว์เป็นข้อความคัดลอกแทน (ตรวจสลิปอัตโนมัติได้เหมือนกันทั้ง
  // สองแบบ เพราะขึ้นกับ "รายการรอชำระ" ที่บันทึกไว้ ไม่ได้ขึ้นกับว่าสร้าง QR ได้จริงหรือเปล่า)
  .post("/payment/qr", async ({ body, set, query }) => {
    const { accessToken, billId, roomId, amount } = body as { accessToken?: string; billId?: string; roomId?: string; amount?: number };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }
    if (!billId || !roomId) { set.status = 400; return { error: "ข้อมูลไม่ครบ" }; }
    const orgId = await resolveOrgId(query.org);
    if (!orgId) { set.status = 503; return { error: "ระบบยังไม่พร้อมใช้งาน" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const tenant = await findTenantByLineUserId(orgId, profile.userId);
    if (!tenant) { set.status = 404; return { error: "ไม่พบข้อมูลผู้เช่า" }; }

    const found = await getBillItemForTenant(orgId, billId, roomId, tenant.id);
    if (!found) { set.status = 404; return { error: "ไม่พบข้อมูลบิล" }; }
    const { item, monthYear } = found;

    const remainingDue = Math.max(0, Number(item.total) - (Number(item.paidAmount) || 0));
    const payAmount = Math.round((Number(amount) || 0) * 100) / 100;
    if (payAmount <= 0 || payAmount > remainingDue + 0.5) {
      set.status = 400;
      return { error: `จำนวนเงินไม่ถูกต้อง (ยอดคงเหลือ ${remainingDue.toFixed(2)} บาท)` };
    }

    const row = await getConfigRow(orgId);
    if (row?.easySlipEnabled !== "true") {
      set.status = 400;
      return { error: "ระบบยังไม่ได้เปิดใช้งาน EasySlip กรุณาติดต่อผู้ดูแลระบบ" };
    }
    const apiKey = decryptField(row?.easySlipApiKey || "");
    // หลายบัญชี — สร้าง QR ด้วย PromptPay ID ของบัญชีที่ถูกกำหนดไว้สำหรับห้องนี้ (ดู resolvePaymentAccountForRoom)
    // ไม่ใช่ฟิลด์เดี่ยวเก่าตรงๆ เพราะคนละบัญชีอาจผูก PromptPay คนละเลขกัน
    const accounts = parsePaymentAccounts(row?.paymentAccounts);
    const account = await resolvePaymentAccountForRoom(orgId, accounts, roomId);
    const promptPayId = account?.promptPayId || row?.paymentPromptPayId || "";
    if (!apiKey) {
      set.status = 400;
      return { error: "ระบบยังไม่ได้ตั้งค่า EasySlip API Key กรุณาติดต่อผู้ดูแลระบบ" };
    }

    let qrImage: string | null = null;
    if (promptPayId) {
      try {
        const qr = await generatePromptPayQr(apiKey, promptPayId, payAmount);
        qrImage = `data:${qr.mime};base64,${qr.image}`;
      } catch (e: any) {
        set.status = 502;
        return { error: e?.message ?? "สร้าง QR ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
      }
    }

    const intentId = `PINT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(paymentIntents).values({
      id: intentId,
      orgId,
      tenantId: tenant.id,
      tenantName: tenantDisplayName(tenant),
      billId, roomId,
      roomNumber: String(item.roomNumber ?? await tenantRoomNumber(tenant.idRoom)),
      monthYear,
      amount: String(payAmount),
      status: "pending",
      lineUserId: profile.userId,
      createdAt: new Date().toISOString(),
    });

    return {
      intentId,
      qrImage,
      amount: payAmount,
      accountInfo: qrImage ? null : {
        bankName: account?.bankName || row?.paymentBankName || "",
        accountName: account?.accountName || row?.paymentAccountName || "",
        accountNumber: account?.accountNumber || row?.paymentAccountNumber || "",
        bankLogoImage: account?.bankLogoImage || "",
      },
    };
  })
  // หน้า LIFF โพลสถานะเป็นระยะหลังสร้าง QR — ให้รู้ทันทีที่ตรวจสลิปสำเร็จอัตโนมัติ (ดู
  // tryAutoConfirmSlipPayment ใน services/payments.ts ที่อัปเดตสถานะนี้จาก routes/lineWebhook.ts)
  .post("/payment/status", async ({ body, set, query }) => {
    const { accessToken, intentId } = body as { accessToken?: string; intentId?: string };
    if (!accessToken || !intentId) { set.status = 400; return { error: "ข้อมูลไม่ครบ" }; }
    const orgId = await resolveOrgId(query.org);
    if (!orgId) { set.status = 503; return { error: "ระบบยังไม่พร้อมใช้งาน" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const [intent] = await db.select().from(paymentIntents).where(and(eq(paymentIntents.id, intentId), eq(paymentIntents.orgId, orgId)));
    if (!intent || intent.lineUserId !== profile.userId) { set.status = 404; return { error: "ไม่พบรายการ" }; }

    return { status: intent.status };
  })
  // ปุ่ม "แจ้งว่าชำระเงินแล้ว" ในป็อปอัพ "จ่ายงวดนี้" — ทางเลือกสำรองกรณีตรวจสลิปอัตโนมัติด้วย EasySlip ไม่
  // สำเร็จ (ภาพไม่ชัด/ธนาคารไม่รองรับ/API ล่มชั่วคราว) ผู้เช่าแนบรูปสลิปเองแล้วส่งเป็นคำขอเข้าแชท (messageType
  // "payment_confirm") ให้พนักงานเห็นการ์ดคำขอแล้วกดยืนยัน/ปฏิเสธได้ตรงจากหน้าแชทเลย (ดู PATCH
  // /chat/conversations/:lineUserId/messages/:id/payment-confirm ใน routes/chat.ts) ต่างจากส่งรูปสลิปเข้า
  // แชทเฉยๆ ตรงที่มีการ์อ้างอิง "รายการรอชำระ" (intentId) ชัดเจน ไม่ต้องให้พนักงานไปหาเองว่าเป็นของบิลไหน
  .post("/payment/confirm", async ({ body, set, query }) => {
    const { accessToken, intentId, slipImage } = body as {
      accessToken?: string; intentId?: string; slipImage?: { base64?: string };
    };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }
    if (!intentId) { set.status = 400; return { error: "ข้อมูลไม่ครบ" }; }
    if (!slipImage?.base64) { set.status = 400; return { error: "กรุณาแนบรูปสลิปการโอนเงิน" }; }
    const orgId = await resolveOrgId(query.org);
    if (!orgId) { set.status = 503; return { error: "ระบบยังไม่พร้อมใช้งาน" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const [intent] = await db.select().from(paymentIntents).where(and(eq(paymentIntents.id, intentId), eq(paymentIntents.orgId, orgId)));
    if (!intent || intent.lineUserId !== profile.userId) { set.status = 404; return { error: "ไม่พบรายการรอชำระ" }; }
    if (intent.status !== "pending") { set.status = 400; return { error: "รายการนี้ถูกยืนยันไปแล้ว" }; }

    const slipUrl = await uploadChatAttachment(`payment_confirm_${Date.now()}.jpg`, slipImage.base64);

    const snapshot = {
      kind: "payment_confirm",
      intentId: intent.id,
      billId: intent.billId,
      roomId: intent.roomId,
      roomNumber: intent.roomNumber,
      monthYear: intent.monthYear,
      amount: Number(intent.amount) || 0,
      tenantName: intent.tenantName,
      slipUrl,
      status: "pending",
      rejectReason: "",
      confirmedBy: "",
      confirmedAt: "",
    };

    const id = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(chatMessages).values({
      id,
      orgId,
      lineUserId: profile.userId,
      tenantId: intent.tenantId || "",
      direction: "in",
      messageType: "payment_confirm",
      text: JSON.stringify(snapshot),
      senderName: intent.tenantName || "",
      createdAt: new Date().toISOString(),
    });

    const [profileCache] = await db.select().from(lineProfiles).where(eq(lineProfiles.lineUserId, profile.userId));
    broadcastChatMessage(orgId, {
      lineUserId: profile.userId,
      displayName: intent.tenantName || profile.displayName || "ไม่ทราบชื่อ",
      roomNumber: intent.roomNumber || null,
      pictureUrl: profileCache?.pictureUrl || profile.pictureUrl || null,
      preview: `💰 แจ้งชำระเงิน ${Number(intent.amount).toLocaleString("th-TH")} บาท`,
    });
    broadcastChange(orgId, "chat", "create", "มีการแจ้งชำระเงินใหม่", intent.tenantName || "");

    return { ok: true, messageId: id };
  })
  // ปุ่ม "ข้อมูลผู้เช่า" บนเมนู Member — ข้อมูลส่วนตัว + บิลทุกใบ (ทั้งจ่ายแล้ว/ค้างอยู่) + ประวัติการชำระเงินทั้งหมด
  .post("/profile", async ({ body, set, query }) => {
    const { accessToken } = body as { accessToken?: string };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }
    const orgId = await resolveOrgId(query.org);
    if (!orgId) { set.status = 503; return { error: "ระบบยังไม่พร้อมใช้งาน" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const tenant = await findTenantByLineUserId(orgId, profile.userId);
    if (!tenant) return { linked: false };

    const [tenantBills, paymentHistory] = await Promise.all([
      getAllBillsForTenant(orgId, tenant.id),
      getPaymentHistoryForTenant(orgId, tenant.id),
    ]);

    return {
      linked: true,
      tenant: {
        tenantName: tenantDisplayName(tenant),
        roomNumber: await tenantRoomNumber(tenant.idRoom),
        tel: tenant.tel || "",
        contractStartDate: tenant.contractStartDate || "",
        contractEndDate: tenant.contractEndDate || "",
      },
      bills: tenantBills,
      paymentHistory,
    };
  })
  // ปุ่ม "ดูข้อมูลส่วนตัวทั้งหมด" ในหน้า LIFF Profile — เปิดเผยข้อมูลอ่อนไหว (เลขบัตรประชาชนเต็ม, ที่อยู่,
  // ผู้พักอาศัยร่วม, รถ, ไฟล์แนบ/รูปที่อัปโหลดไว้) ต้องกรอกเลขบัตรประชาชน 4 ตัวท้ายให้ตรงกับที่บันทึกไว้ก่อน
  // (ชั้นป้องกันเพิ่มจาก LIFF access token เฉยๆ — กันกรณีมือถือ/เซสชันหลุดไปอยู่ในมือคนอื่น) จำกัดจำนวนครั้งที่
  // กรอกผิดได้ต่อผู้เช่า กันเดาเลข 4 หลักมั่วๆ ซ้ำๆ (ดู isProfileVerifyBlocked ด้านบน)
  .post("/profile/full", async ({ body, set, query }) => {
    const { accessToken, idLicenseLast4 } = body as { accessToken?: string; idLicenseLast4?: string };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }
    if (!idLicenseLast4?.trim()) { set.status = 400; return { error: "กรุณากรอกเลขบัตรประชาชน 4 ตัวท้าย" }; }
    const orgId = await resolveOrgId(query.org);
    if (!orgId) { set.status = 503; return { error: "ระบบยังไม่พร้อมใช้งาน" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const tenant = await findTenantByLineUserId(orgId, profile.userId);
    if (!tenant) { set.status = 404; return { error: "ไม่พบข้อมูลผู้เช่า กรุณาเข้าสู่ระบบก่อน" }; }

    if (isProfileVerifyBlocked(tenant.id)) {
      set.status = 429;
      return { error: "กรอกผิดหลายครั้งเกินไป กรุณาลองใหม่อีกครั้งภายหลัง" };
    }

    // idLicense เก็บในฐานข้อมูลพร้อมขีด (รูปแบบ X-XXXX-XXXXX-XX-X ดู formatIdCard ใน TenantFormView.tsx) ต้อง
    // ตัดเอาเฉพาะตัวเลขก่อนหยิบ 4 หลักท้าย ไม่งั้นจะได้ตัวขีดติดมาด้วย (เช่น "14-5" แทนที่จะเป็นเลข 4 หลักจริง)
    const actualLast4 = String(tenant.idLicense ?? "").replace(/\D/g, "").slice(-4);
    if (!actualLast4) { set.status = 400; return { error: "ไม่มีเลขบัตรประชาชนบันทึกไว้ในระบบ กรุณาติดต่อผู้ดูแลหอพัก" }; }
    if (idLicenseLast4.trim() !== actualLast4) {
      recordProfileVerifyFailure(tenant.id);
      set.status = 401;
      return { error: "เลขบัตรประชาชน 4 ตัวท้ายไม่ถูกต้อง" };
    }
    resetProfileVerifyAttempts(tenant.id);

    const extraRoomIds: string[] = parseJsonArray(tenant.extraRoomIds);
    const roomIds = [tenant.idRoom, ...extraRoomIds].filter(Boolean) as string[];
    const roomNumbers: string[] = [];
    for (const rid of roomIds) {
      const number = await tenantRoomNumber(rid);
      if (number) roomNumbers.push(number);
    }

    const [vehicleRows, vehicleTypeRows] = await Promise.all([
      db.select().from(vehicles).where(and(eq(vehicles.customerId, tenant.id), eq(vehicles.orgId, orgId))),
      db.select().from(vehicleTypes).where(eq(vehicleTypes.orgId, orgId)),
    ]);
    const typeMap = new Map(vehicleTypeRows.map((t) => [t.id, t]));
    const tenantVehicles = vehicleRows.map((v) => ({
      id: v.id,
      licensePlate: v.licensePlate,
      brand: v.brand,
      model: v.model,
      color: v.color,
      typeName: typeMap.get(v.vehicleTypeId || "")?.name || "",
      typeIcon: typeMap.get(v.vehicleTypeId || "")?.icon || "fas fa-car",
      images: parseJsonArray(v.images).map(signUploadPath),
    }));

    return {
      personal: {
        idLicense: tenant.idLicense || "",
        title: tenant.title || "",
        firstName: tenant.firstName || "",
        lastName: tenant.lastName || "",
        tel: tenant.tel || "",
        idLine: tenant.idLine || "",
        houseNo: tenant.houseNo || "",
        soi: tenant.soi || "",
        road: tenant.road || "",
        tambon: tenant.tambon || "",
        amphoe: tenant.amphoe || "",
        province: tenant.province || "",
        zipcode: tenant.zipcode || "",
        address: tenant.address || "",
        driveImageUrl: signUploadPath(tenant.driveImageUrl || ""),
      },
      roomNumbers,
      coResidents: parseJsonArray(tenant.coResidents).map((cr: any) => (cr?.image ? { ...cr, image: signUploadPath(cr.image) } : cr)),
      vehicles: tenantVehicles,
      files: parseJsonArray(tenant.pdfLinks).map((f: any) => (f?.url ? { ...f, url: signUploadPath(f.url) } : f)),
    };
  })
  // ปุ่ม "แจ้งซ่อม" บนเมนู Member — ผู้เช่ากรอกหัวข้อ/รายละเอียด/แนบรูป ส่งเข้ามาเป็นข้อความแชทพิเศษ
  // (messageType "repair") เด้งแจ้งเตือนในหน้าแชทของเว็บทันที (broadcastChatMessage เดียวกับข้อความเข้าใหม่
  // ปกติจาก routes/lineWebhook.ts) พนักงานกรอกรายละเอียดการซ่อม (อุปกรณ์/ราคา/รูป) แล้วกดยืนยันต่อได้จาก
  // หน้าแชทเลย (ดู PATCH /chat/conversations/:lineUserId/messages/:id/repair ใน routes/chat.ts)
  .post("/repair", async ({ body, set, query }) => {
    const { accessToken, title, details, photos } = body as {
      accessToken?: string; title?: string; details?: string; photos?: string[];
    };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }
    if (!title?.trim()) { set.status = 400; return { error: "กรุณากรอกหัวข้อที่ต้องการแจ้งซ่อม" }; }
    const orgId = await resolveOrgId(query.org);
    if (!orgId) { set.status = 503; return { error: "ระบบยังไม่พร้อมใช้งาน" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const tenant = await findTenantByLineUserId(orgId, profile.userId);
    if (!tenant) { set.status = 404; return { error: "ไม่พบข้อมูลผู้เช่า กรุณาเข้าสู่ระบบก่อน" }; }

    const tenantPhotos: string[] = [];
    for (const [i, base64] of (photos ?? []).slice(0, 6).entries()) {
      const url = await uploadChatAttachment(`repair_${Date.now()}_${i}.jpg`, base64);
      tenantPhotos.push(url);
    }

    const senderName = tenantDisplayName(tenant);
    const roomNumber = await tenantRoomNumber(tenant.idRoom);
    const snapshot = {
      kind: "repair",
      title: title.trim(),
      details: (details ?? "").trim(),
      tenantPhotos,
      roomNumber,
      status: "pending",
      adminItems: [] as { name: string; price: number; qty: number }[],
      adminPhotos: [] as string[],
      adminNote: "",
      confirmedBy: "",
      confirmedAt: "",
    };

    const id = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(chatMessages).values({
      id,
      orgId,
      lineUserId: profile.userId,
      tenantId: tenant.id,
      direction: "in",
      messageType: "repair",
      text: JSON.stringify(snapshot),
      senderName,
      createdAt: new Date().toISOString(),
    });

    const [profileCache] = await db.select().from(lineProfiles).where(eq(lineProfiles.lineUserId, profile.userId));
    broadcastChatMessage(orgId, {
      lineUserId: profile.userId,
      displayName: senderName || profile.displayName || "ไม่ทราบชื่อ",
      roomNumber: roomNumber || null,
      pictureUrl: profileCache?.pictureUrl || profile.pictureUrl || null,
      preview: `🔧 แจ้งซ่อม: ${title.trim()}`,
    });
    broadcastChange(orgId, "repair-request", "create", `มีการแจ้งซ่อมใหม่${roomNumber ? ` ห้อง ${roomNumber}` : ""}: ${title.trim()}`, senderName);

    return { ok: true, messageId: id };
  })
  // ปุ่ม "ดูห้องว่าง"/"จองห้อง" บนเมนู Guest — สาธารณะจริงๆ ไม่ต้องยืนยันตัวตน (ต่างจาก endpoint อื่นในไฟล์นี้
  // ที่ต้องรู้ว่าเป็นผู้เช่าคนไหน) เพราะยังไม่ใช่ผู้เช่า ดูรายการห้องที่สถานะ "ว่าง" และเปิดใช้งานอยู่เท่านั้น
  .get("/rooms", async ({ query }) => {
    const orgId = await resolveOrgId(query.org);
    if (!orgId) return [];
    const [roomRows, towerRows] = await Promise.all([
      db.select().from(rooms).where(eq(rooms.orgId, orgId)),
      db.select().from(towers).where(eq(towers.orgId, orgId)),
    ]);
    const towerMap = new Map(towerRows.map((t) => [t.id, t]));
    return roomRows
      .filter((r) => r.status === "ว่าง" && r.isActive !== "false")
      .map((r) => ({
        id: r.id,
        number: r.number,
        floor: r.floor,
        towerName: towerMap.get(r.towerId || "")?.name || "",
        towerColor: towerMap.get(r.towerId || "")?.color || "",
        price: Number(r.price) || 0,
        dailyPrice: Number(r.dailyPrice) || 0,
        detail: r.detail,
        pictures: parseJsonArray(r.pictures).map((p: any) => ({ ...p, url: signUploadPath(p.url) })),
      }));
  })
  // กด "จองห้องนี้" ในหน้า LIFF Booking (มาจากทางลัดในหน้า LiffRoomsPage หรือกรอกเองในหน้า LiffBookingPage) —
  // ยืนยันตัวตนด้วย LIFF access token เอาไว้ให้พนักงานติดต่อกลับ/แชทต่อได้ (ไม่ใช่การเช็คว่าเป็นผู้เช่าอยู่แล้ว
  // แบบ /repair เพราะคนจองห้องยังไม่เคยเป็นผู้เช่ามาก่อน) บันทึกลงตาราง bookings (เดิมมีอยู่แล้วในระบบแต่ไม่มี
  // ใครใช้ ตกค้างจากยุค Google Sheets) + **ล็อกห้องทันที** (rooms.status = "จอง") ผู้จองยกเลิกเองได้ที่หน้า
  // LiffBookingPage (ดู /rooms/cancel ด้านล่าง) ไม่ต้องรอพนักงานยืนยันอีกต่อไป — ยังคงขึ้นเป็นการ์ดในหน้าแชท
  // พนักงานเหมือนเดิม (messageType "booking") ไว้ให้เห็นเป็นแจ้งเตือนเฉยๆ
  .post("/rooms/book", async ({ body, set, query }) => {
    const { accessToken, roomId, name, tel } = body as {
      accessToken?: string; roomId?: string; name?: string; tel?: string;
    };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }
    if (!roomId) { set.status = 400; return { error: "กรุณาเลือกห้องที่ต้องการจอง" }; }
    if (!name?.trim()) { set.status = 400; return { error: "กรุณากรอกชื่อ" }; }
    if (!tel?.trim()) { set.status = 400; return { error: "กรุณากรอกเบอร์โทรศัพท์" }; }
    const orgId = await resolveOrgId(query.org);
    if (!orgId) { set.status = 503; return { error: "ระบบยังไม่พร้อมใช้งาน" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const [room] = await db.select().from(rooms).where(and(eq(rooms.id, roomId), eq(rooms.orgId, orgId)));
    if (!room) { set.status = 404; return { error: "ไม่พบห้องที่ต้องการจอง" }; }
    // กันจองซ้อน — ห้องอาจถูกคนอื่นจองไปแล้วระหว่างที่ผู้ใช้คนนี้ดูรายละเอียดอยู่ (สถานะเปลี่ยนจาก "ว่าง" ไปแล้ว)
    if (room.status !== "ว่าง") { set.status = 409; return { error: "ห้องนี้เพิ่งถูกจองไปแล้ว กรุณาเลือกห้องอื่น" }; }

    const ts = new Date().toISOString();
    const bookingId = `BK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(bookings).values({
      id: bookingId,
      orgId,
      timestamp: ts,
      source: "LIFF",
      roomId: room.id,
      roomNumber: room.number,
      roomCode: room.code,
      roomPrice: String(room.price),
      roomDetail: room.detail,
      firstName: name.trim(),
      lastName: "",
      tel: tel.trim(),
      idLine: profile.userId,
      status: "active",
      customerId: "",
      startDate: "",
      endDate: "",
    });
    await db.update(rooms).set({ status: "จอง" }).where(eq(rooms.id, room.id));

    const snapshot = {
      kind: "booking",
      roomNumber: room.number,
      roomDetail: room.detail,
      roomPrice: Number(room.price) || 0,
      name: name.trim(),
      tel: tel.trim(),
      bookedAt: ts,
    };
    const id = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(chatMessages).values({
      id,
      orgId,
      lineUserId: profile.userId,
      tenantId: "",
      direction: "in",
      messageType: "booking",
      text: JSON.stringify(snapshot),
      senderName: name.trim(),
      createdAt: ts,
    });

    const [profileCache] = await db.select().from(lineProfiles).where(eq(lineProfiles.lineUserId, profile.userId));
    broadcastChatMessage(orgId, {
      lineUserId: profile.userId,
      displayName: name.trim() || profile.displayName || "ไม่ทราบชื่อ",
      roomNumber: room.number || null,
      pictureUrl: profileCache?.pictureUrl || profile.pictureUrl || null,
      preview: `🏠 จองห้อง ${room.number}`,
    });
    broadcastChange(orgId, "room", "update", "มีการจองห้องใหม่ (ล็อกห้องอัตโนมัติ)", name.trim());

    return { ok: true, messageId: id, bookingId };
  })
  // หน้า LIFF Booking (LiffBookingPage.tsx) — รายการห้องที่ผู้ใช้ LINE คนนี้จองไว้อยู่ (status "active" เท่านั้น
  // อดีต/ที่ยกเลิกแล้วไม่ต้องโชว์) ใช้แสดงการ์ด "ห้องที่คุณจองอยู่" พร้อมปุ่มยกเลิกเอง
  .post("/rooms/mine", async ({ body, set, query }) => {
    const { accessToken } = body as { accessToken?: string };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }
    const orgId = await resolveOrgId(query.org);
    if (!orgId) { set.status = 503; return { error: "ระบบยังไม่พร้อมใช้งาน" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const myBookings = await db.select().from(bookings)
      .where(and(eq(bookings.idLine, profile.userId), eq(bookings.status, "active"), eq(bookings.orgId, orgId)));
    if (myBookings.length === 0) return { bookings: [] };

    const roomIds = myBookings.map((b) => b.roomId).filter(Boolean);
    const roomRows = roomIds.length > 0 ? await db.select().from(rooms).where(inArray(rooms.id, roomIds)) : [];
    const towerRows = await db.select().from(towers).where(eq(towers.orgId, orgId));
    const roomMap = new Map(roomRows.map((r) => [r.id, r]));
    const towerMap = new Map(towerRows.map((t) => [t.id, t]));

    return {
      bookings: myBookings.map((b) => {
        const room = roomMap.get(b.roomId);
        return {
          bookingId: b.id,
          roomId: b.roomId,
          roomNumber: b.roomNumber,
          towerName: room ? towerMap.get(room.towerId || "")?.name || "" : "",
          towerColor: room ? towerMap.get(room.towerId || "")?.color || "" : "",
          floor: room?.floor || "",
          price: Number(b.roomPrice) || 0,
          detail: b.roomDetail,
          pictures: room ? parseJsonArray(room.pictures).map((p: any) => ({ ...p, url: signUploadPath(p.url) })) : [],
          bookedAt: b.timestamp,
        };
      }),
    };
  })
  // ปุ่ม "ยกเลิกการจอง" ในหน้า LiffBookingPage — ยกเลิกได้เฉพาะรายการของตัวเอง (เช็ค idLine ตรงกับ token) และ
  // ต้องยัง "active" อยู่เท่านั้น ปลดล็อกห้องกลับเป็น "ว่าง" ให้อัตโนมัติ (เช็คก่อนว่าห้องยังเป็น "จอง" อยู่จริง
  // เผื่อพนักงานไปเปลี่ยนสถานะ/ผูกผู้เช่าจริงเข้าห้องนี้ไปแล้วระหว่างนั้น จะได้ไม่ไปเขี่ยสถานะที่ตั้งใจไว้ทิ้ง)
  .post("/rooms/cancel", async ({ body, set, query }) => {
    const { accessToken, bookingId } = body as { accessToken?: string; bookingId?: string };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }
    if (!bookingId) { set.status = 400; return { error: "ข้อมูลไม่ครบ" }; }
    const orgId = await resolveOrgId(query.org);
    if (!orgId) { set.status = 503; return { error: "ระบบยังไม่พร้อมใช้งาน" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const [booking] = await db.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.orgId, orgId)));
    if (!booking || booking.idLine !== profile.userId) { set.status = 404; return { error: "ไม่พบรายการจอง" }; }
    if (booking.status !== "active") { set.status = 400; return { error: "รายการนี้ถูกยกเลิกไปแล้ว" }; }

    const ts = new Date().toISOString();
    await db.update(bookings).set({ status: "cancelled", cancelledAt: ts }).where(eq(bookings.id, bookingId));

    if (booking.roomId) {
      const [room] = await db.select().from(rooms).where(eq(rooms.id, booking.roomId));
      if (room && room.status === "จอง") {
        await db.update(rooms).set({ status: "ว่าง" }).where(eq(rooms.id, booking.roomId));
      }
    }

    broadcastChange(orgId, "room", "update", "ยกเลิกการจองห้องเอง", booking.firstName || "");

    return { ok: true };
  });
