// ── Backfill org_id: แปลงข้อมูล single-tenant เดิมให้เป็น "องค์กรแรก" ของระบบ multi-tenant ──────────
// รันครั้งเดียวหลัง push schema แบบ nullable (Push #1 ในแผน migration) ก่อน push ครั้งที่ 2 ที่จะเปลี่ยน
// org_id เป็น NOT NULL — ทำงานได้ปลอดภัยถ้ารันซ้ำ (idempotent): ทุกขั้นตอนเช็คก่อนว่ายังไม่มีค่าถึงจะเซ็ต
// วิธีใช้: bun run db:backfill-org (ดู script ใน package.json)
import { isNull, eq, sql } from "drizzle-orm";
import { db } from "./index";
import { organizations, appConfig } from "./schema";
import { ORG_SCOPED_TABLES } from "./orgScopedTables";

// รหัสองค์กรตายตัว (ไม่ใช้ ${Date.now()} เหมือนของอื่นในระบบ) เพราะนี่คือ seed ครั้งเดียวที่มีความหมายกับคน
// อ่านโค้ด ไม่ใช่ id ที่สร้างซ้ำๆ ตอนรันปกติ
const ORG1_ID = "org_baanboonamporn";
const ORG1_NAME = "บ้านบุญอัมพร";
// slug คงที่ (อ่านง่าย ไม่สุ่มเหมือนองค์กรใหม่ที่สร้างผ่าน routes/lineLogin.ts) เพราะนี่คือ seed ครั้งเดียว
const ORG1_SLUG = "baanboonamporn";

async function countRows(table: any): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(table);
  return Number(row?.count ?? 0);
}

async function main() {
  console.log("=== Backfill org_id → องค์กรแรก (migrate ข้อมูลเดิม) ===\n");

  console.log(`1) สร้างองค์กรแรก (${ORG1_ID}) ถ้ายังไม่มี...`);
  await db.insert(organizations).values({
    id: ORG1_ID,
    name: ORG1_NAME,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).onConflictDoNothing();
  console.log("   ✅ เรียบร้อย\n");

  console.log("2) นับจำนวนแถวทั้งหมดต่อตาราง (ก่อน backfill) เพื่อเทียบยอดตอนจบ...");
  const beforeCounts: Record<string, number> = {};
  for (const { name, table } of ORG_SCOPED_TABLES) {
    beforeCounts[name] = await countRows(table);
    console.log(`   ${name}: ${beforeCounts[name]} แถว`);
  }
  console.log("");

  console.log("3) backfill org_id ให้ทุกแถวที่ยังเป็น NULL...");
  for (const { name, table } of ORG_SCOPED_TABLES) {
    const result = await db.update(table).set({ orgId: ORG1_ID }).where(isNull(table.orgId));
    console.log(`   ${name}: อัปเดตแล้ว`);
  }
  console.log("");

  console.log("4) แปลง app_config แถว \"default\" เดิม (ถ้ามี) ให้เป็นของ org นี้...");
  const [defaultConfig] = await db.select().from(appConfig).where(eq(appConfig.id, "default"));
  const [orgConfig] = await db.select({ id: appConfig.id }).from(appConfig).where(eq(appConfig.id, ORG1_ID));
  if (defaultConfig && !orgConfig) {
    await db.update(appConfig).set({ id: ORG1_ID }).where(eq(appConfig.id, "default"));
    console.log("   ✅ แปลงแถว app_config \"default\" → " + ORG1_ID);
  } else if (orgConfig) {
    console.log("   ⏭  มีแถว app_config ของ org นี้อยู่แล้ว ข้าม");
  } else {
    console.log("   ⏭  ไม่พบแถว app_config \"default\" ข้าม (จะถูกสร้างอัตโนมัติครั้งแรกที่เปิดหน้า Settings)");
  }
  console.log("");

  console.log("4.5) ตั้ง slug ให้องค์กรแรก (ถ้ายังไม่มี) — ใช้เป็น ?org= ใน LIFF URL (ดู lib/orgContext.ts)...");
  const [org1] = await db.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, ORG1_ID));
  if (org1 && !org1.slug) {
    await db.update(organizations).set({ slug: ORG1_SLUG }).where(eq(organizations.id, ORG1_ID));
    console.log(`   ✅ ตั้ง slug = "${ORG1_SLUG}"`);
  } else {
    console.log(`   ⏭  มี slug อยู่แล้ว (${org1?.slug}) ข้าม`);
  }
  console.log("");

  console.log("5) ตรวจสอบว่าไม่มีแถวไหนหลง org_id เป็น NULL อยู่อีก...");
  let hasNull = false;
  for (const { name, table } of ORG_SCOPED_TABLES) {
    const remaining = await db.select({ count: sql<number>`count(*)` }).from(table).where(isNull(table.orgId));
    const n = Number(remaining[0]?.count ?? 0);
    if (n > 0) {
      hasNull = true;
      console.error(`   ❌ ${name}: ยังมี ${n} แถวที่ org_id เป็น NULL`);
    }
  }
  if (hasNull) {
    console.error("\n❌ ยังมีแถวที่ backfill ไม่ครบ — อย่าเพิ่ง push schema ให้ org_id เป็น NOT NULL จนกว่าจะแก้ตรงนี้ก่อน");
    process.exit(1);
  }
  console.log("   ✅ ไม่มีแถวไหนหลงเหลือ\n");

  console.log("6) นับจำนวนแถวทั้งหมดต่อตาราง (หลัง backfill) — ต้องเท่ากับก่อนหน้าเป๊ะทุกตาราง...");
  let countMismatch = false;
  for (const { name, table } of ORG_SCOPED_TABLES) {
    const after = await countRows(table);
    const match = after === beforeCounts[name];
    if (!match) countMismatch = true;
    console.log(`   ${name}: ${after} แถว ${match ? "✅" : `❌ (ก่อนหน้า ${beforeCounts[name]})`}`);
  }
  if (countMismatch) {
    console.error("\n❌ จำนวนแถวไม่ตรงกับก่อน backfill — backfill ควรแค่เซ็ตค่าคอลัมน์ ไม่ควรเปลี่ยนจำนวนแถว ตรวจสอบด่วน");
    process.exit(1);
  }

  console.log(`\n🎉 เสร็จสิ้น! องค์กรแรก: ${ORG1_ID} (${ORG1_NAME})`);
  console.log("ขั้นตอนถัดไป: push schema อีกรอบเพื่อเปลี่ยน org_id เป็น NOT NULL ทุกตาราง แล้วค่อยทำ composite PK ของ liveMeterConfigs/lineProfiles แยกต่างหาก");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Backfill ล้มเหลว:", e?.message ?? e);
    process.exit(1);
  });
