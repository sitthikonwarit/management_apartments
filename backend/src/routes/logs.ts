import { Elysia } from "elysia";
import { desc } from "drizzle-orm";
import { db } from "../db";
import { activityLogs } from "../db/schema";

function safeParse(v: string | null, fallback: any = null) {
  try { return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}

function parseLog(r: typeof activityLogs.$inferSelect) {
  return {
    id: r.id,
    timestamp: r.timestamp,
    userId: r.userId,
    username: r.username,
    method: r.method,
    path: r.path,
    action: r.action,
    entityType: r.entityType,
    description: r.description,
    status: Number(r.status) || 0,
    // รายละเอียดเต็ม — ผ่านการปิดบังรหัสผ่าน/ตัดข้อมูลยาวๆ ไว้แล้วตอนบันทึก (ดู sanitizeForLog ใน
    // activityLog.ts) ส่งมาพร้อมกับรายการเลย ไม่ต้องมี endpoint แยกดึงรายละเอียดทีหลัง
    requestBody: safeParse(r.requestBody),
    responseBody: safeParse(r.responseBody),
    userAgent: r.userAgent,
    ip: r.ip,
  };
}

// จำกัดจำนวนแถวที่ดึงต่อครั้ง กันโหลดหนักถ้า log สะสมเยอะมากในอนาคต — กรอง/ค้นหาทำฝั่ง frontend
// เหมือนหน้ารายการอื่นๆ ในระบบนี้ (rooms/tenants/bills ฯลฯ ก็ดึงทั้งหมดแล้วกรองฝั่ง client เช่นกัน)
const MAX_LOGS = 2000;

export const logsRoute = new Elysia({ prefix: "/logs" })
  .get("/", async () => {
    const rows = await db.select().from(activityLogs).orderBy(desc(activityLogs.timestamp)).limit(MAX_LOGS);
    return rows.map(parseLog);
  });
