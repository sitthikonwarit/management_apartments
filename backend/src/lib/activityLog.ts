import { db } from "../db";
import { activityLogs } from "../db/schema";

const SENSITIVE_KEYS = new Set(["password", "passwordHash", "token", "currentSessionId", "sid"]);
const MAX_STRING_LEN = 500; // ตัดสตริงยาวผิดปกติ (เช่น base64 รูปภาพ) ทิ้ง ไม่ให้ log บวมเกินจำเป็น
const MAX_JSON_LEN = 20000; // จำกัดขนาดรวมของ JSON ที่ serialize แล้วต่อ 1 ฟิลด์ กันข้อมูลก้อนใหญ่ผิดปกติ

// เดินลึกเข้าไปทุกชั้นของ object/array — ปิดบังฟิลด์อ่อนไหว (รหัสผ่าน/โทเค็น) และตัดสตริงยาวๆ
// (โดยเฉพาะรูปภาพ base64) ก่อนจะเก็บลง log จริง เพื่อไม่ให้ตารางบวมและไม่ให้รหัสผ่านรั่วไปอยู่ใน log
function sanitizeDeep(value: any, key?: string): any {
  if (key && SENSITIVE_KEYS.has(key)) return "[hidden]";
  if (typeof value === "string") {
    if (value.startsWith("data:") || value.length > MAX_STRING_LEN) {
      return `[omitted: string, ${value.length} chars]`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeDeep(v));
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeDeep(v, k);
    return out;
  }
  return value;
}

export function sanitizeForLog(data: unknown): any {
  if (data === null || data === undefined || data === "") return null;
  const sanitized = sanitizeDeep(data);
  try {
    const json = JSON.stringify(sanitized);
    if (json && json.length > MAX_JSON_LEN) {
      return { _truncated: true, preview: json.slice(0, MAX_JSON_LEN) + "..." };
    }
  } catch {
    return { _error: "ไม่สามารถแปลงข้อมูลเป็น log ได้" };
  }
  return sanitized;
}

export async function recordLog(entry: {
  userId: string;
  username: string;
  method: string;
  path: string;
  action: string;
  entityType: string;
  description: string;
  status: number;
  requestBody?: unknown;
  responseBody?: unknown;
  userAgent?: string;
  ip?: string;
}) {
  // การบันทึก log ต้องไม่มีทางทำให้ request จริงล้มเหลว — ห่อ try/catch กันไว้เป็น best-effort เสมอ
  try {
    await db.insert(activityLogs).values({
      id: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      userId: entry.userId,
      username: entry.username,
      method: entry.method,
      path: entry.path,
      action: entry.action,
      entityType: entry.entityType,
      description: entry.description,
      status: String(entry.status),
      requestBody: JSON.stringify(sanitizeForLog(entry.requestBody)),
      responseBody: JSON.stringify(sanitizeForLog(entry.responseBody)),
      userAgent: entry.userAgent ?? "",
      ip: entry.ip ?? "",
    });
  } catch (e) {
    console.error("[activity-log] failed to record:", e);
  }
}
