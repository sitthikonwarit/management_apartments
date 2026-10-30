import type { YearFormat } from "./yearFormat";

// ── สัญญาเช่า: ข้อมูลตั้งต้น + แม่แบบข้อความ (แก้ได้ที่ Settings > สัญญาเช่า) + ตัวแปลงเป็นข้อความสำเร็จรูป ──
// ตัวแปรในแม่แบบเขียนเป็น {{ชื่อตัวแปร}} — ตัวแปรที่ไม่มีข้อมูลจะแสดงเป็นเส้นประให้เขียนเองหลังพิมพ์ (เหมือนสัญญาตัวอย่าง)

export interface ContractConfig {
  lessorName: string;        // ชื่อผู้ให้เช่า
  signPlace: string;         // "ทำที่" (สถานที่ทำสัญญา)
  propertyNo: string;        // อาคารเลขที่
  propertyRoad: string;
  propertySubdistrict: string;
  propertyDistrict: string;
  propertyProvince: string;
  purpose: string;           // เพื่อเป็นประโยชน์ในการ ...
  defaultArea: string;       // ขนาดพื้นที่ (ถ้าผู้เช่าไม่ได้ระบุเอง)
  defaultDeposit: number;    // เงินประกันตั้งต้น (ถ้าผู้เช่าไม่ได้ระบุเอง)
  electricText: string;      // เช่น "หน่วยละ 7 บาท" (ว่าง = ใช้ค่าไฟจากหน้าตั้งค่าระบบ)
  waterText: string;         // เช่น "หน่วยแรก 50 บาท หน่วยต่อไปหน่วยละ 17 บาท" (ว่าง = หน่วยละตามหน้าตั้งค่าระบบ)
  commonFeeText: string;     // เช่น "100 บาท ต่อเดือน"
  interestPercent: number;   // ดอกเบี้ยค่าเช่าค้าง (% ต่อปี)
  moveOutFine: number;       // ค่าปรับไม่ส่งมอบคืน (บาท/วัน)
  lateFee: number;           // ค่าปรับชำระช้า (บาท/วัน) — 0 = ใช้ค่าปรับจากหน้าตั้งค่าระบบ
  witness1: string;
  witness2: string;
  template: string;          // ข้อความสัญญาทั้งฉบับ
}

