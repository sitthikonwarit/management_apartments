// สคริปต์สร้าง Rich Menu ของ LINE (Guest / Member / Admin) — รันครั้งเดียวตอนตั้งค่าระบบ หรือรันใหม่เมื่อ
// ต้องการแก้ไขปุ่ม/รูปเมนู (ต้องลบเมนูเก่าออกจาก LINE ก่อน ไม่งั้นจะเป็นเมนูใหม่ซ้อนเมนูเดิม)
// วิธีใช้: bun run rich-menu (ดู script ใน package.json) — ต้องตั้งค่า Channel Access Token ในหน้า Settings
// ของเว็บไว้ก่อน (ตารางเดียวกับที่ใช้ส่งบิลทาง LINE ใน services/line.ts) และเตรียมรูป guest.png / member.png /
// admin.png ไว้ในโฟลเดอร์ richmenu-images/ (ขนาดต้องเป็น 2500x1686 พิกเซลเป๊ะ ตาม RICHMENU_SIZE ด้านล่าง)
import { readFile } from "fs/promises";
import { resolve } from "path";
import { getLineSettings } from "../services/line";
import { getDefaultOrgId } from "../lib/orgContext";

// ตั้งเป็น URL หน้า LIFF จริงของระบบ (เช่น https://liff.line.me/xxxxxxxx) ก่อนรัน — ใส่ผ่าน .env ได้เลย
// ไม่ต้องแก้ไฟล์นี้ตรงๆ
const LIFF_LOGIN_URL = process.env.LIFF_LOGIN_URL ?? "";
const LIFF_PAYMENT_URL = process.env.LIFF_PAYMENT_URL ?? "";

const LINE_RICHMENU_URL = "https://api.line.me/v2/bot/richmenu";
const LINE_RICHMENU_CONTENT_URL = "https://api-data.line.me/v2/bot/richmenu";
const LINE_DEFAULT_RICHMENU_URL = "https://api.line.me/v2/bot/user/all/richmenu";

// ขนาดเดียวกันทั้ง 3 เมนู (เทมเพลตใหญ่สุดของ LINE) — ไฟล์รูปทุกไฟล์ต้องเป็นขนาดนี้เป๊ะ ไม่งั้น LINE จะปฏิเสธตอนอัปโหลด
const RICHMENU_SIZE = { width: 2500, height: 1686 };

interface RichMenuArea {
  bounds: { x: number; y: number; width: number; height: number };
  action: { type: "uri"; uri: string } | { type: "message"; text: string };
}

function guessMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "image/png";
}

// สร้าง Rich Menu หนึ่งอัน: 1) สร้างโครง (พื้นที่/ปุ่ม) 2) อัปโหลดรูปภาพผูกกับ ID ที่ได้ — คืนค่า richMenuId
async function createRichMenu(
  token: string,
  name: string,
  chatBarText: string,
  imageFileName: string,
  areas: RichMenuArea[]
): Promise<string> {
  const createRes = await fetch(LINE_RICHMENU_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ size: RICHMENU_SIZE, selected: false, name, chatBarText, areas }),
  });
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => "");
    throw new Error(`สร้าง Rich Menu "${name}" ไม่สำเร็จ (${createRes.status}): ${text}`);
  }
  const { richMenuId } = await createRes.json();

  const imagePath = resolve(import.meta.dir, "richmenu-images", imageFileName);
  const imageBuffer = await readFile(imagePath).catch(() => {
    throw new Error(`ไม่พบไฟล์รูป ${imagePath} — เตรียมไฟล์ไว้ในโฟลเดอร์ richmenu-images/ ก่อนรัน`);
  });

  const uploadRes = await fetch(`${LINE_RICHMENU_CONTENT_URL}/${richMenuId}/content`, {
    method: "POST",
    headers: { "Content-Type": guessMimeType(imageFileName), Authorization: `Bearer ${token}` },
    body: imageBuffer,
  });
  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => "");
    throw new Error(`อัปโหลดรูป "${imageFileName}" ของเมนู "${name}" ไม่สำเร็จ (${uploadRes.status}): ${text}`);
  }

  console.log(`✅ สร้างเมนู "${name}" สำเร็จ — richMenuId: ${richMenuId}`);
  return richMenuId;
}

