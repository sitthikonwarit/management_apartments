// ── รายชื่อธนาคาร/ผู้ให้บริการชำระเงินไทยยอดนิยม พร้อมโลโก้จริง — ใช้ในหน้า Settings > บัญชีรับชำระเงิน ให้
// เลือกจากลิสต์แทนการพิมพ์ชื่อ+อัปโหลดโลโก้เอง โลโก้ (public/bank-logos/*.png) ดาวน์โหลดมาจาก
// https://github.com/casperstack/thai-banks-logo (รวมโลโก้ธนาคารไทยไว้ให้ใช้งานแบบนี้โดยเฉพาะ) เก็บไว้เป็น
// asset ในเครื่องแทนการลิงก์ไป GitHub ตรงๆ กันเว็บช้า/ใช้ไม่ได้ถ้า GitHub ล่มหรือลบไฟล์ทีหลัง
export interface ThaiBank {
  code: string; // สัญลักษณ์ธนาคาร ตรงกับชื่อไฟล์ใน public/bank-logos/
  name: string; // ชื่อเต็มภาษาไทย
  color: string; // สีประจำธนาคาร (สำรองไว้ใช้ตอนโลโก้โหลดไม่ขึ้น)
}

export const THAI_BANKS: ThaiBank[] = [
  { code: "BBL", name: "ธนาคารกรุงเทพ", color: "#1e4598" },
  { code: "KBANK", name: "ธนาคารกสิกรไทย", color: "#138f2d" },
  { code: "KTB", name: "ธนาคารกรุงไทย", color: "#1ba5e1" },
  { code: "SCB", name: "ธนาคารไทยพาณิชย์", color: "#4e2e7f" },
  { code: "BAY", name: "ธนาคารกรุงศรีอยุธยา", color: "#fec43b" },
  { code: "TTB", name: "ธนาคารทีเอ็มบีธนชาต", color: "#00519c" },
  { code: "GSB", name: "ธนาคารออมสิน", color: "#eb198d" },
  { code: "BAAC", name: "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร (ธ.ก.ส.)", color: "#4b9b1d" },
  { code: "GHB", name: "ธนาคารอาคารสงเคราะห์", color: "#f57d20" },
  { code: "CIMB", name: "ธนาคารซีไอเอ็มบีไทย", color: "#7e2f36" },
  { code: "CITI", name: "ธนาคารซิตี้แบงก์", color: "#003b70" },
  { code: "HSBC", name: "ธนาคารเอชเอสบีซี", color: "#db0011" },
  { code: "IBANK", name: "ธนาคารอิสลามแห่งประเทศไทย", color: "#00693e" },
  { code: "ICBC", name: "ธนาคารไอซีบีซี (ไทย)", color: "#c8161d" },
  { code: "TISCO", name: "ธนาคารทิสโก้", color: "#01518c" },
  { code: "KKP", name: "ธนาคารเกียรตินาคินภัทร", color: "#199fd9" },
  { code: "LHB", name: "ธนาคารแลนด์ แอนด์ เฮ้าส์", color: "#652d90" },
  { code: "TCRB", name: "ธนาคารไทยเครดิต", color: "#f7941d" },
  { code: "UOB", name: "ธนาคารยูโอบี", color: "#0b3979" },
  { code: "TrueMoney", name: "ทรูมันนี่", color: "#f7590d" },
  { code: "PromptPay", name: "พร้อมเพย์", color: "#0e4a8e" },
];

export function bankLogoUrl(code: string): string {
  return `/bank-logos/${code}.png`;
}

// วาดตราสัญลักษณ์วงกลมสีประจำธนาคาร + อักษรย่อ — ใช้เป็น fallback เฉพาะตอนโลโก้จริง (bankLogoUrl) โหลดไม่ขึ้น
// เท่านั้น (เช่นไฟล์ในเครื่องหาย/ธนาคารนอกลิสต์ที่ผู้ใช้กรอกชื่อเอง) ไม่ใช่ค่าเริ่มต้นอีกต่อไป
export function generateBankBadge(bank: ThaiBank, size = 120): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = bank.color;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = bank.code.slice(0, 4);
  const fontSize = label.length > 4 ? size * 0.22 : label.length > 3 ? size * 0.26 : size * 0.32;
  ctx.font = `700 ${fontSize}px 'Sarabun', Tahoma, sans-serif`;
  ctx.fillText(label, size / 2, size / 2 + 1);
  return canvas.toDataURL("image/png");
}

// โหลดโลโก้จริงจาก public/bank-logos/ มาแปลงเป็น data URI (base64) — ต้องแปลงเป็น data URI เพราะฟิลด์
// bankLogoImage ของแต่ละบัญชีเก็บเป็น data URI เสมอ (เหมือนโลโก้ที่อัปโหลดเอง) ไม่ได้เก็บเป็น URL เฉยๆ ถ้าโหลด
// ไม่สำเร็จ (ไฟล์หาย/เน็ตมีปัญหา) fallback ไปใช้ generateBankBadge แทนอัตโนมัติ
export async function loadBankLogoDataUri(bank: ThaiBank): Promise<string> {
  try {
    const res = await fetch(bankLogoUrl(bank.code));
    if (!res.ok) throw new Error("โหลดโลโก้ไม่สำเร็จ");
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return generateBankBadge(bank);
  }
}
