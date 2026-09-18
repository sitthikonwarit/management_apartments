// ── IP จริงของผู้ใช้ปลายทาง ─────────────────────────────────────────────────────
// server.requestIP(request) ของ Bun คืน IP ของฝั่งที่ "ต่อ socket มาโดยตรง" เท่านั้น — ถ้าระบบรันหลัง
// reverse proxy (nginx จริงตอน deploy / vite dev proxy ตอนพัฒนา) ค่านี้จะเป็น IP ของตัว proxy เอง (มักเป็น
// 127.0.0.1 เพราะ proxy กับ backend อยู่เครื่องเดียวกัน) ไม่ใช่ IP ของผู้ใช้จริงที่เห็นใน Log กิจกรรม (ดู
// lib/activityLog.ts) ต้องอ่านจาก header "x-forwarded-for"/"x-real-ip" ที่ proxy แนบมาให้ก่อนเสมอ
// (proxy เป็นคนตั้งค่า header นี้เอง ไม่ใช่ client ส่งมาตรงๆ — nginx ที่ตั้งค่า proxy_set_header ถูกต้องจะ
// overwrite ค่าเดิมที่ client พยายามปลอมมาก่อนเสมอ) เหลือ requestIP() ไว้เป็น fallback สุดท้ายกรณีไม่มี proxy
export function getClientIp(headers: Record<string, string | undefined>, server: any, request: Request): string {
  // x-forwarded-for อาจมีหลาย IP คั่นด้วยจุลภาค (client, proxy1, proxy2, ...) เรียงจากต้นทางสุดไปปลายทาง —
  // ตัวแรกสุดคือ IP ของ client จริง
  const forwarded = headers["x-forwarded-for"];
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers["x-real-ip"];
  if (realIp) return realIp;
  return server?.requestIP(request)?.address ?? "";
}
