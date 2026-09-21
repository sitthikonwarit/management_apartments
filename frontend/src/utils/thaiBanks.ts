// ── รายชื่อธนาคารไทยยอดนิยม พร้อมสีประจำธนาคาร — ใช้ในหน้า Settings > บัญชีรับชำระเงิน ให้เลือกจากลิสต์แทน
// การพิมพ์ชื่อ+อัปโหลดโลโก้เอง ไม่ได้ใช้ไฟล์โลโก้จริงของแต่ละธนาคาร (กันปัญหาลิขสิทธิ์/พึ่งพา asset ภายนอกที่
// อาจล่มหรือหาย) แต่วาดเป็นตราสัญลักษณ์วงกลมสีประจำธนาคาร + อักษรย่อแทน (ดู generateBankBadge ด้านล่าง) —
// สีที่ใช้เป็นสีที่คนทั่วไปคุ้นตาจากการรับรู้แบรนด์สาธารณะ (เช่น สีเขียวกสิกร สีม่วง SCB) ไม่ใช่การคัดลอกโลโก้จริง
export interface ThaiBank {
  code: string; // อักษรย่อ 2-4 ตัว ใช้แสดงในตราสัญลักษณ์วงกลม
  name: string; // ชื่อเต็มภาษาไทย
  color: string; // สีประจำธนาคาร (hex)
}

export const THAI_BANKS: ThaiBank[] = [
  { code: "BBL", name: "ธนาคารกรุงเทพ", color: "#1e4598" },
  { code: "KBank", name: "ธนาคารกสิกรไทย", color: "#138f2d" },
  { code: "KTB", name: "ธนาคารกรุงไทย", color: "#1ba5e1" },
  { code: "SCB", name: "ธนาคารไทยพาณิชย์", color: "#4e2e7f" },
  { code: "BAY", name: "ธนาคารกรุงศรีอยุธยา", color: "#fec43b" },
  { code: "ttb", name: "ธนาคารทหารไทยธนชาต", color: "#00519c" },
  { code: "GSB", name: "ธนาคารออมสิน", color: "#eb198d" },
  { code: "BAAC", name: "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร (ธ.ก.ส.)", color: "#4b9b1d" },
  { code: "GHB", name: "ธนาคารอาคารสงเคราะห์", color: "#f57d20" },
  { code: "CIMB", name: "ธนาคารซีไอเอ็มบีไทย", color: "#7e2f36" },
  { code: "TISCO", name: "ธนาคารทิสโก้", color: "#01518c" },
  { code: "KKP", name: "ธนาคารเกียรตินาคินภัทร", color: "#199fd9" },
  { code: "LHB", name: "ธนาคารแลนด์ แอนด์ เฮ้าส์", color: "#652d90" },
  { code: "ICBC", name: "ธนาคารไอซีบีซี (ไทย)", color: "#c8161d" },
  { code: "UOB", name: "ธนาคารยูโอบี", color: "#0b3979" },
];

// วาดตราสัญลักษณ์วงกลมสีประจำธนาคาร + อักษรย่อ ด้วย canvas แล้วคืนเป็น PNG data URI — ใช้แทนโลโก้จริงที่ต้อง
// อัปโหลดเอง (เลือกจากลิสต์แล้วได้รูปใช้ได้ทันที ไม่ต้องหาไฟล์โลโก้มาอัปโหลดเอง) ขนาดเท่ากับโลโก้ที่อัปโหลดเอง
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
  // ปรับขนาดตัวอักษรตามความยาวอักษรย่อ กันล้นวงกลมตอนอักษรย่อยาว (เช่น "BAAC")
  const fontSize = bank.code.length > 4 ? size * 0.22 : bank.code.length > 3 ? size * 0.26 : size * 0.32;
  ctx.font = `700 ${fontSize}px 'Sarabun', Tahoma, sans-serif`;
  ctx.fillText(bank.code, size / 2, size / 2 + 1);
  return canvas.toDataURL("image/png");
}
