// LINE Rich Menu (Guest/Member/Admin) — สร้าง/ลบเมนูผ่าน LINE Messaging API เรียกจาก
// routes/settings.ts (ปุ่ม "สร้าง/อัปเดต Rich Menu" ในหน้า Settings > LINE Rich Menu) เลย์เอาต์ปุ่ม/
// ข้อความของแต่ละเมนูเก็บตายตัวไว้ที่นี่ ส่วน Channel Access Token / LIFF URL / รูปภาพแต่ละเมนู
// มาจาก app_config (ตั้งค่าได้จากหน้าเว็บ ไม่ต้องแก้โค้ด)

const LINE_RICHMENU_URL = "https://api.line.me/v2/bot/richmenu";
const LINE_RICHMENU_CONTENT_URL = "https://api-data.line.me/v2/bot/richmenu";
const LINE_DEFAULT_RICHMENU_URL = "https://api.line.me/v2/bot/user/all/richmenu";
const LINE_USER_RICHMENU_URL = "https://api.line.me/v2/bot/user";

// เทมเพลตใหญ่สุดของ LINE — รูปทุกไฟล์ต้องเป็นขนาดนี้เป๊ะ (ตรวจฝั่ง frontend ก่อนอัปโหลดแล้ว ดู
// handleRichMenuFile ใน SettingsPage.tsx)
export const RICHMENU_SIZE = { width: 2500, height: 1686 };

interface RichMenuArea {
  bounds: { x: number; y: number; width: number; height: number };
  action: { type: "uri"; uri: string } | { type: "message"; text: string };
}

// ปุ่ม "ติดต่อ"/"ข้อมูลผู้เช่า"/"แจ้งซ่อม" เป็น URL จริงได้ก็ต่อเมื่อตั้งค่าไว้แล้วเท่านั้น (ต้องสร้างหน้า
// LIFF/PUBLIC_BASE_URL ไว้ก่อน) ไม่งั้น fallback เป็นปุ่มข้อความส่งเข้าแชทแบบเดิม กันปุ่มพังตอนยังตั้งค่า
// ไม่ครบ
function uriOrMessage(url: string, text: string): RichMenuArea["action"] {
  return url ? { type: "uri", uri: url } : { type: "message", text };
}

function guestAreas(liffLoginUrl: string, contactUrl: string, liffRoomsUrl: string, liffBookingUrl: string): RichMenuArea[] {
  // "ดูห้องว่าง" กับ "จองห้อง" เป็นคนละ LIFF App กันจริงๆ (คนละหน้า): liffRoomsUrl = ดูรายการห้องว่าง+
  // รายละเอียด (frontend/src/pages/LiffRoomsPage.tsx, มีปุ่มลัดไปหน้าจองในรายละเอียดห้อง) ส่วน
  // liffBookingUrl = จัดการห้องที่ตัวเองจองอยู่/ยกเลิกเอง (frontend/src/pages/LiffBookingPage.tsx)
  return [
    { bounds: { x: 0, y: 0, width: 2500, height: 843 }, action: { type: "uri", uri: liffLoginUrl } },
    { bounds: { x: 0, y: 843, width: 833, height: 843 }, action: uriOrMessage(liffRoomsUrl, "ดูห้องว่าง") },
    { bounds: { x: 833, y: 843, width: 834, height: 843 }, action: uriOrMessage(liffBookingUrl, "จองห้อง") },
    { bounds: { x: 1667, y: 843, width: 833, height: 843 }, action: uriOrMessage(contactUrl, "ติดต่อ") },
  ];
}

const W = 833;
const H = 843;

export interface MemberMenuUrls {
  liffPaymentUrl: string;
  liffProfileUrl: string;
  liffRepairUrl: string;
  contactUrl: string;
}

