// ── เข้ารหัสข้อมูลอ่อนไหว "at rest" (ในฐานข้อมูล) + เซ็นลายเซ็น URL ไฟล์อัปโหลด ────────────────
// ใช้กุญแจแม่ตัวเดียว (FIELD_ENCRYPTION_KEY ใน .env) แล้วแตกเป็น 2 กุญแจย่อยแยกวัตถุประสงค์กันด้วย HMAC
// domain separation (ไม่ใช้กุญแจเดียวกันข้าม algorithm/วัตถุประสงค์ — best practice มาตรฐาน) เพื่อให้ดูแล
// ง่าย (มีความลับแค่ตัวเดียวต้องสร้าง/สำรอง/หมุนเวียน) แต่ยังแยกความเสี่ยงกันจริงระหว่างสองงาน:
//   1) encryptField/decryptField — เข้ารหัสฟิลด์อ่อนไหวในฐานข้อมูล (เลขบัตร ปชช./ที่อยู่ผู้เช่า,
//      LINE channel token/secret, EasySlip API key) ด้วย AES-256-GCM
//   2) signUploadPath/verifyUploadSignature — เซ็น URL ใต้ /uploads/* ด้วย HMAC-SHA256 กัน URL ถูกเดา/
//      ไล่สแกน (orgId แบบ ORG-timestamp และชื่อไฟล์แบบ timestamp เดากันได้ทั้งคู่) ไม่มี expiry ตั้งใจ เพราะ
//      ลิงก์ "ดูสลิป" ที่ฝังอยู่ในข้อความ LINE (ดู services/line.ts toPublicUrl) ค้างอยู่ในประวัติแชทได้
//      เป็นสัปดาห์ ผู้เช่าอาจกดดูทีหลังนานแค่ไหนก็ได้ — ถ้าลิงก์หมดอายุจะกลายเป็นลิงก์เสียเงียบๆ ไม่มีทางขอใหม่
//      ต้องการยกเลิกลิงก์ทั้งหมดทำได้โดยหมุนเวียน FIELD_ENCRYPTION_KEY (เหมือนที่หมุน JWT_SECRET แล้วทุก
//      session เดิมหลุดหมดเช่นกัน)
import { createHmac, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "crypto";

const MASTER_KEY = process.env.FIELD_ENCRYPTION_KEY;
if (!MASTER_KEY) throw new Error("Missing FIELD_ENCRYPTION_KEY in .env — กรุณาตั้งค่าก่อนรันเซิร์ฟเวอร์ (ดู .env.example)");

function deriveKey(purpose: string): Buffer {
  return createHmac("sha256", MASTER_KEY!).update(purpose).digest(); // 32 ไบต์ พอดีกับ AES-256
}

const FIELD_KEY = deriveKey("field-encryption-v1");
const SIGNING_KEY = deriveKey("upload-url-signing-v1");

const ENCRYPTED_PREFIX = "v1:";

// เข้ารหัสฟิลด์เดียว (สตริง) — ค่าว่างเก็บว่างตรงๆ ไม่เข้ารหัส (กันแถวเก่าที่ไม่เคยกรอกข้อมูลพัง/ไม่มีความหมาย
// อะไรต้องปิดบัง) IV สุ่มใหม่ทุกครั้งตามมาตรฐาน AES-GCM เก็บรวมกับ auth tag ไว้ในสตริงเดียวคั่นด้วย ":"
export function encryptField(plaintext: string): string {
  if (!plaintext) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", FIELD_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

// ถอดรหัส — ถ้าค่าที่เก็บไว้ไม่ได้ขึ้นต้นด้วย "v1:" ถือว่าเป็นข้อมูลเก่าก่อนมีฟีเจอร์นี้ (plaintext ดิบ) คืนค่า
// เดิมตรงๆ โดยไม่พยายามถอดรหัส — ทำให้ deploy ฟีเจอร์นี้ได้ทันทีไม่ต้อง migrate ข้อมูลเดิมก่อน (ดู
// db/encrypt-existing-data.ts สำหรับสคริปต์ migrate ทีหลัง) ถอดรหัสพังกลางทาง (tag ไม่ตรง/ฟอร์แมตเพี้ยน)
// ให้ throw ตรงๆ ดีกว่าเงียบแล้วคืนค่าผิดๆ — ไม่ควรเกิดขึ้นถ้าไม่มีใครแก้ข้อมูลในตารางตรงๆ นอกแอป
export function decryptField(stored: string): string {
  if (!stored) return "";
  if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored;
  const [ivB64, tagB64, dataB64] = stored.slice(ENCRYPTED_PREFIX.length).split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", FIELD_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

// เซ็น path ใต้ /uploads/* ด้วย HMAC — คืนค่าเดิมตรงๆ ถ้าไม่ใช่ path ใต้ /uploads/ เลย (เผื่อเรียกกับฟิลด์ที่
// อาจเป็น base64 data URI/URL ภายนอก/สตริงว่างก็ได้ เช่น logoUrl/paymentQrImage ที่เก็บเป็น base64 ตรงๆ
// ไม่ใช่ path แบบนี้ — ต้องไม่ไปแตะฟิลด์พวกนั้นเข้า) เซ็นเฉพาะ path ล้วนๆ (ตัด query string เดิมทิ้งก่อนเผื่อ
// ถูกเรียกซ้ำ) ไม่มี timestamp/expiry ในลายเซ็น — ดูคอมเมนต์หัวไฟล์ว่าทำไม
// เช็คว่าเป็น string ก่อนเสมอ (typeof) — ข้อมูลเก่าบางฟิลด์ (เช่น vehicles.images ยุค Google Sheets/Drive
// เดิม) เก็บเป็น array ของ object {id, url, viewUrl, name} ไม่ใช่ string ตรงๆ ถ้าไม่กันไว้จะ throw กลางทาง
// (relativePath.startsWith is not a function) ทำให้ endpoint ทั้งเส้นพัง 500 แทนที่จะแค่ข้ามค่านั้นไป
// ป้องกันชั้นที่สอง (defense-in-depth): ห้ามเซ็น path ที่มี ".." เป็น segment เด็ดขาด แม้ทุกจุดที่เรียกมาแล้ว
// (routes/tenants.ts ฯลฯ) ควรกรอง path ให้ตรงกับของเดิมที่มีอยู่จริงในฐานข้อมูลก่อนอยู่แล้วก็ตาม — กันไว้เผื่อ
// จุดเรียกใหม่ในอนาคตพลาดไม่ได้กรอง เพราะถ้าเซ็น path แบบ "/uploads/../../.env" ให้ผ่านไปได้ ตัว handler
// GET /uploads/* ใน index.ts จะ resolve ออกนอกโฟลเดอร์ uploads/ จริง กลายเป็นอ่านไฟล์ใดๆ บนเครื่องเซิร์ฟเวอร์ได้
function hasTraversalSegment(path: string): boolean {
  return path.split("/").some((seg) => seg === "..");
}

export function signUploadPath(relativePath: unknown): string {
  if (typeof relativePath !== "string" || !relativePath || !relativePath.startsWith("/uploads/")) return relativePath as string;
  const cleanPath = relativePath.split("?")[0];
  if (hasTraversalSegment(cleanPath)) return "";
  const sig = createHmac("sha256", SIGNING_KEY).update(cleanPath).digest("base64url");
  return `${cleanPath}?sig=${sig}`;
}

// ตรวจลายเซ็น — เทียบแบบ timing-safe เหมือน verifyLineSignature ใน services/line.ts (กันโจมตีจับเวลา)
export function verifyUploadSignature(pathname: string, sig: string | undefined): boolean {
  if (!sig) return false;
  const expected = createHmac("sha256", SIGNING_KEY).update(pathname).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
