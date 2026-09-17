// ── LINE Login (เจ้าของหอพักล็อกอินเข้าหลังบ้าน) ──────────────────────────────────
// คนละ LINE product กับ LIFF/Messaging API ที่ใช้กับผู้เช่า (services/line.ts, routes/liff.ts,
// routes/lineWebhook.ts) — อันนั้นผูกกับ "LINE Official Account ของแต่ละองค์กรเอง" ส่วนอันนี้คือ
// "LINE Login channel ของผู้ให้บริการระบบ" (เราเอง) ช่องทางเดียวใช้ร่วมกันทุกองค์กร สำหรับยืนยันตัวตนคนที่
// จะเข้ามาใช้งานระบบหลังบ้านเท่านั้น — ไม่มี self-serve signup อีกต่อไป (เคยมี แต่ปิดไปแล้ว) องค์กรใหม่ต้อง
// ให้ superadmin สร้างไว้ล่วงหน้าด้วยเบอร์โทรเท่านั้น (ดู routes/superadmin.ts) เจ้าของเอาเบอร์นั้นมากรอกใน
// ขั้นตอน "ล็อกอินครั้งแรก" ที่หน้า Login (ดู .post("/first-time/check-phone")/.post("/first-time/set-credentials")
// ด้านล่าง) ตั้ง username/password ของตัวเอง แล้วค่อยกดเชื่อม LINE (.get("/authorize") ที่มี ?phone= แนบมา)
// เพื่อผูก lineUserId เข้ากับบัญชีที่เตรียมไว้ ล็อกอินครั้งต่อๆ ไปแค่พาเข้าระบบเดิมด้วย lineUserId ที่ผูกแล้ว
import { Elysia } from "elysia";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { organizations, users } from "../db/schema";
import { signToken } from "../lib/jwt";
import { recordLog } from "../lib/activityLog";
import { revokeSessionsForUser } from "../lib/wsHub";