export const DEFAULT_CONTRACT_TEMPLATE = `# สัญญาเช่าอาคารและที่ดิน

> ทำที่ {{signPlace}}
> วันที่ {{contractDate}}

สัญญาเช่าฉบับนี้ทำขึ้นระหว่าง {{lessorName}} ซึ่งต่อไปในสัญญาจะเรียกว่า “ผู้ให้เช่า” ฝ่ายหนึ่ง กับ {{tenantName}} อยู่บ้านเลขที่ {{tenantHouseNo}} ซอย {{tenantSoi}} ถนน {{tenantRoad}} แขวง/ตำบล {{tenantSubdistrict}} เขต/อำเภอ {{tenantDistrict}} จังหวัด {{tenantProvince}} ถือบัตรประจำตัวประชาชนเลขที่ {{idCard}} ออกให้เมื่อวันที่ {{idCardIssued}} เบอร์โทร {{phone}} ซึ่งต่อไปในสัญญาจะเรียกว่า “ผู้เช่า” อีกฝ่ายหนึ่ง คู่สัญญาทั้งสองฝ่ายตกลงทำสัญญากันโดยมีเงื่อนไขและรายละเอียดดังต่อไปนี้

ข้อ ๑ ผู้ให้เช่าตกลงให้เช่าและผู้เช่าตกลงเช่าอาคาร คือ อาคารเลขที่ {{propertyNo}} ห้อง {{roomNumber}} ถนน {{propertyRoad}} แขวง {{propertySubdistrict}} เขต {{propertyDistrict}} จังหวัด {{propertyProvince}} เพื่อเป็นประโยชน์ในการ {{purpose}} ขนาดของพื้นที่ {{area}} กำหนดระยะเวลาเช่าตั้งแต่วันที่ {{contractStart}} ถึงวันที่ {{contractEnd}}

ข้อ ๒ ผู้เช่าตกลงชำระเงินค่าเช่าให้ผู้ให้เช่าเป็นรายเดือน โดยกำหนดชำระภายในวันที่ {{dueDay}} ของแต่ละเดือน ทุกเดือน ในอัตราเช่าเดือนละ {{rent}} บาท ( {{rentText}} )

ข้อ ๓ การชำระค่าเช่านั้น ผู้เช่าจะต้องนำเงินค่าเช่าไปชำระกับผู้ให้เช่า ณ ภูมิลำเนาของผู้ให้เช่า

ข้อ ๔ ผู้เช่าจะใช้ทรัพย์สินที่เช่าเพื่อการอย่างอื่นนอกจากที่ระบุไว้ในข้อ ๑ แห่งสัญญานี้ได้โดยได้รับความยินยอมเป็นหนังสือจากผู้ให้เช่า

ข้อ ๕ ผู้เช่าจะดูแลรักษาอาคารที่เช่าให้อยู่ในสภาพที่ดี สะอาด เรียบร้อย อย่างเช่นวิญญูชนจะพึงปฏิบัติในการรักษาทรัพย์สินของตน ด้วยค่าใช้จ่ายของตนเอง

ข้อ ๖ ผู้เช่าจะโอนสิทธิการเช่าตามสัญญานี้หรือจะนำทรัพย์ที่เช่าไปให้ผู้อื่นเช่าช่วงไม่ได้

ข้อ ๗ ผู้เช่าจะไม่แก้ไข เปลี่ยนแปลง หรือต่อเติมอาคาร เว้นแต่จะได้รับความยินยอมจากผู้ให้เช่าเป็นลายลักษณ์อักษรเสียก่อน ทรัพย์สินที่ติดตรึงตรากับอาคารอันเป็นผลจากการตกแต่งภายใน หรือการแก้ไขเปลี่ยนแปลงใดๆ ที่ผู้เช่าได้กระทำไปโดยได้รับความยินยอมแล้วนั้น ให้ตกเป็นกรรมสิทธิ์ของผู้ให้เช่า โดยผู้เช่าจะไม่เรียกร้องค่าชดเชยใดๆ ทั้งสิ้น

ข้อ ๘ ผู้เช่าต้องรับผิดในบรรดาความเสียหายหรือบุบสลายใดๆ อันเกิดขึ้นแก่ทรัพย์สินที่เช่า เพราะความผิดของผู้เช่าหรือผู้เช่าช่วงหรือบุคคลซึ่งอยู่กับผู้เช่า โดยจะคิดค่าซ่อมบำรุงตามความเสียหายที่เกิดขึ้น

ข้อ ๙ ผู้เช่าจะยินยอมให้ผู้ให้เช่าหรือตัวแทนที่ได้รับมอบอำนาจจากผู้ให้เช่า เข้าตรวจตราอาคารได้เป็นครั้งคราวในระยะเวลาอันสมควร

ข้อ ๑๐ ผู้เช่าตกลงชำระค่าไฟฟ้า เป็นเงิน{{electricText}} ค่าน้ำประปา{{waterText}} ค่าบริการส่วนกลาง {{commonFeeText}}

---

ข้อ ๑๑ ผู้เช่าตกลงชำระค่าภาษีต่างๆ ที่เกิดขึ้นและเกี่ยวกับทรัพย์สินที่เช่าตลอดอายุการเช่า

ข้อ ๑๒ ผู้เช่าตกลงวางเงินประกันไว้ให้แก่ผู้ให้เช่าในวันทำสัญญานี้ เป็นเงิน {{deposit}} บาท ( {{depositText}} ) และผู้ให้เช่าได้รับเงินประกันดังกล่าวไว้เรียบร้อยแล้ว เงินประกันดังกล่าวเป็นเงินความรับผิดตามสัญญาของผู้เช่าซึ่งผู้ให้เช่าจะคืนให้แก่ผู้เช่าในวันที่ผู้เช่าได้ย้ายบริวารและทรัพย์สินออกจากสถานที่เช่าเรียบร้อยแล้วหลังจากสิ้นสุดสัญญาเช่า และไม่ติดค้างชำระค่าเช่า หรือมีหนี้สินอื่นค้างชำระผู้ให้เช่า

ข้อ ๑๓ ผู้ให้เช่าจะใช้สิทธิบอกกล่าวให้ผู้เช่าปฏิบัติตามสัญญานี้ หรือบอกเลิกสัญญาหรือเรียกค่าเสียหายกับผู้เช่าได้เมื่อผู้เช่าผิดสัญญาข้อหนึ่งข้อใดตามสัญญานี้

ข้อ ๑๔ การเช่าตามสัญญานี้ย่อมสิ้นสุดลงก่อนครบกำหนดระยะเวลาที่ระบุไว้ในสัญญาเมื่อปรากฏว่าทรัพย์สินที่เช่าพินาศโดยสิ้นเชิงหรือเป็นส่วนใหญ่เพราะอัคคีภัย หรือภัยอื่นใด

ข้อ ๑๕ ผู้เช่ายอมชดใช้ดอกเบี้ยในอัตราร้อยละ {{interestPercent}} ต่อปี ของยอดเงินค่าเช่าที่ค้างชำระผู้ให้เช่า และค่าใช้จ่ายต่างๆ ที่ผู้ให้เช่าต้องเสียไปเพื่อการทวงถามให้ชำระเงินค่าเช่าอีกด้วย

ข้อ ๑๖ คู่สัญญาตกลงให้สัญญานี้เลิกกัน เมื่อผู้เช่าถูกพิทักษ์ทรัพย์หรือล้มละลายตามกฎหมาย

ข้อ ๑๗ ผู้เช่าต้องขนย้ายทรัพย์สินและบริวารของผู้เช่าและส่งมอบทรัพย์สินที่เช่าคืนให้แก่ผู้ให้เช่าในสภาพปกติทันทีเมื่อสัญญานี้สิ้นสุดลงหรือเลิกกัน หากผู้เช่าไม่ปฏิบัติตามความในข้อนี้ผู้เช่ายอมชดใช้ค่าปรับให้แก่ผู้ให้เช่าในอัตราวันละ {{moveOutFine}} บาท ( {{moveOutFineText}} ) นับแต่วันที่สัญญาเช่านี้เลิกกันหรือสัญญาเช่านี้สิ้นสุดลง จนกว่าจะมีการส่งมอบทรัพย์สินที่เช่าคืนให้แก่ผู้ให้เช่าแล้ว

ข้อ ๑๘ ในวันทำสัญญานี้ผู้เช่าได้ตรวจตราทรัพย์สินที่เช่าแล้วเห็นว่ามีสภาพปกติดี

ข้อ ๑๙ การแก้ไข เพิ่มเติมหรือเปลี่ยนแปลงสัญญานี้ไม่ว่าส่วนหนึ่งส่วนใด หรือทั้งหมดจะต้องทำเป็นหนังสือ และลงลายมือชื่อของคู่สัญญาทั้งสองฝ่าย ไว้เป็นสำคัญจึงจะมีผลใช้บังคับระหว่างคู่สัญญาได้

ข้อ ๒๐ หากชำระเงินค่าเช่าช้ากว่าวันที่กำหนด โดยไม่มีการแจ้งสาเหตุ จะมีค่าปรับให้แก่ผู้ให้เช่าในอัตราวันละ {{lateFee}} บาท ( {{lateFeeText}} )

ผู้ให้เช่าได้ส่งมอบทรัพย์สินที่เช่าให้แก่ผู้เช่าแล้ว คู่สัญญาเห็นว่าถูกต้องตามเจตนาแห่งตน และทั้งสองฝ่ายเข้าใจข้อความแห่งสัญญานี้ทั้งหมดดีแล้ว จึงลงลายมือชื่อไว้เป็นหลักฐานสำคัญต่อหน้าพยาน และต่างฝ่ายต่างยึดถือไว้ฝ่ายละฉบับ

~ ลงชื่อ......................................................ผู้ให้เช่า
~ ( {{lessorName}} )

~ ลงชื่อ......................................................ผู้เช่า
~ ( {{tenantName}} )

~ ลงชื่อ......................................................พยาน
~ ( {{witness1}} )

~ ลงชื่อ......................................................พยาน
~ ( {{witness2}} )
`;

