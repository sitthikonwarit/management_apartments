import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { db } from "./db";
import { users, organizations } from "./db/schema";
import { roomsRoute } from "./routes/rooms";
import { tenantsRoute } from "./routes/tenants";
import { metersRoute } from "./routes/meters";
import { billsRoute } from "./routes/bills";
import { vehiclesRoute } from "./routes/vehicles";
import { repairsRoute } from "./routes/repairs";
import { liveMeterRoute, liveMeterIngestRoute } from "./routes/liveMeter";
import { specialDiscountsRoute } from "./routes/specialDiscounts";
import { settingsRoute } from "./routes/settings";
import { addressRoute } from "./routes/address";
import { logsRoute } from "./routes/logs";
import { chatRoute } from "./routes/chat";
import { lineWebhookRoute } from "./routes/lineWebhook";
import { liffRoute } from "./routes/liff";
import { authPublicRoute, authProtectedRoute } from "./routes/auth";
import { lineLoginRoute } from "./routes/lineLogin";
import { superAdminAuthRoute, superAdminOrgRoute } from "./routes/superadmin";
import { authDerive } from "./lib/authDerive";
import { recordLog } from "./lib/activityLog";
import { matchActivityLabel } from "./lib/activityLabels";
import { verifyToken } from "./lib/jwt";
import { registerClient, unregisterClient, broadcastChange } from "./lib/wsHub";
import { recordRequest, recordApiCall } from "./lib/apiUsageTracker";
import { verifyUploadSignature } from "./lib/encryption";
import { getClientIp } from "./lib/requestIp";
import { readFileSync } from "fs";
import { resolve } from "path";
import { getDriveImageBuffer } from "./services/sheets";
import { runLineAutoSend } from "./services/line";

// ── จับเวลา + สถานะของทุก request ที่เข้ามาทั้งระบบ ไว้คำนวณ "ความเสถียรของ API" (อัตรา error 5xx + เวลา
// ตอบสนองเฉลี่ย) ในหน้าควบคุมแพลตฟอร์ม (ดู lib/apiUsageTracker.ts, routes/superadmin.ts) ต้องอยู่บนสุดของ
// เชนก่อน route อื่นทั้งหมด (รวม superadmin/liff/line webhook ที่ไม่ผ่านการ์ด authDerive) ถึงจะครอบคลุมทุก
// request จริงๆ — ใช้ WeakMap ผูกกับ object ของ request เอง (แทน store ของ Elysia ซึ่งเป็น global ไม่ใช่
// per-request) เพราะ request เดิมถูกส่งผ่านทุก lifecycle hook (onRequest ถึง onError) ของคำขอเดียวกันเสมอ
const requestStartTimes = new WeakMap<Request, number>();
function statusFromErrorCode(code: unknown, set: { status?: number | string }): number {
  if (typeof set.status === "number") return set.status;
  if (typeof code === "number") return code;
  if (code === "VALIDATION") return 422;
  if (code === "NOT_FOUND") return 404;
  if (code === "PARSE") return 400;
  return 500;
}