function memberAreas(urls: MemberMenuUrls): RichMenuArea[] {
  // "?view=thisMonth" บอกหน้า LIFF Payment ให้เปิดป็อปอัพรายละเอียดบิลเดือนปัจจุบันให้ทันทีตอนโหลดเสร็จ (ดู
  // useEffect ใน LiffPaymentPage.tsx + POST /liff/bill-detail/this-month ใน routes/liff.ts) — ต้องต่อท้าย
  // แบบนี้เพราะเมนูเป็น URL เดียวใช้ร่วมกันทุกคน ฝัง billId/roomId ของแต่ละคนไว้ล่วงหน้าตอนสร้างเมนูไม่ได้
  const thisMonthUrl = urls.liffPaymentUrl
    ? `${urls.liffPaymentUrl}${urls.liffPaymentUrl.includes("?") ? "&" : "?"}view=thisMonth`
    : "";
  return [
    { bounds: { x: 0, y: 0, width: W, height: H }, action: uriOrMessage(urls.liffProfileUrl, "ข้อมูลผู้เช่า") },
    { bounds: { x: W, y: 0, width: W, height: H }, action: uriOrMessage(thisMonthUrl, "บิลเดือนนี้") },
    { bounds: { x: W * 2, y: 0, width: W, height: H }, action: { type: "uri", uri: urls.liffPaymentUrl } },
    { bounds: { x: 0, y: H, width: W, height: H }, action: uriOrMessage(urls.liffRepairUrl, "แจ้งซ่อม") },
    { bounds: { x: W, y: H, width: W, height: H }, action: uriOrMessage(urls.contactUrl, "ติดต่อ") },
    { bounds: { x: W * 2, y: H, width: W, height: H }, action: { type: "message", text: "เพิ่มเติม" } },
  ];
}

function adminAreas(): RichMenuArea[] {
  return [
    { bounds: { x: 0, y: 0, width: W, height: H }, action: { type: "message", text: "แดชบอร์ดสรุปยอด" } },
    { bounds: { x: W, y: 0, width: W, height: H }, action: { type: "message", text: "ดูห้องที่ค้างชำระ" } },
    { bounds: { x: W * 2, y: 0, width: W, height: H }, action: { type: "message", text: "ส่งแจ้งเตือนบิล" } },
    { bounds: { x: 0, y: H, width: W, height: H }, action: { type: "message", text: "รายการแจ้งซ่อม" } },
    { bounds: { x: W, y: H, width: W, height: H }, action: { type: "message", text: "ตั้งค่าระบบ" } },
    { bounds: { x: W * 2, y: H, width: W, height: H }, action: { type: "message", text: "คู่มือแอดมิน" } },
  ];
}

async function createOne(
  token: string, name: string, chatBarText: string, areas: RichMenuArea[],
  imageBuffer: Buffer, mimeType: string
): Promise<string> {
  const createRes = await fetch(LINE_RICHMENU_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ size: RICHMENU_SIZE, selected: false, name, chatBarText, areas }),
  });
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => "");
    throw new Error(`สร้างเมนู "${name}" ไม่สำเร็จ (${createRes.status}): ${text}`);
  }
  const { richMenuId } = await createRes.json();

  const uploadRes = await fetch(`${LINE_RICHMENU_CONTENT_URL}/${richMenuId}/content`, {
    method: "POST",
    headers: { "Content-Type": mimeType, Authorization: `Bearer ${token}` },
    body: imageBuffer,
  });
  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => "");
    throw new Error(`อัปโหลดรูปเมนู "${name}" ไม่สำเร็จ (${uploadRes.status}): ${text}`);
  }
  return richMenuId;
}

