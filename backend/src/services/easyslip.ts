// ── EasySlip (https://easyslip.com) — สร้าง QR PromptPay ระบุยอดเอง + ตรวจสลิปโอนเงินอัตโนมัติ ──
// เอกสาร API: https://document.easyslip.com/th

const QR_GENERATE_URL = "https://api.easyslip.com/v1/qr/generate";
const VERIFY_URL = "https://api.easyslip.com/v2/verify/bank";

export interface EasySlipQrResult {
  image: string; // Base64 PNG (ไม่มี data: prefix)
  mime: string;
  payload: string;
}

// PromptPay ID เป็นได้ทั้งเบอร์มือถือ (10 หลัก ขึ้นต้น 0) หรือเลขบัตรประชาชน (13 หลัก) — EasySlip ใช้ชื่อ
// field ต่างกันตามประเภท (msisdn / natId) ต้องเดาจากความยาวเลขที่กรอกไว้ในหน้า Settings
function promptPayField(id: string): { msisdn: string } | { natId: string } {
  const digits = (id || "").replace(/\D/g, "");
  return digits.length === 13 ? { natId: digits } : { msisdn: digits };
}

export async function generatePromptPayQr(apiKey: string, promptPayId: string, amount: number): Promise<EasySlipQrResult> {
  const res = await fetch(QR_GENERATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ type: "PROMPTPAY", ...promptPayField(promptPayId), amount: Math.round(amount * 100) / 100 }),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || !json?.data) {
    throw new Error(json?.message || `สร้าง QR ไม่สำเร็จ (${res.status})`);
  }
  return json.data;
}

export interface EasySlipVerifyResult {
  success: boolean;
  isDuplicate: boolean;
  amount: number;
  transRef: string;
  message?: string;
}

// ตรวจสลิปจากรูปภาพ (base64 ดิบ ไม่มี data: prefix) — checkDuplicate: true เสมอ กันสลิปเดิมถูกใช้ซ้ำ
// ยอดที่ตรวจแล้ว (rawSlip.amount.amount) ให้ผู้เรียกเทียบเองกับรายการรอชำระที่มีอยู่ (ดู services/payments.ts)
// แทนที่จะส่ง matchAmount ในคำขอ เพราะผู้เช่าอาจมี "รายการรอชำระ" มากกว่า 1 รายการพร้อมกัน ต้องลองจับคู่หลาย
// รายการ การเรียก API แค่ครั้งเดียวต่อสลิปประหยัดโควตากว่าเรียกซ้ำทีละรายการที่รออยู่
export async function verifySlipImage(apiKey: string, base64: string): Promise<EasySlipVerifyResult> {
  const res = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ base64, checkDuplicate: true }),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    return { success: false, isDuplicate: false, amount: 0, transRef: "", message: json?.error?.message || `ตรวจสลิปไม่สำเร็จ (${res.status})` };
  }
  return {
    success: true,
    isDuplicate: !!json.data?.isDuplicate,
    amount: Number(json.data?.rawSlip?.amount?.amount) || 0,
    transRef: String(json.data?.rawSlip?.transRef ?? ""),
  };
}