async function main() {
  // สคริปต์นี้เป็นเครื่องมือ CLI แบบรันเดี่ยวๆ (ไม่มีบริบท request/องค์กร) — ในระบบหลายองค์กร แนะนำให้ใช้ปุ่ม
  // "สร้าง Rich Menu" ในหน้า Settings ของแต่ละองค์กรแทน (routes/settings.ts, org-scoped อยู่แล้ว) สคริปต์นี้
  // ทำงานกับ "องค์กรแรกสุด" เท่านั้น เก็บไว้เผื่อ debug/ใช้กับระบบที่มีองค์กรเดียว
  const orgId = await getDefaultOrgId();
  if (!orgId) throw new Error("ยังไม่มีองค์กรในระบบ");
  const settings = await getLineSettings(orgId);
  if (!settings.token) {
    throw new Error("ยังไม่ได้ตั้งค่า LINE Channel Access Token — ตั้งค่าได้ที่หน้า Settings ของเว็บก่อนรันสคริปต์นี้");
  }
  if (!LIFF_LOGIN_URL) {
    console.warn("⚠️  ยังไม่ได้ตั้งค่า LIFF_LOGIN_URL ใน .env — ปุ่มเปิด LIFF Login บนเมนู Guest จะใช้ URL ว่างไปก่อน");
  }
  if (!LIFF_PAYMENT_URL) {
    console.warn("⚠️  ยังไม่ได้ตั้งค่า LIFF_PAYMENT_URL ใน .env — ปุ่มเปิด LIFF Payment บนเมนู Member จะใช้ URL ว่างไปก่อน");
  }
  const token = settings.token;

  // --- 1. เมนู GUEST (1 บน, 3 ล่าง) ---
  const guestAreas: RichMenuArea[] = [
    { bounds: { x: 0, y: 0, width: 2500, height: 843 }, action: { type: "uri", uri: LIFF_LOGIN_URL } },
    { bounds: { x: 0, y: 843, width: 833, height: 843 }, action: { type: "message", text: "ดูห้องว่าง" } },
    { bounds: { x: 833, y: 843, width: 834, height: 843 }, action: { type: "message", text: "จองห้อง" } },
    { bounds: { x: 1667, y: 843, width: 833, height: 843 }, action: { type: "message", text: "ติดต่อ" } },
  ];
  const guestId = await createRichMenu(token, "Guest Menu", "เมนูผู้มาเยือน", "guest.png", guestAreas);

  // --- 2. เมนู MEMBER (3x2) ---
  const w = 833;
  const h = 843;
  const memberAreas: RichMenuArea[] = [
    { bounds: { x: 0, y: 0, width: w, height: h }, action: { type: "message", text: "ข้อมูลผู้เช่า" } },
    { bounds: { x: w, y: 0, width: w, height: h }, action: { type: "message", text: "บิลเดือนนี้" } },
    { bounds: { x: w * 2, y: 0, width: w, height: h }, action: { type: "uri", uri: LIFF_PAYMENT_URL } },
    { bounds: { x: 0, y: h, width: w, height: h }, action: { type: "message", text: "แจ้งซ่อม" } },
    { bounds: { x: w, y: h, width: w, height: h }, action: { type: "message", text: "ติดต่อ" } },
    { bounds: { x: w * 2, y: h, width: w, height: h }, action: { type: "message", text: "เพิ่มเติม" } },
  ];
  const memberId = await createRichMenu(token, "Member Menu", "เมนูสมาชิก", "member.png", memberAreas);

  // --- 3. เมนู ADMIN (3x2) ---
  const adminAreas: RichMenuArea[] = [
    { bounds: { x: 0, y: 0, width: w, height: h }, action: { type: "message", text: "แดชบอร์ดสรุปยอด" } },
    { bounds: { x: w, y: 0, width: w, height: h }, action: { type: "message", text: "ดูห้องที่ค้างชำระ" } },
    { bounds: { x: w * 2, y: 0, width: w, height: h }, action: { type: "message", text: "ส่งแจ้งเตือนบิล" } },
    { bounds: { x: 0, y: h, width: w, height: h }, action: { type: "message", text: "รายการแจ้งซ่อม" } },
    { bounds: { x: w, y: h, width: w, height: h }, action: { type: "message", text: "ตั้งค่าระบบ" } },
    { bounds: { x: w * 2, y: h, width: w, height: h }, action: { type: "message", text: "คู่มือแอดมิน" } },
  ];
  const adminId = await createRichMenu(token, "Admin Menu", "เมนูผู้ดูแลระบบ", "admin.png", adminAreas);

  // เมนู Guest เป็นเมนูที่ผู้ใช้ใหม่ (ยังไม่ผูกบัญชี) เห็นตั้งแต่แรก — ตั้งเป็นค่าเริ่มต้นของทุกคนไว้ก่อน
  // ส่วนเมนู Member/Admin ต้องผูกเข้ากับ lineUserId รายคนทีหลัง (linkRichMenuToUser) หลัง login ผ่าน LIFF แล้ว
  const setDefaultRes = await fetch(`${LINE_DEFAULT_RICHMENU_URL}/${guestId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!setDefaultRes.ok) {
    const text = await setDefaultRes.text().catch(() => "");
    console.warn(`⚠️  ตั้งเมนู Guest เป็นค่าเริ่มต้นไม่สำเร็จ (${setDefaultRes.status}): ${text}`);
  } else {
    console.log("✅ ตั้งเมนู Guest เป็นเมนูเริ่มต้นของผู้ใช้ทุกคนแล้ว");
  }

  console.log("\n---------------------------------------------------");
  console.log("🎉 เสร็จสิ้น! เก็บ ID ด้านล่างไว้ใช้ผูกเมนูให้ผู้ใช้แต่ละคนทีหลัง (linkRichMenuToUser)");
  console.log(`GUEST_MENU_ID  = "${guestId}"`);
  console.log(`MEMBER_MENU_ID = "${memberId}"`);
  console.log(`ADMIN_MENU_ID  = "${adminId}"`);
  console.log("---------------------------------------------------");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("สร้าง Rich Menu ไม่สำเร็จ:", e?.message ?? e);
    process.exit(1);
  });
