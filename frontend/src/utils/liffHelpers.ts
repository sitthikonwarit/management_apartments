// LIFF URL รูปแบบ https://liff.line.me/{liffId} — ต้องดึง liffId ออกมาก่อนเรียก liff.init() เอง เพราะ
// LINE ไม่ได้ส่ง liffId มาให้หน้าเว็บปลายทางรู้อัตโนมัติ (ดูคอมเมนต์ใน LiffLoginPage/LiffPaymentPage)
export function extractLiffId(liffUrl: string): string {
  try {
    return new URL(liffUrl).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
}