export const DEFAULT_CONTRACT: ContractConfig = {
  lessorName: "", signPlace: "", propertyNo: "", propertyRoad: "", propertySubdistrict: "", propertyDistrict: "", propertyProvince: "",
  purpose: "ห้องพักอาศัย", defaultArea: "", defaultDeposit: 0,
  electricText: "", waterText: "", commonFeeText: "",
  interestPercent: 15, moveOutFine: 100, lateFee: 0,
  witness1: "", witness2: "",
  template: DEFAULT_CONTRACT_TEMPLATE,
};

// รายการตัวแปรที่ใช้ได้ในแม่แบบ (แสดงเป็นคู่มือในหน้า Settings)
export const CONTRACT_VARIABLES: { key: string; label: string }[] = [
  { key: "lessorName", label: "ชื่อผู้ให้เช่า" }, { key: "signPlace", label: "ทำที่" }, { key: "contractDate", label: "วันที่ทำสัญญา" },
  { key: "tenantName", label: "ชื่อผู้เช่า" }, { key: "tenantHouseNo", label: "บ้านเลขที่ผู้เช่า" }, { key: "tenantSoi", label: "ซอยผู้เช่า" },
  { key: "tenantRoad", label: "ถนนผู้เช่า" }, { key: "tenantSubdistrict", label: "แขวง/ตำบลผู้เช่า" }, { key: "tenantDistrict", label: "เขต/อำเภอผู้เช่า" },
  { key: "tenantProvince", label: "จังหวัดผู้เช่า" }, { key: "idCard", label: "เลขบัตรประชาชน" }, { key: "idCardIssued", label: "วันออกบัตร" },
  { key: "phone", label: "เบอร์โทรผู้เช่า" }, { key: "propertyNo", label: "อาคารเลขที่" }, { key: "roomNumber", label: "เลขห้อง" },
  { key: "propertyRoad", label: "ถนน (อาคาร)" }, { key: "propertySubdistrict", label: "แขวง (อาคาร)" }, { key: "propertyDistrict", label: "เขต (อาคาร)" },
  { key: "propertyProvince", label: "จังหวัด (อาคาร)" }, { key: "purpose", label: "วัตถุประสงค์การเช่า" }, { key: "area", label: "ขนาดพื้นที่" },
  { key: "contractStart", label: "วันเริ่มสัญญา" }, { key: "contractEnd", label: "วันสิ้นสุดสัญญา" }, { key: "dueDay", label: "วันครบกำหนดชำระ" },
  { key: "rent", label: "ค่าเช่า/เดือน" }, { key: "rentText", label: "ค่าเช่า (ตัวอักษร)" }, { key: "electricText", label: "ค่าไฟ" },
  { key: "waterText", label: "ค่าน้ำ" }, { key: "commonFeeText", label: "ค่าบริการส่วนกลาง" }, { key: "deposit", label: "เงินประกัน" },
  { key: "depositText", label: "เงินประกัน (ตัวอักษร)" }, { key: "interestPercent", label: "ดอกเบี้ย %" }, { key: "moveOutFine", label: "ค่าปรับไม่ส่งมอบคืน/วัน" },
  { key: "moveOutFineText", label: "ค่าปรับไม่ส่งมอบคืน (ตัวอักษร)" }, { key: "lateFee", label: "ค่าปรับชำระช้า/วัน" }, { key: "lateFeeText", label: "ค่าปรับชำระช้า (ตัวอักษร)" },
  { key: "witness1", label: "พยาน 1" }, { key: "witness2", label: "พยาน 2" },
];

