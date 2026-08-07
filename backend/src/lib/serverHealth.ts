// ── ความเสถียรของเครื่องเซิร์ฟ (CPU/RAM/uptime) + เช็คว่าเชื่อมต่อฐานข้อมูลได้ปกติ — ไว้ใช้ในหน้าควบคุม
// แพลตฟอร์ม (routes/superadmin.ts) คนละส่วนกับ apiUsageTracker.ts ซึ่งนับ "การเรียก API" ไม่ใช่ตัวเครื่องเอง
import os from "os";
import { sql } from "drizzle-orm";
import { db } from "../db";

// process.cpuUsage() คืนเวลา CPU สะสม (microseconds) ตั้งแต่ process เริ่ม ไม่ใช่ % ปัจจุบัน — ต้องสุ่ม
// เทียบกับรอบก่อนหน้าเป็นระยะๆ เอง (เหมือน `top`) เก็บเป็น state ระดับโมดูล อัปเดตทุก 5 วินาทีพอ ไม่ต้อง
// แม่นระดับวินาทีสำหรับหน้าควบคุมที่ดูภาพรวมเฉยๆ
const CPU_SAMPLE_MS = 5000;
let lastCpuUsage = process.cpuUsage();
let lastSampleAt = Date.now();
let lastCpuPercent = 0;

function sampleCpu() {
  const now = Date.now();
  const elapsedMs = now - lastSampleAt;
  const usage = process.cpuUsage(lastCpuUsage);
  const busyMs = (usage.user + usage.system) / 1000;
  lastCpuPercent = elapsedMs > 0 ? Math.min(100, (busyMs / elapsedMs) * 100) : 0;
  lastCpuUsage = process.cpuUsage();
  lastSampleAt = now;
}
setInterval(sampleCpu, CPU_SAMPLE_MS);

export function getServerHealth() {
  const mem = process.memoryUsage();
  const systemTotal = os.totalmem();
  const systemFree = os.freemem();
  return {
    uptimeSec: Math.floor(process.uptime()),
    cpuPercent: Math.round(lastCpuPercent * 10) / 10,
    memory: {
      rssBytes: mem.rss,
      systemTotalBytes: systemTotal,
      systemUsedBytes: systemTotal - systemFree,
      systemUsedPercent: Math.round(((systemTotal - systemFree) / systemTotal) * 1000) / 10,
    },
  };
}

// ping ฐานข้อมูลเบาๆ (SELECT 1) วัดเวลาไปด้วย — ไม่ใช้ connection pool แยก ใช้ตัวเดียวกับที่ทั้งระบบใช้อยู่
// (db/index.ts) ถ้าฐานข้อมูลล่มจริง endpoint นี้ก็จะช้า/error ตามไปด้วย ซึ่งคือสิ่งที่อยากรู้พอดี
export async function checkDatabaseHealth(): Promise<{ connected: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    await db.execute(sql`select 1`);
    return { connected: true, latencyMs: Date.now() - start };
  } catch {
    return { connected: false, latencyMs: Date.now() - start };
  }
}
