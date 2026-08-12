// ── หน้าควบคุมแพลตฟอร์ม (คุณคนเดียวเท่านั้น) — ดูรายชื่อองค์กรลูกค้าทั้งหมด, ระงับ/เปิดใช้งาน, ลบองค์กร
// คนละอย่างกับ routes/lineLogin.ts (ล็อกอินเจ้าของหอพักเข้าองค์กรของตัวเอง) โดยสิ้นเชิง — ที่นี่ไม่มีแนวคิด
// "องค์กร" ของผู้ที่ล็อกอินเลย มีแค่เช็คว่า LINE User ID ที่ล็อกอินมาตรงกับ SUPERADMIN_LINE_USER_ID ใน .env
// หรือเปล่า (ดู lib/superAdminDerive.ts) ใช้ LINE Login channel เดียวกับที่มีอยู่แล้วได้เลย (แค่ระบุตัวตนคน
// ที่ล็อกอิน ไม่ใช่ security boundary) แต่ต้องเพิ่ม Callback URL "{PUBLIC_BASE_URL}/auth/superadmin/callback"
// ไว้ใน LINE Developers Console ของ channel นั้นเองก่อน (ดูคอมเมนต์ที่ .env.example)
import { Elysia } from "elysia";
import { and, eq, sql } from "drizzle-orm";
import { rm } from "fs/promises";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { resolve } from "path";
import { randomBytes, timingSafeEqual } from "crypto";
import { db } from "../db";
import { organizations, appConfig, rooms, tenants, users, superadminRichMenuConfig } from "../db/schema";
import { ORG_SCOPED_TABLES } from "../db/orgScopedTables";
import { signToken } from "../lib/jwt";
import { superAdminDerive } from "../lib/superAdminDerive";
import { revokeSessionsForOrg, revokeSessionsForUser } from "../lib/wsHub";
import { generateSlug } from "../lib/orgContext";
import { getOrgStorageBytes, getUnattributedStorageBytes, UPLOAD_SUBDIRS } from "../lib/storageUsage";
import { getOrgRequestRate, getGlobalRequestRate, getApiHealth } from "../lib/apiUsageTracker";
import { getServerHealth, checkDatabaseHealth } from "../lib/serverHealth";
import { signUploadPath } from "../lib/encryption";
import { createGuestRichMenu, type RichMenuImageInput } from "../services/richMenu";

// id แถว singleton ของ superadmin_richmenu_config เสมอ (ดูคอมเมนต์ที่ schema.ts) — โหลด/สร้างแบบ lazy
// เหมือน getOrCreateConfig(orgId) ใน routes/settings.ts แต่ไม่มีพารามิเตอร์ orgId เพราะมีแถวเดียวทั้งระบบ
const SUPERADMIN_RICHMENU_CONFIG_ID = "default";
async function getOrCreateSuperadminRichMenuConfig() {
  const [existing] = await db.select().from(superadminRichMenuConfig).where(eq(superadminRichMenuConfig.id, SUPERADMIN_RICHMENU_CONFIG_ID));
  if (existing) return existing;
  await db.insert(superadminRichMenuConfig).values({ id: SUPERADMIN_RICHMENU_CONFIG_ID, updatedAt: new Date().toISOString() });
  const [row] = await db.select().from(superadminRichMenuConfig).where(eq(superadminRichMenuConfig.id, SUPERADMIN_RICHMENU_CONFIG_ID));
  return row;
}