// ── จำนวนเงินเป็นตัวอักษรไทย (เช่น 2000 → "สองพันบาทถ้วน") ──
const DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const UNITS = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];
function readInt(n: number): string {
  if (n === 0) return "";
  if (n >= 1000000) return readInt(Math.floor(n / 1000000)) + "ล้าน" + readInt(n % 1000000);
  const s = String(n);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[i]);
    const pos = s.length - i - 1;
    if (d === 0) continue;
    if (pos === 0 && d === 1 && s.length > 1) out += "เอ็ด";
    else if (pos === 1 && d === 2) out += "ยี่สิบ";
    else if (pos === 1 && d === 1) out += "สิบ";
    else out += DIGITS[d] + UNITS[pos];
  }
  return out;
}
export function thaiBahtText(amount: number): string {
  const n = Math.round((Number(amount) || 0) * 100) / 100;
  if (n <= 0) return "";
  const baht = Math.floor(n);
  const satang = Math.round((n - baht) * 100);
  const bahtText = baht === 0 ? "" : readInt(baht) + "บาท";
  const satangText = satang === 0 ? "ถ้วน" : readInt(satang) + "สตางค์";
  return bahtText + satangText;
}

const THAI_MONTHS_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
export function longThaiDate(iso: string | undefined | null, yearFormat: YearFormat): string {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${d} ${THAI_MONTHS_FULL[m - 1] ?? ""} ${yearFormat === "CE" ? y : y + 543}`;
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const num = (n: number) => (Number(n) || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 });

// รวบรวมค่าตัวแปรจากผู้เช่า/ห้อง/ค่าตั้งค่า — ค่าว่าง = ปล่อยเป็นเส้นประ
export function buildContractVars(opts: {
  tenant: any; room: any; contract: ContractConfig; yearFormat: YearFormat;
  electricRate: number; waterRate: number; overdueDay: number; overdueAmount: number;
}): Record<string, string> {
  const { tenant: t, room: r, contract: c, yearFormat } = opts;
  const rent = Number(r?.price) || 0;
  const deposit = Number(t?.deposit) || Number(c.defaultDeposit) || 0;
  const lateFee = Number(c.lateFee) || Number(opts.overdueAmount) || 0;
  const moveOut = Number(c.moveOutFine) || 0;
  const dueDay = Number(opts.overdueDay);
  return {
    lessorName: c.lessorName, signPlace: c.signPlace,
    contractDate: longThaiDate(t?.contractStartDate || todayISO(), yearFormat),
    tenantName: `${t?.title ?? ""}${t?.firstName ?? ""} ${t?.lastName ?? ""}`.trim(),
    tenantHouseNo: t?.houseNo ?? "", tenantSoi: t?.soi ?? "", tenantRoad: t?.road ?? "",
    tenantSubdistrict: t?.tambon ?? "", tenantDistrict: t?.amphoe ?? "", tenantProvince: t?.province ?? "",
    idCard: t?.idLicense ?? "", idCardIssued: longThaiDate(t?.idCardIssued, yearFormat), phone: t?.tel ?? "",
    propertyNo: c.propertyNo, roomNumber: r?.number ?? "", propertyRoad: c.propertyRoad,
    propertySubdistrict: c.propertySubdistrict, propertyDistrict: c.propertyDistrict, propertyProvince: c.propertyProvince,
    purpose: c.purpose, area: t?.contractArea || c.defaultArea,
    contractStart: longThaiDate(t?.contractStartDate, yearFormat), contractEnd: longThaiDate(t?.contractEndDate, yearFormat),
    dueDay: dueDay === 0 ? "สิ้น" : String(dueDay || 5),
    rent: rent ? num(rent) : "", rentText: rent ? thaiBahtText(rent) : "",
    electricText: c.electricText || (opts.electricRate ? `หน่วยละ ${num(opts.electricRate)} บาท` : ""),
    waterText: c.waterText || (opts.waterRate ? `หน่วยละ ${num(opts.waterRate)} บาท` : ""),
    commonFeeText: c.commonFeeText,
    deposit: deposit ? num(deposit) : "", depositText: deposit ? thaiBahtText(deposit) : "",
    interestPercent: c.interestPercent ? String(c.interestPercent) : "",
    moveOutFine: moveOut ? num(moveOut) : "", moveOutFineText: moveOut ? thaiBahtText(moveOut) : "",
    lateFee: lateFee ? num(lateFee) : "", lateFeeText: lateFee ? thaiBahtText(lateFee) : "",
    witness1: c.witness1, witness2: c.witness2,
  };
}

// ข้อความแม่แบบ → ส่วนย่อยที่เรนเดอร์ได้ (ข้อความ/ช่องว่างเส้นประ)
export type ContractPart = { text: string; blank?: boolean };
export type ContractBlock =
  | { kind: "title" | "right" | "para" | "sign"; parts: ContractPart[] }
  | { kind: "space" | "pagebreak" };

function fillLine(line: string, vars: Record<string, string>): ContractPart[] {
  const parts: ContractPart[] = [];
  const re = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) parts.push({ text: line.slice(last, m.index) });
    const v = (vars[m[1]] ?? "").trim();
    parts.push(v ? { text: v } : { text: "", blank: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push({ text: line.slice(last) });
  return parts;
}

export function renderContract(template: string, vars: Record<string, string>): ContractBlock[] {
  const blocks: ContractBlock[] = [];
  for (const raw of template.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") { blocks.push({ kind: "space" }); continue; }
    if (line.trim() === "---") { blocks.push({ kind: "pagebreak" }); continue; }
    if (line.startsWith("# ")) blocks.push({ kind: "title", parts: fillLine(line.slice(2), vars) });
    else if (line.startsWith("> ")) blocks.push({ kind: "right", parts: fillLine(line.slice(2), vars) });
    else if (line.startsWith("~ ")) blocks.push({ kind: "sign", parts: fillLine(line.slice(2), vars) });
    else blocks.push({ kind: "para", parts: fillLine(line, vars) });
  }
  return blocks;
}
