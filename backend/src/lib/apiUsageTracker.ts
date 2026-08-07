// ── ตัวนับอัตราการเรียก API แบบ in-memory ล้วนๆ — ไว้ใช้ในหน้าควบคุมแพลตฟอร์ม (routes/superadmin.ts)
// โชว์ "การใช้งาน API แบบเรียลไทม์" ต่อองค์กร + รวมทั้งแพลตฟอร์ม ไม่มีตาราง DB แยก เพราะแค่ต้องการเลขคร่าวๆ
// ให้ดูสดๆ ไม่ต้องคงอยู่ข้ามการรีสตาร์ทเซิร์ฟเวอร์ (แพทเทิร์นเดียวกับ profileVerifyAttempts ใน routes/liff.ts)
// เก็บเฉพาะ "timestamp ที่ยังอยู่ในหน้าต่าง 5 นาทีล่าสุด" ต่อองค์กร ตัดทิ้งอัตโนมัติทุกครั้งที่มีการอ่าน/เขียน
// กันหน่วยความจำโตไม่จำกัดถ้าเซิร์ฟเวอร์รันนานๆ
//
// ขอบเขตที่รู้อยู่แล้ว: เรียกจาก index.ts เฉพาะ request ที่ผ่านการ์ด authDerive (หน้าแอดมินของแต่ละองค์กร)
// เท่านั้น เพราะเป็น hook เดียวที่มี authUser.orgId ให้ใช้อยู่แล้วโดยไม่ต้องเพิ่ม logic แยกที่ liff.ts/
// lineWebhook.ts (endpoint ฝั่งผู้เช่า/LINE) ซึ่ง resolve org กันคนละแบบและ mount ก่อนการ์ดนี้ในเชนของ Elysia
const WINDOW_MS = 5 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

const orgTimestamps = new Map<string, number[]>();
let globalTimestamps: number[] = [];

function pruneOld(arr: number[], now: number) {
  let i = 0;
  while (i < arr.length && now - arr[i] > WINDOW_MS) i++;
  if (i > 0) arr.splice(0, i);
}

export function recordRequest(orgId: string | null | undefined) {
  const now = Date.now();
  globalTimestamps.push(now);
  pruneOld(globalTimestamps, now);
  if (!orgId) return;
  const arr = orgTimestamps.get(orgId) ?? [];
  arr.push(now);
  pruneOld(arr, now);
  orgTimestamps.set(orgId, arr);
}

export interface RequestRate { last1m: number; last5m: number }

export function getOrgRequestRate(orgId: string): RequestRate {
  const now = Date.now();
  const arr = orgTimestamps.get(orgId) ?? [];
  pruneOld(arr, now);
  return { last1m: arr.filter((t) => now - t <= ONE_MINUTE_MS).length, last5m: arr.length };
}

export function getGlobalRequestRate(): RequestRate {
  const now = Date.now();
  pruneOld(globalTimestamps, now);
  return { last1m: globalTimestamps.filter((t) => now - t <= ONE_MINUTE_MS).length, last5m: globalTimestamps.length };
}

// ── ความเสถียรของ API: อัตราข้อผิดพลาด (5xx) + เวลาตอบสนองเฉลี่ย — นับทุก request ที่เข้ามาทั้งระบบ (ต่าง
// จาก recordRequest ด้านบนที่นับเฉพาะ request ที่ผ่านการ์ด authDerive ของพนักงาน) hook ไว้ที่จุดเดียวบนสุด
// ของ index.ts (onRequest + onAfterHandle/onError) ครอบคลุมทุก route รวม /liff, /line/webhook, /superadmin ด้วย
interface ApiCallRecord { time: number; durationMs: number; isError: boolean }
let apiCalls: ApiCallRecord[] = [];

function pruneOldCalls(now: number) {
  let i = 0;
  while (i < apiCalls.length && now - apiCalls[i].time > WINDOW_MS) i++;
  if (i > 0) apiCalls.splice(0, i);
}

export function recordApiCall(statusCode: number, durationMs: number) {
  const now = Date.now();
  apiCalls.push({ time: now, durationMs, isError: statusCode >= 500 });
  pruneOldCalls(now);
}

export interface ApiHealthWindow { count: number; errorCount: number; errorRate: number; avgResponseMs: number }

function computeApiHealthWindow(windowMs: number, now: number): ApiHealthWindow {
  const inWindow = apiCalls.filter((c) => now - c.time <= windowMs);
  const count = inWindow.length;
  const errorCount = inWindow.filter((c) => c.isError).length;
  const avgResponseMs = count ? inWindow.reduce((sum, c) => sum + c.durationMs, 0) / count : 0;
  return {
    count, errorCount,
    errorRate: count ? Math.round((errorCount / count) * 1000) / 10 : 0,
    avgResponseMs: Math.round(avgResponseMs),
  };
}

export function getApiHealth(): { last1m: ApiHealthWindow; last5m: ApiHealthWindow } {
  const now = Date.now();
  pruneOldCalls(now);
  return { last1m: computeApiHealthWindow(ONE_MINUTE_MS, now), last5m: computeApiHealthWindow(WINDOW_MS, now) };
}