// ลบ Rich Menu เก่าออกจาก LINE — best-effort เฉยๆ (อาจถูกลบจากฝั่ง LINE Console ไปแล้วก็ได้) ไม่ throw
// เพราะไม่อยากบล็อกการสร้างชุดใหม่ด้วยเหตุผลที่ไม่เกี่ยวกับชุดใหม่เลย
async function deleteRichMenu(token: string, richMenuId: string): Promise<void> {
  if (!richMenuId) return;
  try {
    await fetch(`${LINE_RICHMENU_URL}/${richMenuId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  } catch {
    // เพิกเฉย — ดู comment ด้านบน
  }
}

// ผูก Rich Menu แบบหนึ่งเข้ากับ LINE User ID รายคน (แทนที่เมนูเริ่มต้น (all-user default) เฉพาะคนนี้) —
// เรียกจาก routes/liff.ts ตอนผู้เช่ากด "เข้าสู่ระบบ" ผ่านหน้า LIFF Login แล้วพบว่าผูกกับผู้เช่าอยู่แล้ว
// เพื่อสลับจากเมนู Guest เป็นเมนู Member ให้อัตโนมัติ คืนค่า false เฉยๆ ถ้าไม่สำเร็จ (ไม่ throw เพราะไม่ควร
// บล็อกการ login ทั้งขั้นตอนด้วยเหตุผลรอง)
export async function linkRichMenuToUser(token: string, userId: string, richMenuId: string): Promise<boolean> {
  if (!richMenuId) return false;
  try {
    const res = await fetch(`${LINE_USER_RICHMENU_URL}/${userId}/richmenu/${richMenuId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ผูก Rich Menu ใหม่ให้ "ทุกคน" ที่เคยผูกเมนู Member ไว้อยู่แล้วในคราวเดียว — เรียกหลังสร้างเมนูชุดใหม่สำเร็จ
// (routes/settings.ts) เพราะ createAllRichMenus ด้านล่างลบเมนูชุดเก่าทิ้งก่อนเสมอ ซึ่งทำให้คนที่เคยผูกกับ
// ID เก่าไว้ "หลุด" กลับไปเห็นเมนู Guest (ค่าเริ่มต้น) ทันที จนกว่าจะ login ผ่าน LIFF ใหม่อีกครั้ง — ไม่ต้อง
// รอให้แต่ละคน login เอง สั่ง re-link ให้ครบทุกคนตรงนี้เลย (best-effort ทีละคน ไม่ให้คนใดคนหนึ่งพลาดแล้วบล็อก
// คนที่เหลือ เช่น บล็อก LINE OA ไปแล้ว/lineUserId ไม่ถูกต้อง)
export async function relinkRichMenuForUsers(token: string, richMenuId: string, userIds: string[]): Promise<{ success: number; failed: number }> {
  if (!richMenuId) return { success: 0, failed: 0 };
  const uniqueIds = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
  const results = await Promise.all(uniqueIds.map((id) => linkRichMenuToUser(token, id, richMenuId)));
  const success = results.filter(Boolean).length;
  return { success, failed: results.length - success };
}

export interface RichMenuImageInput {
  buffer: Buffer;
  mimeType: string;
}

export interface RichMenuIds {
  guest: string;
  member: string;
  admin: string;
}

export interface CreateAllRichMenusResult {
  ids: RichMenuIds;
  defaultSet: boolean;
  defaultError?: string;
}

// สร้างเมนู Guest/Member/Admin ทั้งชุดใหม่ ลบของเดิม (ถ้ามี ID เก่าส่งมาใน previousIds) ทิ้งก่อน แล้ว
// ตั้งเมนู Guest เป็นค่าเริ่มต้นของผู้ใช้ทุกคน (ผู้ใช้ใหม่/ยังไม่ผูกบัญชีจะเห็นเมนูนี้ก่อนเสมอ) — ถ้าขั้นตอน
// ตั้งค่าเริ่มต้นล้มเหลว ไม่ throw ทิ้ง ID ที่เพิ่งสร้างไป (เมนูสร้างสำเร็จแล้วจริง แค่ยังไม่ได้ผูกเป็นค่า
// เริ่มต้นเฉยๆ) เพื่อให้ผู้เรียกบันทึก ID เหล่านี้ไว้ได้แม้ขั้นตอนสุดท้ายจะพลาด
export interface RichMenuUrls {
  liffLoginUrl: string;
  liffPaymentUrl: string;
  liffProfileUrl: string;
  liffRepairUrl: string;
  liffRoomsUrl: string;
  liffBookingUrl: string;
  contactUrl: string;
}

export async function createAllRichMenus(
  token: string,
  urls: RichMenuUrls,
  images: { guest: RichMenuImageInput; member: RichMenuImageInput; admin: RichMenuImageInput },
  previousIds?: Partial<RichMenuIds>
): Promise<CreateAllRichMenusResult> {
  if (previousIds?.guest) await deleteRichMenu(token, previousIds.guest);
  if (previousIds?.member) await deleteRichMenu(token, previousIds.member);
  if (previousIds?.admin) await deleteRichMenu(token, previousIds.admin);

  const guestId = await createOne(token, "Guest Menu", "เมนูผู้มาเยือน", guestAreas(urls.liffLoginUrl, urls.contactUrl, urls.liffRoomsUrl, urls.liffBookingUrl), images.guest.buffer, images.guest.mimeType);
  const memberId = await createOne(token, "Member Menu", "เมนูสมาชิก", memberAreas(urls), images.member.buffer, images.member.mimeType);
  const adminId = await createOne(token, "Admin Menu", "เมนูผู้ดูแลระบบ", adminAreas(), images.admin.buffer, images.admin.mimeType);

  const ids: RichMenuIds = { guest: guestId, member: memberId, admin: adminId };

  const setDefaultRes = await fetch(`${LINE_DEFAULT_RICHMENU_URL}/${guestId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!setDefaultRes.ok) {
    const text = await setDefaultRes.text().catch(() => "");
    return { ids, defaultSet: false, defaultError: `ตั้งเมนู Guest เป็นค่าเริ่มต้นไม่สำเร็จ (${setDefaultRes.status}): ${text}` };
  }

  return { ids, defaultSet: true };
}
