import { Elysia } from "elysia";
import { db } from "../db";
import { cctvCameras } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { authDerive } from "../lib/authDerive";
import { encryptField, decryptField } from "../lib/encryption";
import { signToken, verifyToken } from "../lib/jwt";

// ── กล้องวงจรปิด ───────────────────────────────────────────────────────────────
// เบราว์เซอร์เล่น RTSP ของ DVR ตรงๆ ไม่ได้ จึงให้ตัวกลางที่หอพัก (เช่น go2rtc) แปลงเป็นสตรีม MJPEG (HTTP) แล้วเว็บนี้
// พร็อกซีต่อให้ผ่านการล็อกอินเท่านั้น — เก็บ "URL สตรีมต้นทาง" ของแต่ละกล้องไว้ (เข้ารหัสในฐานข้อมูล เพราะอาจมีรหัสผ่านฝังอยู่)
// ไม่เคยส่ง URL ต้นทางไปให้เบราว์เซอร์ เบราว์เซอร์ได้แค่ /api/cctv/stream/:id?t=<ตั๋วอายุสั้น> (ดู cctvStreamRoute)
const TICKET_SECONDS = 5 * 60;

function isHttpUrl(u: string) {
  try { const p = new URL(u); return p.protocol === "http:" || p.protocol === "https:"; } catch { return false; }
}

function parseCamera(r: typeof cctvCameras.$inferSelect) {
  return { id: r.id, name: r.name, streamUrl: decryptField(r.streamUrl), sortOrder: Number(r.sortOrder) || 0 };
}

export const cctvRoute = new Elysia({ prefix: "/cctv" })
  .use(authDerive)
  .get("/cameras", async ({ authUser }) => {
    const rows = await db.select().from(cctvCameras).where(eq(cctvCameras.orgId, authUser!.orgId));
    return rows.map(parseCamera).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th", { numeric: true }));
  })
  // ตั๋วอายุสั้นสำหรับเปิดสตรีมในแท็ก <img> (ส่ง Authorization header ไม่ได้) — ไม่ใช่โทเค็นล็อกอิน ใช้เข้า API อื่นไม่ได้
  .get("/ticket", ({ authUser }) => {
    return { ticket: signToken({ kind: "cctv", u: authUser!.id, org: authUser!.orgId }, TICKET_SECONDS), expiresIn: TICKET_SECONDS };
  })
  .post("/cameras", async ({ authUser, body, set }) => {
    const { name, streamUrl } = body as any;
    if (!String(name ?? "").trim()) { set.status = 400; return { error: "ต้องระบุชื่อกล้อง" }; }
    if (!isHttpUrl(String(streamUrl ?? "").trim())) { set.status = 400; return { error: "URL สตรีมต้องขึ้นต้นด้วย http:// หรือ https://" }; }
    const orgId = authUser!.orgId;
    const existing = await db.select().from(cctvCameras).where(eq(cctvCameras.orgId, orgId));
    const id = `CAM-${Date.now()}`;
    await db.insert(cctvCameras).values({
      id, orgId, name: String(name).trim(), streamUrl: encryptField(String(streamUrl).trim()),
      sortOrder: String(existing.length), createdAt: new Date().toISOString(),
    });
    const [row] = await db.select().from(cctvCameras).where(eq(cctvCameras.id, id));
    return parseCamera(row);
  })
  .put("/cameras/:id", async ({ authUser, params, body, set }) => {
    const { name, streamUrl } = body as any;
    const [existing] = await db.select().from(cctvCameras).where(and(eq(cctvCameras.id, params.id), eq(cctvCameras.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบกล้อง" }; }
    if (streamUrl !== undefined && !isHttpUrl(String(streamUrl).trim())) { set.status = 400; return { error: "URL สตรีมต้องขึ้นต้นด้วย http:// หรือ https://" }; }
    await db.update(cctvCameras).set({
      name: name !== undefined ? String(name).trim() || existing.name : existing.name,
      streamUrl: streamUrl !== undefined ? encryptField(String(streamUrl).trim()) : existing.streamUrl,
    }).where(eq(cctvCameras.id, params.id));
    const [row] = await db.select().from(cctvCameras).where(eq(cctvCameras.id, params.id));
    return parseCamera(row);
  })
  .delete("/cameras/:id", async ({ authUser, params, set }) => {
    const [existing] = await db.select().from(cctvCameras).where(and(eq(cctvCameras.id, params.id), eq(cctvCameras.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบกล้อง" }; }
    await db.delete(cctvCameras).where(eq(cctvCameras.id, params.id));
    return { deleted: params.id };
  });

// ── พร็อกซีสตรีม — เปิดสาธารณะ (แท็ก <img> ส่ง header ไม่ได้) แต่ต้องมีตั๋วที่ออกให้ผู้ล็อกอินแล้วและยังไม่หมดอายุเท่านั้น
// ต้องเมานต์ก่อนการ์ดล็อกอินใน index.ts (เหมือน /uploads/*) ตั๋วผูกกับองค์กร กล้องขององค์กรอื่นเปิดไม่ได้
export const cctvStreamRoute = new Elysia({ prefix: "/cctv" })
  .get("/stream/:id", async ({ params, query, set, request }) => {
    const ticket = verifyToken(String((query as any)?.t ?? ""));
    if (!ticket || ticket.kind !== "cctv" || typeof ticket.org !== "string") { set.status = 401; return { error: "ตั๋วหมดอายุ" }; }
    const [cam] = await db.select().from(cctvCameras).where(and(eq(cctvCameras.id, params.id), eq(cctvCameras.orgId, ticket.org)));
    if (!cam) { set.status = 404; return { error: "ไม่พบกล้อง" }; }
    const url = decryptField(cam.streamUrl);
    if (!isHttpUrl(url)) { set.status = 400; return { error: "URL สตรีมไม่ถูกต้อง" }; }

    const ctrl = new AbortController();
    request.signal.addEventListener("abort", () => ctrl.abort());
    let upstream: Response;
    try {
      upstream = await fetch(url, { signal: ctrl.signal });
    } catch {
      set.status = 502;
      return { error: "เชื่อมต่อกล้องไม่ได้" };
    }
    if (!upstream.ok || !upstream.body) { set.status = 502; return { error: `กล้องตอบกลับผิดปกติ (${upstream.status})` }; }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "multipart/x-mixed-replace; boundary=frame",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no", // ไม่ให้ nginx พักบัฟเฟอร์ภาพ
      },
    });
  });