// เหมือน normalizePhone ใน routes/superadmin.ts (ก๊อปมาแบบเดียวกับ helper เล็กๆ อื่นในไฟล์นี้ — ต้องได้
// ผลลัพธ์ตรงกันเป๊ะกับตอนซุปเปอร์แอดมินกรอกเบอร์ไว้ตอนสร้างองค์กร ถึงจะจับคู่กันได้ตอนเชื่อม LINE ครั้งแรก)
function normalizePhone(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

const LINE_AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize";
const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const LINE_PROFILE_URL = "https://api.line.me/v2/profile";

const STATE_COOKIE = "line_login_state";
const STATE_MAX_AGE_SEC = 10 * 60; // 10 นาที — พอสำหรับเวลาที่ผู้ใช้จะกดยืนยันบนหน้า LINE

function frontendUrl(): string {
  return (process.env.FRONTEND_URL || process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
}

function redirectUri(): string {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  // ต้องมี /api นำหน้าเสมอ — reverse proxy (nginx จริง/vite dev proxy) พร็อกซีเฉพาะ path ที่ขึ้นต้นด้วย
  // /api ไปหา backend เท่านั้น (ตัด /api ออกก่อนส่งต่อ) ถ้าไม่มี /api ตรงนี้ พอ LINE redirect กลับมาที่ URL
  // นี้ จะไม่ถึง backend เลย ตกไปที่ SPA fallback แทน แล้วเด้งไปหน้า /login เงียบๆ โดยไม่มี error ใดๆ
  return `${base}/api/auth/line/callback`;
}

// อ่านค่าคุกกี้ตัวเดียวแบบดิบๆ จาก header "cookie" — ไม่พึ่งปลั๊กอินคุกกี้ของ Elysia (ไม่ได้ติดตั้งไว้ในโปรเจกต์
// นี้) ให้สไตล์เดียวกับ jwt.ts ที่ทำ JWT เองล้วนๆ ไม่พึ่งไลบรารีเพิ่ม
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
  return redirectResponse(`${frontendUrl()}/login?lineLoginError=${encodeURIComponent(reason)}`);
}

export const lineLoginRoute = new Elysia({ prefix: "/auth/line" })
  // ── ขั้นตอน "ล็อกอินครั้งแรก" ของเจ้าของที่ superadmin สร้างองค์กรไว้ล่วงหน้าด้วยเบอร์โทร (ดู
  // routes/superadmin.ts) — ก่อนจะเชื่อม LINE ต้องยืนยันเบอร์ก่อน (ดู .post("/first-time/check-phone")
  // ด้านล่าง) แล้วตั้ง username/password ของตัวเอง (.post("/first-time/set-credentials")) จากนั้นค่อยกดปุ่ม
  // เชื่อม LINE ต่อ (ไปที่ .get("/authorize") ด้านล่างเหมือนเดิม) — แยก 2 ขั้นตอนออกจาก authorize/callback
  // เพราะไม่เกี่ยวกับ LINE OAuth เลย เป็นแค่การเตรียมบัญชีให้พร้อมก่อนเท่านั้น
  .post("/first-time/check-phone", async ({ body, set }) => {
    const phone = normalizePhone((body as any)?.phone);
    if (phone.length < 9) { set.status = 400; return { error: "กรุณากรอกเบอร์โทรให้ครบ" }; }
    const [pending] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.phone, phone), isNull(users.lineUserId)));
    if (!pending) { set.status = 404; return { error: "ไม่พบเบอร์นี้ในระบบ หรือถูกเชื่อมบัญชีไปแล้ว กรุณาติดต่อผู้ดูแลระบบ" }; }
    return { ok: true };
  })
  // ตั้งชื่อผู้ใช้/รหัสผ่านของตัวเอง (เดิม superadmin สร้างองค์กรไว้ด้วยเบอร์โทรอย่างเดียว ไม่ได้ตั้ง
  // username/password ให้) — username ต้องไม่ซ้ำกับคนอื่น "ในองค์กรเดียวกัน" เท่านั้น (เหมือนกับ
  // POST /auth/users ที่พนักงานสร้างบัญชีเพิ่มกันในหน้า Settings ดู routes/auth.ts) เรียกซ้ำได้ถ้ายังไม่ได้
  // เชื่อม LINE (เผื่อพิมพ์ผิด/เปลี่ยนใจก่อนกดเชื่อม LINE จริง)
  .post("/first-time/set-credentials", async ({ body, set }) => {
    const b = body as any;
    const phone = normalizePhone(b?.phone);
    const username = String(b?.username ?? "").trim();
    const password = String(b?.password ?? "");
    const confirmPassword = String(b?.confirmPassword ?? "");

    if (phone.length < 9) { set.status = 400; return { error: "กรุณากรอกเบอร์โทรให้ครบ" }; }
    if (!username) { set.status = 400; return { error: "กรุณากรอกชื่อผู้ใช้" }; }
    if (!password || password.length < 6) { set.status = 400; return { error: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" }; }
    if (password !== confirmPassword) { set.status = 400; return { error: "รหัสผ่านทั้งสองช่องไม่ตรงกัน" }; }

    const [pending] = await db.select().from(users).where(and(eq(users.phone, phone), isNull(users.lineUserId)));
    if (!pending) { set.status = 404; return { error: "ไม่พบเบอร์นี้ในระบบ หรือถูกเชื่อมบัญชีไปแล้ว กรุณาติดต่อผู้ดูแลระบบ" }; }

    const [dup] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.username, username), eq(users.orgId, pending.orgId)));
    if (dup && dup.id !== pending.id) { set.status = 409; return { error: "มีชื่อผู้ใช้นี้แล้ว กรุณาเลือกชื่ออื่น" }; }

    const passwordHash = await Bun.password.hash(password);
    const ts = new Date().toISOString();
    await db.update(users).set({ username, passwordHash, updatedAt: ts }).where(eq(users.id, pending.id));
    return { ok: true };
  })
  // ?phone= มาจากหน้า Login โหมด "ล็อกอินครั้งแรก" (เจ้าของที่ superadmin สร้างองค์กรไว้ล่วงหน้าด้วยเบอร์โทร
  // แทน username/password — ดู routes/superadmin.ts) เช็คตั้งแต่ตรงนี้เลยว่าเบอร์นี้มีบัญชีที่ "รอผูก LINE"
  // จริงไหม (ยังไม่เคยมี lineUserId) กันเสียเวลาไป-กลับ LINE OAuth ทั้งรอบแล้วมาพบว่าเบอร์ผิด/ผูกไปแล้ว —
  // เก็บเบอร์ไว้ในคุกกี้ state เดียวกันแบบ "state:phone" (ไม่ส่งเบอร์ไปให้ LINE เห็นเด็ดขาด แค่ฝั่งเราจำไว้เอง)
  // เพื่อให้ /callback อ่านออกมาผูกบัญชีถูกได้โดยไม่ต้องเพิ่ม cookie อีกใบ
  .get("/authorize", async ({ query }) => {
    const channelId = process.env.LINE_LOGIN_CHANNEL_ID || "";
    if (!channelId || !process.env.LINE_LOGIN_CHANNEL_SECRET || !process.env.PUBLIC_BASE_URL) {
      return loginErrorRedirect("ยังไม่ได้ตั้งค่า LINE Login ฝั่งเซิร์ฟเวอร์ (LINE_LOGIN_CHANNEL_ID/SECRET/PUBLIC_BASE_URL)");
    }

    const rawPhone = String((query as any)?.phone ?? "");
    let claimPhone = "";
    if (rawPhone) {
      claimPhone = normalizePhone(rawPhone);
      const [pending] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.phone, claimPhone), isNull(users.lineUserId)));
      if (!pending) {
        return loginErrorRedirect("ไม่พบเบอร์นี้ในระบบ หรือถูกเชื่อมบัญชี LINE ไปแล้ว");
      }
    }

    const state = crypto.randomUUID();
    const cookieValue = claimPhone ? `${state}:${claimPhone}` : state;
    const params = new URLSearchParams({
      response_type: "code",
      client_id: channelId,
      redirect_uri: redirectUri(),
      state,
      scope: "profile openid",
    });
    const isHttps = redirectUri().startsWith("https://");
    return redirectResponse(`${LINE_AUTHORIZE_URL}?${params.toString()}`, {
      "Set-Cookie": `${STATE_COOKIE}=${cookieValue}; Max-Age=${STATE_MAX_AGE_SEC}; Path=/; HttpOnly; SameSite=Lax${isHttps ? "; Secure" : ""}`,
    });
  })
  .get("/callback", async ({ query, headers, server, request }) => {
    const code = String((query as any)?.code ?? "");
    const state = String((query as any)?.state ?? "");
    // คุกกี้ state เก็บเป็น "state" เฉยๆ ตามปกติ หรือ "state:phone" ถ้ามาจากโหมด "ล็อกอินครั้งแรก" (ผูกเบอร์
    // ที่ superadmin กรอกไว้ล่วงหน้า — ดู .get("/authorize") ด้านบน) แยกสองส่วนออกจากกันก่อนเทียบ state
    const rawCookie = readCookie(headers.cookie, STATE_COOKIE);
    const sepIdx = rawCookie ? rawCookie.indexOf(":") : -1;
    const cookieState = rawCookie ? (sepIdx === -1 ? rawCookie : rawCookie.slice(0, sepIdx)) : null;
    const claimPhone = rawCookie && sepIdx !== -1 ? rawCookie.slice(sepIdx + 1) : "";
    // ล้างคุกกี้ state ทิ้งทันทีไม่ว่าผลจะเป็นอย่างไร (ใช้ครั้งเดียว)
    const clearStateCookie = `${STATE_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;

    if (!code || !state || !cookieState || state !== cookieState) {
      return redirectResponse(`${frontendUrl()}/login?lineLoginError=${encodeURIComponent("เซสชันเข้าสู่ระบบหมดอายุ กรุณาลองใหม่")}`, { "Set-Cookie": clearStateCookie });
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
      const displayName = String(profile?.displayName ?? "");
      if (!lineUserId) throw new Error("no userId in profile");

      const ts = new Date().toISOString();
      const sessionId = crypto.randomUUID();

      let user = (await db.select().from(users).where(eq(users.lineUserId, lineUserId)))[0];
      let isClaim = false;

      if (!user && claimPhone) {
        // มาจากโหมด "ล็อกอินครั้งแรก" กรอกเบอร์ — ผูกบัญชี LINE นี้เข้ากับบัญชีเจ้าของที่ superadmin สร้างไว้
        // ล่วงหน้าด้วยเบอร์นี้ (ดู routes/superadmin.ts) แทนที่จะสร้างองค์กรใหม่ซ้อน เช็คซ้ำอีกครั้งตอนนี้ (ไม่ใช่
        // แค่ตอน /authorize) เผื่อมีคนอื่นผูกเบอร์นี้ไปแล้วในช่วงที่กำลังคุยกับ LINE OAuth อยู่พอดี
        const [pending] = await db.select().from(users).where(and(eq(users.phone, claimPhone), isNull(users.lineUserId)));
        if (!pending) {
          return redirectResponse(`${frontendUrl()}/login?lineLoginError=${encodeURIComponent("เบอร์นี้ถูกเชื่อมบัญชี LINE ไปแล้ว หรือไม่พบในระบบ")}`, { "Set-Cookie": clearStateCookie });
        }
        await db.update(users).set({
          lineUserId, displayName: displayName || pending.displayName, lastLoginAt: ts, currentSessionId: sessionId, updatedAt: ts,
        }).where(eq(users.id, pending.id));
        user = (await db.select().from(users).where(eq(users.id, pending.id)))[0];
        isClaim = true;
      } else if (!user) {
        // ล็อกอินครั้งแรกของบัญชี LINE นี้ โดยไม่มีเบอร์มาผูก (ไม่ได้มาจากขั้นตอน "ล็อกอินครั้งแรก" ในหน้า
        // Login) — เดิมสร้างองค์กรใหม่ + บัญชีเจ้าของให้อัตโนมัติตรงนี้เลย (self-serve signup) แต่ปิดไปแล้ว
        // เพราะต้องการให้ superadmin เป็นคนสร้างองค์กร+เบอร์โทรไว้ล่วงหน้าเท่านั้น (ดู routes/superadmin.ts)
        // ป้องกันใครก็ได้เข้ามาสร้างองค์กรของตัวเองได้เองโดยไม่ผ่านการอนุมัติ — เด้งกลับไปให้ใช้ขั้นตอนกรอกเบอร์แทน
        return redirectResponse(`${frontendUrl()}/login?lineLoginError=${encodeURIComponent("ยังไม่มีบัญชีนี้ในระบบ กรุณาใช้เบอร์โทรที่ผู้ดูแลระบบสร้างให้ ผ่านขั้นตอน \"ล็อกอินครั้งแรก\" ด้านล่างแทน")}`, { "Set-Cookie": clearStateCookie });
      } else {
        await db.update(users).set({ lastLoginAt: ts, currentSessionId: sessionId, displayName: displayName || user.displayName })
          .where(eq(users.id, user.id));
      }

      if (!user.orgId) throw new Error("user has no orgId after provisioning");

      // องค์กรถูกระงับโดยหน้าควบคุมแพลตฟอร์ม (ดู routes/superadmin.ts) — ห้ามออก token ใหม่ ครอบคลุมทั้งกรณี
      // องค์กรเดิมถูกระงับไปแล้วมาล็อกอินซ้ำ และกรณีเพิ่งผูกบัญชี LINE เข้ากับองค์กรที่เตรียมไว้เสร็จหมาดๆ
      const [org] = await db.select({ status: organizations.status }).from(organizations).where(eq(organizations.id, user.orgId));
      if (org?.status === "suspended") {
        return redirectResponse(`${frontendUrl()}/login?lineLoginError=${encodeURIComponent("องค์กรนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ")}`, { "Set-Cookie": clearStateCookie });
      }

      const token = signToken({ sub: user.id, username: user.username ?? "", org: user.orgId, sid: sessionId });
      await recordLog({
        orgId: user.orgId, userId: user.id, username: user.username || displayName, method: "GET", path: "/auth/line/callback",
        action: "login", entityType: "auth",
        description: isClaim ? "เชื่อมบัญชี LINE เข้ากับองค์กรที่เตรียมไว้ด้วยเบอร์โทร" : "เข้าสู่ระบบด้วย LINE Login",
        status: 200, userAgent: headers["user-agent"] ?? "", ip: server?.requestIP(request)?.address ?? "",
      });
      revokeSessionsForUser(user.id);

      return redirectResponse(`${frontendUrl()}/line-login-callback?token=${encodeURIComponent(token)}`, { "Set-Cookie": clearStateCookie });
    } catch (e: any) {
      console.error("[line-login][callback]", e);
      return redirectResponse(`${frontendUrl()}/login?lineLoginError=${encodeURIComponent("เข้าสู่ระบบด้วย LINE ไม่สำเร็จ กรุณาลองใหม่")}`, { "Set-Cookie": clearStateCookie });
    }
  });
