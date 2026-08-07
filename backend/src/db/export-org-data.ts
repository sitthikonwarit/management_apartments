// ── ส่งออกข้อมูลองค์กรเดียวเป็นไฟล์ SQL (INSERT ... ON CONFLICT DO NOTHING) — ใช้ตอนย้าย/รวมข้อมูลองค์กร
// หนึ่งจากฐานข้อมูลนี้ไปอีกฐานข้อมูลหนึ่ง (เช่น local → server) แบบ "เติมเฉพาะที่ขาด" โดยไม่แตะ/ทับข้อมูล
// องค์กรอื่นที่มีอยู่แล้วในฐานปลายทางเลย (ON CONFLICT DO NOTHING = ข้ามแถวที่ id ชนกันเฉยๆ ไม่ throw ไม่ทับ)
// วิธีใช้: bun src/db/export-org-data.ts <orgId> > output.sql
// แล้วเอาไฟล์ output.sql ไปรันที่ฐานข้อมูลปลายทางเอง เช่น psql $DATABASE_URL -f output.sql
import postgres from "postgres";

const orgId = process.argv[2];
if (!orgId) {
  console.error("Usage: bun src/db/export-org-data.ts <orgId> > output.sql");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL!);

function lit(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return `'${v.toISOString()}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function exportTable(table: string, whereCol: string, whereVal: string) {
  const rows = await sql.unsafe(`select * from "${table}" where "${whereCol}" = $1`, [whereVal]);
  console.error(`  ${table}: ${rows.length} แถว`);
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  console.log(`-- ${table}: ${rows.length} แถว`);
  for (const row of rows) {
    const values = cols.map((c) => lit((row as any)[c]));
    console.log(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${values.join(", ")}) ON CONFLICT DO NOTHING;`);
  }
  console.log("");
}

// เรียงให้แถวที่ตารางอื่นอาจอ้างถึง (organizations, users) มาก่อน แม้ schema นี้จะไม่ได้บังคับ FK จริงจัง
// ระดับ DB ก็ตาม (กันความสับสนตอนอ่านไฟล์ผลลัพธ์เฉยๆ)
const ORG_SCOPED_TABLE_NAMES = [
  "users", "towers", "room_tags", "tenant_tags", "vehicle_types", "rooms", "tenants",
  "bookings", "meter_readings", "vehicles", "bills", "app_settings", "payments",
  "payment_intents", "activity_logs", "chat_messages", "live_meter_configs", "line_profiles",
];

async function main() {
  console.error(`=== ส่งออกข้อมูลองค์กร "${orgId}" ===`);
  console.log(`-- Export org "${orgId}" — generated ${new Date().toISOString()}`);
  console.log("BEGIN;");
  console.log("");

  await exportTable("organizations", "id", orgId);
  await exportTable("app_config", "id", orgId);
  for (const t of ORG_SCOPED_TABLE_NAMES) {
    await exportTable(t, "org_id", orgId);
  }

  console.log("COMMIT;");
  console.error("เสร็จสิ้น — เอาไฟล์ output ไปรันที่ฐานข้อมูลปลายทาง เช่น: psql $DATABASE_URL -f output.sql");
}

main().then(() => sql.end()).catch((e) => { console.error(e); process.exit(1); });