const app = new Elysia()
  .use(cors({ origin: true }))
  .use(swagger({ path: "/docs" }))
  .onRequest(({ request }) => {
    requestStartTimes.set(request, Date.now());
  })
  .onAfterHandle(({ request, set }) => {
    const start = requestStartTimes.get(request);
    if (start !== undefined) recordApiCall(typeof set.status === "number" ? set.status : 200, Date.now() - start);
  })
  .onError(({ error, code, request, set }) => {
    const start = requestStartTimes.get(request);
    if (start !== undefined) recordApiCall(statusFromErrorCode(code, set), Date.now() - start);
    console.error(`[${code}]`, error);
    return { error: String(error) };
  })
  .get("/", () => ({ status: "ok", message: "LineWeb API" }))
  .get("/drive/image/:fileId", async ({ params, set }) => {
    // ปิดชั่วคราว — ตั้ง GOOGLE_INTEGRATION_ENABLED=true ใน .env เพื่อเปิดกลับมาใช้งาน (ฝั่ง frontend
    // มี fallback เป็นรูป avatar เริ่มต้นอยู่แล้วเวลา endpoint นี้ตอบ error ใดๆ ก็ตาม)
    if (process.env.GOOGLE_INTEGRATION_ENABLED !== "true") {
      set.status = 404;
      return { error: "Google integration disabled" };
    }
    try {
      const { buffer, contentType } = await getDriveImageBuffer(params.fileId);
      return new Response(buffer, {
        headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400" },
      });
    } catch {
      set.status = 404;
      return { error: "Image not found" };
    }
  })
  // ตรวจลายเซ็น (ดู lib/encryption.ts signUploadPath/verifyUploadSignature) ก่อนเสิร์ฟไฟล์ทุกครั้ง — กัน
  // เดา/ไล่สแกน URL (orgId แบบ ORG-timestamp และชื่อไฟล์แบบ timestamp เดากันได้ทั้งคู่ ไม่มีการเช็คสิทธิ์อะไร
  // เลยแต่เดิม) ตอบ 404 เดียวกับไฟล์ไม่มีจริง (ไม่ตอบ 401/403) กันบอกใบ้ว่าไฟล์นี้ "มีอยู่จริงแค่ลายเซ็นผิด"
  .get("/uploads/*", ({ params, query, set }) => {
    const relPath = "/uploads/" + (params as any)["*"];
    if (!verifyUploadSignature(relPath, (query as any)?.sig)) {
      set.status = 404;
      return { error: "File not found" };
    }
    try {
      const uploadsDir = resolve(process.cwd(), "uploads");
      const filePath = resolve(uploadsDir, (params as any)["*"]);
      // กันสองชั้น (defense-in-depth): แม้ signUploadPath จะปฏิเสธ path ที่มี ".." ไปแล้วตั้งแต่ตอนเซ็นก็ตาม
      // (ดู lib/encryption.ts) เช็คซ้ำตรงนี้อีกทีว่า path ที่ resolve แล้วยังอยู่ใต้โฟลเดอร์ uploads/ จริง ไม่งั้น
      // ปฏิเสธไปเลย ไม่ยอมอ่านไฟล์นอกโฟลเดอร์นี้ไม่ว่ากรณีใด
      if (!filePath.startsWith(uploadsDir)) {
        set.status = 404;
        return { error: "File not found" };
      }
      const file = readFileSync(filePath);
      const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
      const mime: Record<string, string> = {
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
        gif: "image/gif", webp: "image/webp", pdf: "application/pdf",
      };
      return new Response(file, {
        headers: {
          "Content-Type": mime[ext] ?? "application/octet-stream",
          "Cache-Control": "public, max-age=86400",
        },
      });
    } catch {
      set.status = 404;
      return { error: "File not found" };
    }
  })
  // /auth/setup-status, /auth/register, /auth/login — เปิดสาธารณะ ไม่ต้องล็อกอินก่อน (ต้องเรียกได้ตอนยัง
  // ไม่มี token) ต้องเมานต์ "ก่อน" การ์ดด้านล่าง เพราะ onBeforeHandle มีผลกับ route ที่ประกาศตามหลังเท่านั้น
  .use(authPublicRoute)
  // /auth/line/authorize, /auth/line/callback — เจ้าของหอพัก (ผู้ดูแลระบบ) ล็อกอินเข้าหลังบ้านด้วย LINE Login
  // (คนละ LINE product กับ Messaging API/LIFF ที่ใช้กับผู้เช่า) ต้องเปิดสาธารณะเช่นกัน (ยังไม่มี token ตอนนี้)
  .use(lineLoginRoute)
  // /line/webhook — LINE เป็นคนยิงมาเอง ไม่มี Authorization: Bearer ของระบบเรา ต้องเปิดสาธารณะเช่นกัน
  // (ตรวจสิทธิ์ด้วย x-line-signature ของตัวเองแทน ดู verifyLineSignature ใน services/line.ts)
  .use(lineWebhookRoute)
  // /liff/* — หน้า LIFF ฝั่งผู้เช่า (Login/Payment) ผู้เช่าไม่มีบัญชีพนักงาน เปิดสาธารณะเช่นกัน (ยืนยัน
  // ตัวตนด้วย LIFF access token ของ LINE เองแทน ดู verifyLiffAccessToken ใน services/line.ts)
  .use(liffRoute)
  // /live-meter/ingest — อุปกรณ์มิเตอร์ส่งค่าเข้ามา ยืนยันตัวด้วยคีย์ x-meter-key (ไม่มี Bearer token)
  .use(liveMeterIngestRoute)
  // /auth/superadmin/authorize, /callback — เปิดสาธารณะ (ยังไม่มี token ตอนนี้เหมือน lineLoginRoute)
  // /superadmin/* — มีการ์ดของตัวเอง (superAdminDerive + onBeforeHandle ในไฟล์เดียวกัน) ไม่ได้พึ่งการ์ด
  // authDerive ของพนักงานด้านล่าง (คนละระบบสิทธิ์กันโดยสิ้นเชิง ดู routes/superadmin.ts) ต้องเมานต์ "ก่อน"
  // การ์ดพนักงานเสมอ ไม่งั้นจะโดนเช็ค authUser (บัญชีพนักงาน) ทับซ้อนโดยไม่จำเป็น
  .use(superAdminAuthRoute)
  .use(superAdminOrgRoute)
  // ── WebSocket แจ้งเตือนแบบเรียลไทม์ — auth เองในตัว (แนบ token มาทาง query string เพราะ browser
  // WebSocket API แนบ custom header ไม่ได้) แยกจากการ์ด HTTP ด้านล่างเพราะ WS ไม่ผ่าน onBeforeHandle
  // แบบเดียวกับ HTTP request ปกติ ไม่ broadcast ข้อมูลอะไร แค่บอกว่า "entityType นี้เปลี่ยนแล้วนะ ไปโหลดใหม่"
  .ws("/ws", {
    async open(ws) {
      const token = (ws.data.query as Record<string, string>)?.token;
      const payload = token ? verifyToken(token) : null;
      if (!payload || typeof payload.sub !== "string") {
        ws.close();
        return;
      }
      // เช็ค sid เหมือน authDerive — token เก่าที่ถูกแทนที่แล้ว (login จากเครื่องอื่น) ต่อ WS ใหม่ไม่ได้
      const [row] = await db.select({ currentSessionId: users.currentSessionId, orgId: users.orgId }).from(users).where(eq(users.id, payload.sub));
      if (!row || !row.orgId || (row.currentSessionId && payload.sid !== row.currentSessionId)) {
        ws.close();
        return;
      }
      // องค์กรถูกระงับ (ดู routes/superadmin.ts) — เหมือน authDerive.ts ไม่ให้ต่อ WS ใหม่ได้เลย (connection
      // เก่าที่เปิดค้างอยู่แล้วถูก revokeSessionsForOrg ปิดไปตอนระงับอยู่แล้ว จุดนี้กัน reconnect ใหม่)
      const [org] = await db.select({ status: organizations.status }).from(organizations).where(eq(organizations.id, row.orgId));
      if (org?.status === "suspended") {
        ws.close();
        return;
      }
      registerClient(ws, payload.sub, row.orgId);
    },
    close(ws) {
      unregisterClient(ws);
    },
    message() {
      // ทางเดียวจาก server -> client เท่านั้น ไม่ได้ใช้ข้อความที่ client ส่งมาตอนนี้
    },
  })
  // ── การ์ดล็อกอิน: จากจุดนี้ลงไปทุก route ต้องแนบ Authorization: Bearer <token> ที่ถูกต้อง ──────
  .use(authDerive)
  .onBeforeHandle(({ authUser, set }) => {
    if (!authUser) { set.status = 401; return { error: "กรุณาเข้าสู่ระบบ" }; }
  })
  // บัญชีที่ถูกรีเซ็ตเป็นรหัสชั่วคราว ใช้ได้แค่ดูข้อมูลตัวเอง/เปลี่ยนรหัสผ่าน/ออกจากระบบ จนกว่าจะตั้งรหัสใหม่เสร็จ
  .onBeforeHandle(({ authUser, request, set }) => {
    if (!authUser?.mustChangePassword) return;
    const p = new URL(request.url).pathname;
    if (p === "/auth/me" || p === "/auth/change-password" || p === "/auth/logout") return;
    set.status = 403;
    return { error: "กรุณาตั้งรหัสผ่านใหม่ก่อนใช้งาน", code: "MUST_CHANGE_PASSWORD" };
  })
  // ── บันทึก activity log อัตโนมัติสำหรับทุก request ที่แก้ไขข้อมูล (POST/PUT/PATCH/DELETE) ที่สำเร็จ
  // ไม่ต้องเขียนโค้ด log แยกในแต่ละ route handler — ครอบคลุมทุก route ที่เมานต์ "หลัง" จุดนี้อัตโนมัติ
  // (login/register/logout log แยกเป็นพิเศษที่จุดเกิดเหตุจริงใน auth.ts เพราะตอนนั้นยังไม่มี authUser)
  .onAfterHandle(async ({ request, authUser, set, body, response, headers, server }) => {
    // นับอัตราเรียก API ต่อองค์กร (ทุก method รวม GET) ไว้โชว์ในหน้าควบคุมแพลตฟอร์ม (ดู
    // lib/apiUsageTracker.ts, routes/superadmin.ts) — แยกจาก activity log ด้านล่างที่จำกัดแค่ POST/PUT/
    // PATCH/DELETE เพราะจุดประสงค์ต่างกัน (activity log = "ใครแก้อะไร" ไว้ให้พนักงานเห็น, ตัวนี้ = "องค์กร
    // ไหนใช้งานหนักแค่ไหน" ไว้ให้แพลตฟอร์มดูภาพรวม)
    if (authUser) recordRequest(authUser.orgId);

    const method = request.method;
    if (method !== "POST" && method !== "PUT" && method !== "PATCH" && method !== "DELETE") return;
    if (!authUser) return;
    const path = new URL(request.url).pathname;
    if (path === "/auth/login" || path === "/auth/register" || path === "/auth/logout") return;
    const statusCode = typeof set.status === "number" ? set.status : 200;
    if (statusCode >= 400) return;
    const matched = matchActivityLabel(method, path);
    await recordLog({
      orgId: authUser.orgId,
      userId: authUser.id,
      username: authUser.username,
      method, path,
      action: matched?.action ?? "unknown",
      entityType: matched?.entityType ?? "other",
      description: matched?.label ?? `${method} ${path}`,
      status: statusCode,
      requestBody: body,
      responseBody: response,
      userAgent: headers["user-agent"] ?? "",
      ip: getClientIp(headers, server, request),
    });
    // แจ้งทุกเครื่องขององค์กรเดียวกันที่เปิดหน้าเว็บอยู่ (WebSocket) ให้รู้ว่าข้อมูลประเภทนี้เปลี่ยนไปแล้ว
    // จะได้โหลดใหม่ทันที (จำกัดเฉพาะองค์กรตัวเอง กันการแจ้งเตือนข้ามองค์กร — ดู wsHub.ts)
    if (matched) broadcastChange(authUser.orgId, matched.entityType, matched.action, matched.label, authUser.username);
  })
  .use(authProtectedRoute)
  .use(addressRoute)
  .use(roomsRoute)
  .use(tenantsRoute)
  .use(metersRoute)
  .use(billsRoute)
  .use(vehiclesRoute)
  .use(repairsRoute)
  .use(liveMeterRoute)
  .use(specialDiscountsRoute)
  .use(settingsRoute)
  .use(logsRoute)
  .use(chatRoute)
  .listen({ port: 3001, hostname: "0.0.0.0", maxRequestBodySize: 50 * 1024 * 1024 });

console.log(`Backend running at http://localhost:${app.server?.port} (also reachable via your LAN IP)`);
console.log(`Swagger docs at  http://localhost:${app.server?.port}/docs`);

// ── ส่งบิลทาง LINE อัตโนมัติตาม "วันนัด" ที่ตั้งไว้ (ดู settings.ts + services/line.ts) ──
// เช็คทุก 10 นาที + เช็คทันทีตอนเซิร์ฟเวอร์เริ่ม (เผื่อ server รีสตาร์ทพอดีวันนัด)
runLineAutoSend().catch((e) => console.error("[line-auto-send]", e));
setInterval(() => { runLineAutoSend().catch((e) => console.error("[line-auto-send]", e)); }, 10 * 60 * 1000);