// ตัดทุกอย่างที่ไม่ใช่ตัวเลขออก (เว้นวรรค/ขีด/+66 ที่ลูกค้าอาจพิมพ์ปนมา) ให้เหลือแค่ตัวเลขล้วนๆ ไว้เทียบกับ
// ที่เก็บใน users.phone — ใช้ตัวเดียวกันทั้งตอนสร้างองค์กร (ที่นี่) และตอนกรอกเบอร์เชื่อม LINE ครั้งแรก (ดู
// normalizePhone ใน routes/lineLogin.ts ก๊อปมาแบบเดียวกัน) ต้องได้ผลลัพธ์ตรงกันเป๊ะทั้งสองจุดถึงจะจับคู่กันได้
function normalizePhone(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

const LINE_AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize";
const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const LINE_PROFILE_URL = "https://api.line.me/v2/profile";

const STATE_COOKIE = "superadmin_line_login_state";
const STATE_MAX_AGE_SEC = 10 * 60;
const SUPERADMIN_TOKEN_EXPIRES_SEC = 4 * 60 * 60; // 4 ชั่วโมง — สั้นกว่าเซสชันพนักงานปกติ (30 วัน) ตั้งใจ
// เพราะเป็นหน้าที่มีสิทธิ์ทำลายข้อมูลลูกค้าทั้งองค์กรได้ ใช้งานไม่บ่อย ไม่จำเป็นต้องค้างนาน

// เทียบรหัสผ่านแบบ timing-safe (กันโจมตีจับเวลาเดารหัสผ่านทีละตัวอักษร) — แพทเทิร์นเดียวกับ
// verifyLineSignature ใน services/line.ts ต้องเช็คความยาวก่อนเสมอเพราะ timingSafeEqual โยน error ถ้า
// buffer สองฝั่งยาวไม่เท่ากัน
function passwordMatches(input: string, expected: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// กันเดารหัสผ่านมั่วๆ ซ้ำๆ (เก็บ in-memory เฉยๆ พอ ไม่ต้องมีตาราง DB แยก — แพทเทิร์นเดียวกับ
// isProfileVerifyBlocked ใน routes/liff.ts) มีรหัสผ่านเดียวทั้งระบบ (ไม่มี username) จึงนับรวมทุกคำขอ
// เป็นตัวนับเดียว รีเซ็ตเองเมื่อพ้นหน้าต่างเวลา หรือทันทีที่กรอกถูกครั้งถัดไป
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
let loginAttempts = { count: 0, windowStart: 0 };

function isLoginBlocked(): boolean {
  if (Date.now() - loginAttempts.windowStart > LOGIN_WINDOW_MS) { loginAttempts = { count: 0, windowStart: Date.now() }; return false; }
  return loginAttempts.count >= LOGIN_MAX_ATTEMPTS;
}
function recordLoginFailure(): void {
  if (Date.now() - loginAttempts.windowStart > LOGIN_WINDOW_MS) loginAttempts = { count: 1, windowStart: Date.now() };
  else loginAttempts.count += 1;
}

function frontendUrl(): string {
  return (process.env.FRONTEND_URL || process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
}

function redirectUri(): string {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  // ต้องมี /api นำหน้าเสมอ — reverse proxy (nginx จริง/vite dev proxy) พร็อกซีเฉพาะ path ที่ขึ้นต้นด้วย
  // /api ไปหา backend เท่านั้น (ตัด /api ออกก่อนส่งต่อ) ถ้าไม่มี /api ตรงนี้ พอ LINE redirect กลับมาที่ URL
  // นี้ จะไม่ถึง backend เลย ตกไปที่ SPA fallback แทน แล้วเด้งไปหน้า /login เงียบๆ โดยไม่มี error ใดๆ
  return `${base}/api/auth/superadmin/callback`;
}

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function redirectResponse(url: string, extraHeaders?: Record<string, string>): Response {
  return new Response(null, { status: 302, headers: { Location: url, ...extraHeaders } });
}

function loginErrorRedirect(reason: string): Response {
  return redirectResponse(`${frontendUrl()}/superadmin/login?error=${encodeURIComponent(reason)}`);
}

// ── เส้นทางสาธารณะ: ล็อกอินด้วย LINE เฉพาะ LINE User ID ที่ตรงกับ SUPERADMIN_LINE_USER_ID เท่านั้น ──
export const superAdminAuthRoute = new Elysia({ prefix: "/auth/superadmin" })
  // ล็อกอินด้วยรหัสผ่านเดียว (SUPERADMIN_PASSWORD ใน .env) — ทางเลือกที่เร็วกว่า LINE Login ด้านล่าง ไม่ตั้ง
  // ค่านี้ไว้ = ปิดการล็อกอินด้วยรหัสผ่านทั้งหมด (เหลือแค่ทาง LINE Login) เหมือนกับที่ SUPERADMIN_LINE_USER_ID
  // ว่าง = ปิดหน้าควบคุมทั้งหมด
  .post("/login", ({ body, set }) => {
    const password = String((body as any)?.password ?? "");
    const expected = process.env.SUPERADMIN_PASSWORD || "";
    if (!expected) { set.status = 503; return { error: "ยังไม่ได้เปิดใช้งานการล็อกอินด้วยรหัสผ่าน" }; }
    if (isLoginBlocked()) { set.status = 429; return { error: "กรอกรหัสผ่านผิดหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง" }; }
    if (!password || !passwordMatches(password, expected)) {
      recordLoginFailure();
      set.status = 401;
      return { error: "รหัสผ่านไม่ถูกต้อง" };
    }
    loginAttempts = { count: 0, windowStart: 0 };
    console.log("[superadmin][login] success — password login");
    return { token: signToken({ sub: "superadmin", superadmin: true }, SUPERADMIN_TOKEN_EXPIRES_SEC) };
  })
  .get("/authorize", () => {
    const channelId = process.env.LINE_LOGIN_CHANNEL_ID || "";
    if (!channelId || !process.env.LINE_LOGIN_CHANNEL_SECRET || !process.env.PUBLIC_BASE_URL) {
      return loginErrorRedirect("ยังไม่ได้ตั้งค่า LINE Login ฝั่งเซิร์ฟเวอร์ (LINE_LOGIN_CHANNEL_ID/SECRET/PUBLIC_BASE_URL)");
    }
    if (!process.env.SUPERADMIN_LINE_USER_ID) {
      return loginErrorRedirect("ยังไม่ได้ตั้งค่า SUPERADMIN_LINE_USER_ID ใน .env");
    }
    const state = crypto.randomUUID();
    const params = new URLSearchParams({
      response_type: "code",
      client_id: channelId,
      redirect_uri: redirectUri(),
      state,
      scope: "profile openid",
    });
    const isHttps = redirectUri().startsWith("https://");
    return redirectResponse(`${LINE_AUTHORIZE_URL}?${params.toString()}`, {
      "Set-Cookie": `${STATE_COOKIE}=${state}; Max-Age=${STATE_MAX_AGE_SEC}; Path=/; HttpOnly; SameSite=Lax${isHttps ? "; Secure" : ""}`,
    });
  })
  .get("/callback", async ({ query, headers }) => {
    const code = String((query as any)?.code ?? "");
    const state = String((query as any)?.state ?? "");
    const cookieState = readCookie(headers.cookie, STATE_COOKIE);
    const clearStateCookie = `${STATE_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;

    if (!code || !state || !cookieState || state !== cookieState) {
      return redirectResponse(`${frontendUrl()}/superadmin/login?error=${encodeURIComponent("เซสชันเข้าสู่ระบบหมดอายุ กรุณาลองใหม่")}`, { "Set-Cookie": clearStateCookie });
    }

    const channelId = process.env.LINE_LOGIN_CHANNEL_ID || "";
    const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET || "";

    try {
      const tokenRes = await fetch(LINE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri(),
          client_id: channelId,
          client_secret: channelSecret,
        }),
      });
      if (!tokenRes.ok) throw new Error(`token exchange failed (${tokenRes.status})`);
      const tokenData = await tokenRes.json();
      const accessToken = String(tokenData?.access_token ?? "");
      if (!accessToken) throw new Error("no access_token returned");

      const profileRes = await fetch(LINE_PROFILE_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!profileRes.ok) throw new Error(`profile fetch failed (${profileRes.status})`);
      const profile = await profileRes.json();
      const lineUserId = String(profile?.userId ?? "");
      if (!lineUserId) throw new Error("no userId in profile");

      if (!process.env.SUPERADMIN_LINE_USER_ID || lineUserId !== process.env.SUPERADMIN_LINE_USER_ID) {
        console.error(`[superadmin][login] rejected — lineUserId=${lineUserId} does not match SUPERADMIN_LINE_USER_ID`);
        return redirectResponse(`${frontendUrl()}/superadmin/login?error=${encodeURIComponent("บัญชี LINE นี้ไม่มีสิทธิ์เข้าหน้าควบคุมนี้")}`, { "Set-Cookie": clearStateCookie });
      }

      const token = signToken({ sub: "superadmin", superadmin: true }, SUPERADMIN_TOKEN_EXPIRES_SEC);
      console.log(`[superadmin][login] success — lineUserId=${lineUserId}`);
      return redirectResponse(`${frontendUrl()}/superadmin/callback?token=${encodeURIComponent(token)}`, { "Set-Cookie": clearStateCookie });
    } catch (e: any) {
      console.error("[superadmin][callback]", e);
      return redirectResponse(`${frontendUrl()}/superadmin/login?error=${encodeURIComponent("เข้าสู่ระบบด้วย LINE ไม่สำเร็จ กรุณาลองใหม่")}`, { "Set-Cookie": clearStateCookie });
    }
  });

async function countWhereOrg(table: any, orgId: string): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(table).where(eq(table.orgId, orgId));
  return Number(row?.count ?? 0);
}

async function getOwnerUser(orgId: string) {
  const [owner] = await db.select({ id: users.id, username: users.username, phone: users.phone, lineUserId: users.lineUserId }).from(users)
    .where(and(eq(users.orgId, orgId), eq(users.role, "owner")));
  return owner ?? null;
}

// สุ่มรหัสผ่านใหม่ตอนกด "รีเซ็ตรหัสผ่าน" ในหน้าควบคุมแพลตฟอร์ม — ตัดตัวอักษรที่อ่าน/พิมพ์สับสนง่ายออก (0/O,
// 1/l/I) เพราะรหัสนี้ต้องอ่านออกเสียง/พิมพ์บอกลูกค้าทางโทรศัพท์หรือแชทได้ ใช้ crypto.randomBytes (ไม่ใช่
// Math.random แบบ generateSlug ใน orgContext.ts) เพราะอันนี้เป็นรหัสผ่านจริงที่ต้องเดายากระดับความปลอดภัย
const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
function generateRandomPassword(length = 12): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += PASSWORD_CHARS[bytes[i] % PASSWORD_CHARS.length];
  return out;
}

// ── เส้นทางที่ต้องผ่าน superAdminDerive: จัดการองค์กรลูกค้า ──────────────────────────────────
export const superAdminOrgRoute = new Elysia({ prefix: "/superadmin" })
  .use(superAdminDerive)
  .onBeforeHandle(({ superAdmin, set }) => {
    if (!superAdmin) { set.status = 401; return { error: "ไม่มีสิทธิ์เข้าถึง" }; }
  })
  // สร้างองค์กรใหม่ด้วยมือ + บัญชีเจ้าของ "รอผูก LINE" ให้ทันที (เก็บแค่เบอร์โทรไว้จับคู่ ไม่ตั้ง username/
  // password ให้) — คนละทางกับ self-serve signup ผ่าน LINE Login (routes/lineLogin.ts) ที่ลูกค้าทำเองล้วนๆ
  // ใช้ตอนคุณอยากจองชื่อองค์กร/เตรียมบัญชีไว้ล่วงหน้าให้ลูกค้า แล้วให้ลูกค้าไปกรอกเบอร์นี้ที่หน้า Login เพื่อ
  // เชื่อมกับบัญชี LINE ของตัวเองเอง (ดู lib/orgContext.ts ที่แนบเบอร์ผ่าน state cookie, routes/lineLogin.ts
  // ที่จับคู่ตอน callback) โครงสร้าง transaction + retry ตอน slug ชนกัน ก๊อปมาจาก routes/lineLogin.ts (ความ
  // น่าจะเป็นชนกันต่ำมาก แต่กันไว้เหมือนกัน)
  .post("/organizations", async ({ body, set }) => {
    const b = body as any;
    const name = String(b.name ?? "").trim();
    const phone = normalizePhone(b.phone);
    const displayName = String(b.displayName ?? "").trim();
    if (!name) { set.status = 400; return { error: "กรุณากรอกชื่อองค์กร" }; }
    if (phone.length < 9) { set.status = 400; return { error: "กรุณากรอกเบอร์โทรของเจ้าของบัญชีให้ครบ" }; }

    const orgId = `ORG-${Date.now()}`;
    const userId = `USR-${Date.now()}`;
    const ts = new Date().toISOString();

    let finalSlug = "";
    let slugAttemptsLeft = 5;
    for (;;) {
      const slug = generateSlug();
      try {
        await db.transaction(async (tx) => {
          await tx.insert(organizations).values({ id: orgId, name, slug, status: "active", createdAt: ts, updatedAt: ts });
          await tx.insert(users).values({ id: userId, orgId, role: "owner", phone, displayName, createdAt: ts, updatedAt: ts });
        });
        finalSlug = slug;
        break;
      } catch (e: any) {
        if (e?.code === "23505" && e?.constraint_name === "organizations_slug_unique" && slugAttemptsLeft > 0) {
          slugAttemptsLeft--;
          continue;
        }
        if (e?.code === "23505" && e?.constraint_name === "users_phone_unique") {
          set.status = 400;
          return { error: "เบอร์นี้ถูกใช้กับองค์กรอื่นที่ยังไม่ได้เชื่อม LINE อยู่แล้ว" };
        }
        throw e;
      }
    }

    console.log(`[superadmin] created org=${orgId} (${name}) owner phone=${phone}`);
    return { id: orgId, name, slug: finalSlug, status: "active" as const, ownerPhone: phone };
  })
  .get("/organizations", async () => {
    const orgs = await db.select().from(organizations);
    // คำนวณพื้นที่ใช้งาน (DB + ไฟล์อัปโหลด) ต่อองค์กรทุกครั้งที่โหลดรายการ — ยอมรับได้เพราะหน้านี้เปิดดูไม่บ่อย
    // (ดูคอมเมนต์ที่ lib/storageUsage.ts) ส่วนอัตราเรียก API ด้านล่างอ่านจาก in-memory ล้วนๆ เร็วมาก ไม่ได้แตะ DB
    const withDetails = await Promise.all(orgs.map(async (org) => {
      const owner = await getOwnerUser(org.id);
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status,
        createdAt: org.createdAt,
        counts: {
          rooms: await countWhereOrg(rooms, org.id),
          tenants: await countWhereOrg(tenants, org.id),
          users: await countWhereOrg(users, org.id),
        },
        storage: await getOrgStorageBytes(org.id),
        apiUsage: getOrgRequestRate(org.id),
        owner: { username: owner?.username ?? null, phone: owner?.phone ?? null, lineLinked: !!owner?.lineUserId },
      };
    }));
    return withDetails;
  })
  // อัตราเรียก API แบบเบาๆ (ไม่แตะ DB เลย) ไว้ให้หน้าเว็บ poll รัวๆ ได้ (ทุก ~5 วิ) แยกจาก /organizations
  // ด้านบนซึ่งหนักกว่ามาก (ต้องคำนวณพื้นที่ใช้งานทุกองค์กรทุกครั้ง) — endpoint นี้ทำให้ "แบบเรียลไทม์" ใช้ได้จริง
  // โดยไม่ต้อง query ฐานข้อมูลซ้ำๆ ทุก 5 วินาที
  .get("/api-usage", async () => {
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    const perOrg: Record<string, { last1m: number; last5m: number }> = {};
    for (const org of orgs) perOrg[org.id] = getOrgRequestRate(org.id);
    return { global: getGlobalRequestRate(), perOrg };
  })
  // พื้นที่ไฟล์แนบแชท (uploads/chat/) ที่ยังแยกตามองค์กรไม่ได้ (ดูคอมเมนต์ที่ lib/storageUsage.ts) — แยก
  // endpoint ต่างหากจาก /organizations เพราะไม่ผูกกับองค์กรไหนโดยเฉพาะ ไว้โชว์แยกในหน้าเว็บอย่างโปร่งใส
  .get("/storage-summary", async () => {
    return { unattributedBytes: await getUnattributedStorageBytes() };
  })
  // สถานะความเสถียรของระบบ — เครื่องเซิร์ฟ (CPU/RAM/uptime), API (อัตรา error 5xx + เวลาตอบสนองเฉลี่ย),
  // ฐานข้อมูล (เชื่อมต่อได้ปกติไหม + เวลา ping) ไว้ให้หน้าควบคุมแพลตฟอร์ม poll เบาๆ ทุก ~5 วิ (แพทเทิร์นเดียว
  // กับ /api-usage ด้านบน) ทุกส่วนอ่านจาก in-memory ยกเว้น database ที่ยิง SELECT 1 จริงเพื่อวัด latency
  .get("/system-health", async () => {
    return { server: getServerHealth(), api: getApiHealth(), database: await checkDatabaseHealth() };
  })
  // รีเซ็ตรหัสผ่านบัญชีเจ้าของ (role="owner") ขององค์กร — ใช้ตอนลูกค้าลืมรหัสผ่านและติดต่อมาขอความช่วยเหลือ
  // สุ่มรหัสผ่านใหม่ให้เลย คืนค่า plaintext ครั้งเดียวตอนนี้เท่านั้น (เหมือนตอนสร้างองค์กรใหม่) ไม่มีที่เก็บ/
  // ดูย้อนหลังได้อีก เจ้าของที่สมัครผ่าน LINE Login ล้วนๆ อาจยังไม่เคยตั้ง username ไว้เลย (ดูคอมเมนต์ที่
  // users.username ใน db/schema.ts) — กรณีนั้นตั้ง username ให้อัตโนมัติจาก slug องค์กรไปด้วยเลย ไม่งั้นรีเซ็ต
  // รหัสผ่านไปก็ล็อกอินด้วย username/password ไม่ได้อยู่ดี (ไม่มีชื่อผู้ใช้ให้กรอก) เตะเซสชันที่ล็อกอินค้างอยู่
  // ของเจ้าของคนนี้คนเดียว (revokeSessionsForUser ไม่ใช่ revokeSessionsForOrg — ไม่ควรกระทบพนักงานคนอื่นในองค์กร)
  .post("/organizations/:id/reset-password", async ({ params, set }) => {
    const [org] = await db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug }).from(organizations).where(eq(organizations.id, params.id));
    if (!org) { set.status = 404; return { error: "ไม่พบองค์กร" }; }

    const owner = await getOwnerUser(params.id);
    if (!owner) { set.status = 404; return { error: "ไม่พบบัญชีเจ้าของขององค์กรนี้" }; }

    const newPassword = generateRandomPassword();
    const passwordHash = await Bun.password.hash(newPassword);
    const username = owner.username || org.slug || `owner-${org.id}`;
    await db.update(users).set({ username, passwordHash, updatedAt: new Date().toISOString() }).where(eq(users.id, owner.id));
    revokeSessionsForUser(owner.id);

    console.log(`[superadmin] reset password for org=${params.id} (${org.name}) owner=${owner.id}`);
    return { username, password: newPassword };
  })
  .patch("/organizations/:id/status", async ({ params, body, set }) => {
    const status = String((body as any)?.status ?? "");
    if (status !== "active" && status !== "suspended") {
      set.status = 400;
      return { error: "status ต้องเป็น active หรือ suspended เท่านั้น" };
    }
    const [org] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, params.id));
    if (!org) { set.status = 404; return { error: "ไม่พบองค์กร" }; }

    await db.update(organizations).set({ status, updatedAt: new Date().toISOString() }).where(eq(organizations.id, params.id));
    if (status === "suspended") revokeSessionsForOrg(params.id);
    console.log(`[superadmin] org=${params.id} (${org.name}) status -> ${status}`);
    return { id: params.id, status };
  })
  .delete("/organizations/:id", async ({ params, body, set }) => {
    const confirmName = String((body as any)?.confirmName ?? "");
    const [org] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, params.id));
    if (!org) { set.status = 404; return { error: "ไม่พบองค์กร" }; }
    if (confirmName !== org.name) {
      set.status = 400;
      return { error: "ชื่อองค์กรที่กรอกไม่ตรงกัน กรุณาพิมพ์ให้ตรงเป๊ะเพื่อยืนยันการลบ" };
    }

    await db.transaction(async (tx) => {
      for (const { table } of ORG_SCOPED_TABLES) {
        await tx.delete(table).where(eq(table.orgId, params.id));
      }
      await tx.delete(appConfig).where(eq(appConfig.id, params.id));
      await tx.delete(organizations).where(eq(organizations.id, params.id));
    });

    revokeSessionsForOrg(params.id);

    for (const sub of UPLOAD_SUBDIRS) {
      try {
        await rm(resolve(process.cwd(), "uploads", sub, params.id), { recursive: true, force: true });
      } catch {
        // เพิกเฉย — ทำความสะอาดไฟล์ดิสก์แบบ best-effort เท่านั้น ไม่ควรทำให้การลบองค์กรล้มเหลว
      }
    }

    console.error(`[superadmin] DELETED org=${params.id} (${org.name}) — all data removed`);
    return { deleted: params.id };
  })
  // ── เครื่องมือสร้าง Rich Menu ให้ LINE OA "อิสระ" ใดๆ ก็ได้ ไม่ผูกกับองค์กรในระบบเลย (ต่างจาก
  // POST /richmenu/create ใน routes/settings.ts ที่อ่าน token/URL/รูปจาก app_config ขององค์กรที่ล็อกอินอยู่
  // เสมอ และยังสร้างครบ 3 เมนู Guest/Member/Admin) ใช้ตอนอยากทำ Rich Menu ให้ LINE OA อื่น เช่น บัญชีทดลอง/
  // ของทีมงานเอง ที่ไม่ได้อยู่ในระบบหลายองค์กรนี้ Channel Access Token มาจาก SUPERADMIN_RICHMENU_LINE_TOKEN
  // ใน .env เท่านั้น (ไม่รับจาก request body — กันไม่ให้ token หลุดผ่าน log/network tab ของฝั่งเว็บ) ส่วนค่า
  // อื่น (URL/รูป/ID เมนูล่าสุด) บันทึกไว้ใน superadmin_richmenu_config เหมือนหน้า Settings ปกติขององค์กร (ดู
  // comment ที่ schema.ts) — โหลดหน้าใหม่แล้วยังเห็นค่าที่กรอกไว้ล่าสุดอยู่ ไม่ต้องกรอกซ้ำทุกครั้ง

  // โหลดค่าที่บันทึกไว้ล่าสุด — แพทเทิร์นเดียวกับ GET /settings/config ขององค์กร ต่างกันตรงนี้เป็น singleton
  // แถวเดียว ไม่มี orgId
  .get("/richmenu/config", async () => {
    const row = await getOrCreateSuperadminRichMenuConfig();
    return {
      liffLoginUrl: row.liffLoginUrl || "",
      contactUrl: row.contactUrl || "",
      image: signUploadPath(row.image || ""),
      richMenuGuestId: row.richMenuGuestId || "",
    };
  })
  // อัปโหลดรูปเมนู Guest เก็บไฟล์จริงลงดิสก์ทันที (แพทเทิร์นเดียวกับ POST /settings/richmenu/image ขององค์กร)
  // ไม่รอปุ่ม "สร้าง" เพราะไฟล์ต้องมีอยู่จริงตอนกดสร้าง — แยกโฟลเดอร์ "_superadmin" ต่างหาก ไม่ปนกับโฟลเดอร์
  // ตาม orgId ขององค์กรในระบบ (เครื่องมือนี้ไม่มี orgId)
  .post("/richmenu/image", async ({ body, set }) => {
    const base64 = String((body as any)?.base64 ?? "");
    if (!base64) { set.status = 400; return { error: "ไม่พบไฟล์รูป" }; }

    const mimeType = base64.match(/data:([^;]+);/)?.[1] ?? "image/png";
    const ext = (mimeType.split("/")[1] || "png").replace("jpeg", "jpg");
    const uploadDir = resolve(process.cwd(), "uploads", "richmenu", "_superadmin");
    mkdirSync(uploadDir, { recursive: true });
    const raw = base64.includes(",") ? base64.split(",")[1] : base64;
    const buffer = Buffer.from(raw, "base64");
    const fileName = `guest_${Date.now()}.${ext}`;
    writeFileSync(resolve(uploadDir, fileName), buffer);
    const url = `/uploads/richmenu/_superadmin/${fileName}`;

    await getOrCreateSuperadminRichMenuConfig();
    await db.update(superadminRichMenuConfig).set({ image: url, updatedAt: new Date().toISOString() }).where(eq(superadminRichMenuConfig.id, SUPERADMIN_RICHMENU_CONFIG_ID));

    return { url: signUploadPath(url) };
  })
  // สร้างเมนู Guest เดี่ยว (1 ปุ่มใหญ่บน + 3 ปุ่มล่าง) จริงผ่าน LINE API โดยอ่านรูปที่อัปโหลดไว้แล้วจากดิสก์
  // (ผ่าน POST /richmenu/image ด้านบน) — บันทึก LIFF Login URL/Contact URL ที่กรอกไว้ลง config ทันทีก่อนเรียก
  // LINE API เสมอ (กันข้อมูลหายถ้า LINE API ล่มระหว่างสร้าง) และบันทึก Guest ID ที่สร้างได้กลับไว้ใช้เป็นค่า
  // เริ่มต้นของ "ID เมนูเดิมที่จะแทนที่" ในการสร้างครั้งถัดไปอัตโนมัติ
  .post("/richmenu/create", async ({ body, set }) => {
    const token = process.env.SUPERADMIN_RICHMENU_LINE_TOKEN || "";
    if (!token) { set.status = 503; return { error: "ยังไม่ได้ตั้งค่า SUPERADMIN_RICHMENU_LINE_TOKEN ใน .env" }; }

    const b = body as any;
    const liffLoginUrl = String(b.liffLoginUrl ?? "").trim();
    if (!liffLoginUrl) {
      set.status = 400;
      return { error: "กรุณากรอก LIFF Login URL" };
    }

    // ต้องเช็ค scheme ให้ผ่านก่อนเรียก createGuestRichMenu เสมอ (แม้ LINE จะปฏิเสธ uri ที่ผิดรูปแบบตอนสร้าง
    // เมนูใหม่อยู่แล้วก็ตาม) เพราะ createGuestRichMenu ลบเมนูเก่าทิ้งไปก่อนสร้างเมนูใหม่เสมอ (best-effort, ไม่
    // rollback ได้) ถ้าปล่อยให้ค่าที่ผิดรูปแบบหลุดไปถึงขั้นตอนนั้น แล้ว LINE ปฏิเสธการสร้างเมนูใหม่ จะเหลือ
    // สถานะ "ไม่มีเมนู default เลย" ค้างไว้ (เมนูเก่าถูกลบไปแล้ว เมนูใหม่ก็สร้างไม่สำเร็จ)
    const isHttpUrl = (v: string) => /^https?:\/\//i.test(v);
    if (!isHttpUrl(liffLoginUrl)) {
      set.status = 400;
      return { error: "LIFF Login URL ต้องขึ้นต้นด้วย http:// หรือ https://" };
    }
    const contactUrl = String(b.contactUrl ?? "").trim();
    if (contactUrl && !isHttpUrl(contactUrl)) {
      set.status = 400;
      return { error: "Contact URL ต้องขึ้นต้นด้วย http:// หรือ https:// (หรือเว้นว่างไว้ให้เป็นปุ่มข้อความแทน)" };
    }

    const config = await getOrCreateSuperadminRichMenuConfig();
    await db.update(superadminRichMenuConfig).set({ liffLoginUrl, contactUrl, updatedAt: new Date().toISOString() }).where(eq(superadminRichMenuConfig.id, SUPERADMIN_RICHMENU_CONFIG_ID));

    const imagePath = config.image || "";
    if (!imagePath) { set.status = 400; return { error: "กรุณาอัปโหลดรูปเมนู Guest ก่อน" }; }

    let image: RichMenuImageInput;
    try {
      const filePath = resolve(process.cwd(), imagePath.replace(/^\//, ""));
      const buffer = readFileSync(filePath);
      const ext = imagePath.split(".").pop()?.toLowerCase();
      const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
      image = { buffer, mimeType };
    } catch {
      set.status = 400;
      return { error: "ไม่พบไฟล์รูปเมนูบนเซิร์ฟเวอร์ กรุณาอัปโหลดรูปใหม่อีกครั้ง" };
    }

    const previousGuestId = String(b.previousGuestId ?? "").trim() || config.richMenuGuestId || undefined;

    try {
      const result = await createGuestRichMenu(token, {
        liffLoginUrl,
        contactUrl,
      }, image, previousGuestId);

      await db.update(superadminRichMenuConfig).set({ richMenuGuestId: result.id, updatedAt: new Date().toISOString() }).where(eq(superadminRichMenuConfig.id, SUPERADMIN_RICHMENU_CONFIG_ID));

      console.log(`[superadmin] created ad-hoc guest rich menu — guest=${result.id}`);
      return { menuId: result.id, defaultSet: result.defaultSet, warning: result.defaultSet ? undefined : result.defaultError };
    } catch (e: any) {
      set.status = 500;
      return { error: e?.message ?? "สร้าง Rich Menu ไม่สำเร็จ" };
    }
  });
