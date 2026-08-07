// ── Backfill setup_completed: กันไม่ให้องค์กรที่มีอยู่ก่อนฟีเจอร์ "ไกด์ตั้งค่าเริ่มต้น" (ดู
// AuthenticatedShell ใน frontend/src/App.tsx, POST /settings/config/complete-setup) โดนล็อกพาไปหน้า
// Settings ทั้งที่ใช้งานระบบอยู่แล้วตามปกติ — รันครั้งเดียวตอนขึ้นฟีเจอร์นี้ก่อน deploy (idempotent รันซ้ำได้)
// วิธีใช้: bun run db:backfill-setup-completed
import { eq } from "drizzle-orm";
import { db } from "./index";
import { organizations, appConfig } from "./schema";

async function main() {
  console.log("=== Backfill setup_completed = true ให้ทุกองค์กรที่มีอยู่ก่อนแล้ว ===\n");

  const orgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations);
  console.log(`พบ ${orgs.length} องค์กรในระบบ\n`);

  let created = 0, updated = 0, skipped = 0;
  for (const org of orgs) {
    const [existing] = await db.select({ id: appConfig.id, setupCompleted: appConfig.setupCompleted }).from(appConfig).where(eq(appConfig.id, org.id));
    if (!existing) {
      // องค์กรนี้ยังไม่เคยเปิดหน้า Settings เลย (ไม่มีแถว app_config) — สร้างแถวให้เลยพร้อม setupCompleted
      // = true (เดียวกับที่ getOrCreateConfig ใน routes/settings.ts สร้างให้ แค่ตั้งค่านี้เพิ่ม)
      await db.insert(appConfig).values({
        id: org.id, electricRate: "7", waterRate: "18", logoUrl: "", appName: "", appNameColors: "[]",
        setupCompleted: "true", updatedAt: new Date().toISOString(),
      });
      console.log(`  ✅ สร้างแถว app_config ใหม่ + setupCompleted=true — ${org.id} (${org.name})`);
      created++;
    } else if (existing.setupCompleted !== "true") {
      await db.update(appConfig).set({ setupCompleted: "true" }).where(eq(appConfig.id, org.id));
      console.log(`  ✅ อัปเดต setupCompleted=true — ${org.id} (${org.name})`);
      updated++;
    } else {
      skipped++;
    }
  }

  console.log(`\n🎉 เสร็จสิ้น! สร้างใหม่ ${created} / อัปเดต ${updated} / ข้าม (เป็น true อยู่แล้ว) ${skipped}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Backfill ล้มเหลว:", e?.message ?? e);
    process.exit(1);
  });
