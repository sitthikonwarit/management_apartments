// ── เข้ารหัสข้อมูลอ่อนไหวที่มีอยู่แล้วในฐานข้อมูล (เลขบัตร ปชช./ที่อยู่ผู้เช่า, LINE channel token/secret,
// EasySlip API key) ให้ครบทุกแถวในคราวเดียว — รันได้ปลอดภัยถ้ารันซ้ำ (idempotent): เช็คก่อนทุกฟิลด์ว่าขึ้นต้น
// ด้วย "v1:" (เข้ารหัสแล้ว) หรือยัง ถ้าเข้ารหัสแล้วข้ามไปเฉยๆ ไม่เข้ารหัสซ้อน (ดู lib/encryption.ts) ไม่จำเป็น
// ต้องรันสคริปต์นี้ก่อน deploy ก็ได้ (decryptField รองรับ plaintext เดิมอัตโนมัติอยู่แล้ว) แค่ทำให้ข้อมูลเดิม
// เข้ารหัสจริงในฐานข้อมูลทันทีแทนที่จะรอเข้ารหัสทีละแถวตอนมีคนแก้ไขแถวนั้นเอง
// วิธีใช้: bun run db:encrypt-existing-data (ดู script ใน package.json)
import { eq } from "drizzle-orm";
import { db } from "./index";
import { tenants, appConfig } from "./schema";
import { encryptField } from "../lib/encryption";

const ENCRYPTED_PREFIX = "v1:";
function needsEncryption(v: string | null): v is string {
  return !!v && !v.startsWith(ENCRYPTED_PREFIX);
}

async function encryptTenants() {
  console.log("1) เข้ารหัสข้อมูลผู้เช่า (เลขบัตร ปชช./ที่อยู่)...");
  const rows = await db.select().from(tenants);
  let updated = 0;
  for (const r of rows) {
    const patch: Record<string, string> = {};
    if (needsEncryption(r.idLicense)) patch.idLicense = encryptField(r.idLicense);
    if (needsEncryption(r.houseNo)) patch.houseNo = encryptField(r.houseNo);
    if (needsEncryption(r.soi)) patch.soi = encryptField(r.soi);
    if (needsEncryption(r.road)) patch.road = encryptField(r.road);
    if (needsEncryption(r.province)) patch.province = encryptField(r.province);
    if (needsEncryption(r.amphoe)) patch.amphoe = encryptField(r.amphoe);
    if (needsEncryption(r.tambon)) patch.tambon = encryptField(r.tambon);
    if (needsEncryption(r.zipcode)) patch.zipcode = encryptField(r.zipcode);
    if (needsEncryption(r.address)) patch.address = encryptField(r.address);
    if (Object.keys(patch).length > 0) {
      await db.update(tenants).set(patch).where(eq(tenants.id, r.id));
      updated++;
    }
  }
  console.log(`   ✅ อัปเดต ${updated}/${rows.length} แถว (ที่เหลือเข้ารหัสไว้แล้วหรือไม่มีข้อมูล)`);
}

async function encryptAppConfig() {
  console.log("2) เข้ารหัส LINE channel token/secret + EasySlip API key ของทุกองค์กร...");
  const rows = await db.select().from(appConfig);
  let updated = 0;
  for (const r of rows) {
    const patch: Record<string, string> = {};
    if (needsEncryption(r.lineChannelAccessToken)) patch.lineChannelAccessToken = encryptField(r.lineChannelAccessToken);
    if (needsEncryption(r.lineChannelSecret)) patch.lineChannelSecret = encryptField(r.lineChannelSecret);
    if (needsEncryption(r.easySlipApiKey)) patch.easySlipApiKey = encryptField(r.easySlipApiKey);
    if (Object.keys(patch).length > 0) {
      await db.update(appConfig).set(patch).where(eq(appConfig.id, r.id));
      updated++;
    }
  }
  console.log(`   ✅ อัปเดต ${updated}/${rows.length} แถว (ที่เหลือเข้ารหัสไว้แล้วหรือไม่มีข้อมูล)`);
}

async function main() {
  console.log("=== เข้ารหัสข้อมูลอ่อนไหวที่มีอยู่เดิม ===\n");
  await encryptTenants();
  console.log("");
  await encryptAppConfig();
  console.log("\n🎉 เสร็จสิ้น! รันซ้ำได้ปลอดภัยเสมอ (ข้ามแถวที่เข้ารหัสไว้แล้วอัตโนมัติ)");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("เข้ารหัสข้อมูลล้มเหลว:", e?.message ?? e);
    process.exit(1);
  });
