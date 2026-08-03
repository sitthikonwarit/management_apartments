import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { db } from "./db";
import { users } from "./db/schema";
import { roomsRoute } from "./routes/rooms";
import { tenantsRoute } from "./routes/tenants";
import { metersRoute } from "./routes/meters";
import { billsRoute } from "./routes/bills";
import { vehiclesRoute } from "./routes/vehicles";
import { settingsRoute } from "./routes/settings";
import { addressRoute } from "./routes/address";
import { logsRoute } from "./routes/logs";
import { chatRoute } from "./routes/chat";
import { lineWebhookRoute } from "./routes/lineWebhook";
import { liffRoute } from "./routes/liff";
import { authPublicRoute, authProtectedRoute } from "./routes/auth";
import { authDerive } from "./lib/authDerive";
import { recordLog } from "./lib/activityLog";
import { matchActivityLabel } from "./lib/activityLabels";
import { verifyToken } from "./lib/jwt";
import { registerClient, unregisterClient, broadcastChange } from "./lib/wsHub";
import { readFileSync } from "fs";
import { resolve } from "path";
import { getDriveImageBuffer } from "./services/sheets";
import { runLineAutoSend } from "./services/line";

const app = new Elysia()
  .use(cors({ origin: true }))
  .use(swagger({ path: "/docs" }))
  .onError(({ error, code }) => {
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
  .get("/uploads/*", ({ params, set }) => {
    try {
      const filePath = resolve(process.cwd(), "uploads", (params as any)["*"]);
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
  // /line/webhook — LINE เป็นคนยิงมาเอง ไม่มี Authorization: Bearer ของระบบเรา ต้องเปิดสาธารณะเช่นกัน
  // (ตรวจสิทธิ์ด้วย x-line-signature ของตัวเองแทน ดู verifyLineSignature ใน services/line.ts)
  .use(lineWebhookRoute)
  // /liff/* — หน้า LIFF ฝั่งผู้เช่า (Login/Payment) ผู้เช่าไม่มีบัญชีพนักงาน เปิดสาธารณะเช่นกัน (ยืนยัน
  // ตัวตนด้วย LIFF access token ของ LINE เองแทน ดู verifyLiffAccessToken ใน services/line.ts)
  .use(liffRoute)
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
      const [row] = await db.select({ currentSessionId: users.currentSessionId }).from(users).where(eq(users.id, payload.sub));
      if (!row || (row.currentSessionId && payload.sid !== row.currentSessionId)) {
        ws.close();
        return;
      }
      registerClient(ws, payload.sub);
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
  // ── บันทึก activity log อัตโนมัติสำหรับทุก request ที่แก้ไขข้อมูล (POST/PUT/PATCH/DELETE) ที่สำเร็จ
  // ไม่ต้องเขียนโค้ด log แยกในแต่ละ route handler — ครอบคลุมทุก route ที่เมานต์ "หลัง" จุดนี้อัตโนมัติ
  // (login/register/logout log แยกเป็นพิเศษที่จุดเกิดเหตุจริงใน auth.ts เพราะตอนนั้นยังไม่มี authUser)
  .onAfterHandle(async ({ request, authUser, set, body, response, headers, server }) => {
    const method = request.method;
    if (method !== "POST" && method !== "PUT" && method !== "PATCH" && method !== "DELETE") return;
    if (!authUser) return;
    const path = new URL(request.url).pathname;
    if (path === "/auth/login" || path === "/auth/register" || path === "/auth/logout") return;
    const statusCode = typeof set.status === "number" ? set.status : 200;
    if (statusCode >= 400) return;
    const matched = matchActivityLabel(method, path);
    await recordLog({
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
      ip: server?.requestIP(request)?.address ?? "",
    });
    // แจ้งทุกเครื่องที่เปิดหน้าเว็บอยู่ (WebSocket) ให้รู้ว่าข้อมูลประเภทนี้เปลี่ยนไปแล้ว จะได้โหลดใหม่ทันที
    if (matched) broadcastChange(matched.entityType, matched.action, matched.label, authUser.username);
  })
  .use(authProtectedRoute)
  .use(addressRoute)
  .use(roomsRoute)
  .use(tenantsRoute)
  .use(metersRoute)
  .use(billsRoute)
  .use(vehiclesRoute)
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
