import type { ContractConfig, ContractCustomVar } from "../utils/contractTemplate";

// แผงข้อมูลที่ใช้ในสัญญา (อยู่ข้างตัวแก้ไขเต็มหน้า): ค่าคงที่ของหอพัก/ผู้ให้เช่า + ข้อมูลที่เพิ่มเองได้ไม่จำกัด
// ข้อมูลที่เพิ่มเองแทรกในเอกสารเป็นชิปสีฟ้าเหมือนข้อมูลอัตโนมัติ (ไว้ใส่ค่าที่ใช้ซ้ำๆ เช่น เบอร์ผู้ให้เช่า เลขบัญชี ชื่อพยาน)
const TEXT_FIELDS: [keyof ContractConfig, string, string][] = [
  ["lessorName", "ชื่อผู้ให้เช่า", "เช่น นางสมพร ลัมภเวส"],
  ["signPlace", "ทำที่ (สถานที่ทำสัญญา)", "เช่น 259 ซอยอ่อนนุช 39 แขวงพัฒนาการ เขตสวนหลวง กรุงเทพมหานคร"],
  ["propertyNo", "อาคารเลขที่", ""], ["propertyRoad", "ถนน (อาคาร)", ""],
  ["propertySubdistrict", "แขวง/ตำบล (อาคาร)", ""], ["propertyDistrict", "เขต/อำเภอ (อาคาร)", ""],
  ["propertyProvince", "จังหวัด (อาคาร)", ""], ["purpose", "เพื่อเป็นประโยชน์ในการ", "ห้องพักอาศัย"],
  ["defaultArea", "ขนาดพื้นที่ (ตั้งต้น)", "เช่น 24 ตร.ม."],
  ["electricText", "ค่าไฟ (ข้อความ)", "ว่าง = ใช้ค่าไฟจากหน้าระบบบิล"],
  ["waterText", "ค่าน้ำ (ข้อความ)", "เช่น หน่วยแรก 50 บาท หน่วยต่อไปหน่วยละ 17 บาท"],
  ["commonFeeText", "ค่าบริการส่วนกลาง", "เช่น 100 บาท ต่อเดือน"],
  ["earlyMoveOutText", "ย้ายออกก่อน (เงื่อนไขท้ายสัญญา)", "เช่น ครบ 6 เดือน — ว่าง = เว้นเป็นจุด"],
  ["witness1", "พยาน 1", ""], ["witness2", "พยาน 2", ""],
];
const NUM_FIELDS: [keyof ContractConfig, string][] = [
  ["defaultDeposit", "เงินประกัน (ตั้งต้น บาท)"], ["interestPercent", "ดอกเบี้ยค่าเช่าค้าง (% ต่อปี)"],
  ["moveOutFine", "ค่าปรับไม่ส่งมอบคืน (บาท/วัน)"], ["lateFee", "ค่าปรับชำระช้า (บาท/วัน, 0 = ใช้ค่าในหน้าระบบบิล)"],
];

export default function ContractDataPanel({ cfg, onChange, onInsert }: {
  cfg: ContractConfig; onChange: (c: ContractConfig) => void; onInsert: (key: string) => void;
}) {
  const custom = cfg.customVars ?? [];
  const setCustom = (next: ContractCustomVar[]) => onChange({ ...cfg, customVars: next });
  const addCustom = () => setCustom([...custom, { key: `cv_${Date.now().toString(36)}`, label: `ข้อมูลใหม่ ${custom.length + 1}`, value: "" }]);
  const lbl: React.CSSProperties = { fontSize: "0.74rem", color: "var(--color-dark-variant)", marginBottom: 2, display: "block" };
  const inp = "form-control form-control-sm";

  return (
    <div style={{ width: 340, flexShrink: 0, background: "var(--color-white)", borderLeft: "1px solid var(--color-light)", overflow: "auto", padding: 14, color: "var(--color-dark)" }} className="nicescrollbar">
      <div style={{ fontWeight: 700, marginBottom: 6 }}><i className="fas fa-list-check me-2 text-primary" />ข้อมูลที่ใช้ในสัญญา</div>
      <div style={{ fontSize: "0.76rem", color: "var(--color-dark-variant)", marginBottom: 12 }}>
        กรอกค่าที่ใช้ซ้ำทุกสัญญา ระบบนำไปใส่ในชิปสีฟ้าของเอกสารเอง ส่วนข้อมูลผู้เช่า ห้อง ค่าเช่า ดึงจากหน้าผู้เช่าอัตโนมัติ
      </div>

      <div style={{ fontWeight: 600, fontSize: "0.82rem", margin: "6px 0" }}>ข้อมูลคงที่</div>
      {TEXT_FIELDS.map(([k, label, ph]) => (
        <div key={k} className="mb-2">
          <label style={lbl}>{label}</label>
          <input className={inp} value={String(cfg[k] ?? "")} placeholder={ph} onChange={(e) => onChange({ ...cfg, [k]: e.target.value })} />
        </div>
      ))}
      <div className="row g-2 mb-2">
        {NUM_FIELDS.map(([k, label]) => (
          <div key={k} className="col-6">
            <label style={lbl}>{label}</label>
            <input type="number" min={0} className={inp} value={Number(cfg[k]) || 0} onChange={(e) => onChange({ ...cfg, [k]: Number(e.target.value) || 0 })} />
          </div>
        ))}
      </div>
      <label className="d-flex align-items-center gap-2 mb-3" style={{ cursor: "pointer", fontSize: "0.85rem" }}>
        <input type="checkbox" className="form-check-input mt-0" checked={cfg.showLogo !== false} onChange={(e) => onChange({ ...cfg, showLogo: e.target.checked })} />
        แสดงโลโก้มุมขวาบนของหน้า 1
      </label>

      <div className="d-flex justify-content-between align-items-center" style={{ margin: "14px 0 6px", borderTop: "1px solid var(--color-light)", paddingTop: 10 }}>
        <span style={{ fontWeight: 600, fontSize: "0.82rem" }}>ข้อมูลที่เพิ่มเอง</span>
        <button type="button" className="btn btn-sm btn-primary" style={{ padding: "1px 10px" }} onClick={addCustom}><i className="fas fa-plus me-1" />เพิ่ม</button>
      </div>
      {custom.length === 0 && <div style={{ fontSize: "0.76rem", color: "var(--color-dark-variant)" }}>ยังไม่มี — กด "เพิ่ม" แล้วตั้งชื่อ+ค่า จากนั้นกด "แทรก" ลงในเอกสาร</div>}
      {custom.map((cv, i) => (
        <div key={cv.key} className="mb-2 p-2" style={{ border: "1px solid var(--color-light)", borderRadius: 8 }}>
          <label style={lbl}>ชื่อข้อมูล</label>
          <input className={inp + " mb-1"} value={cv.label} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <label style={lbl}>ค่า</label>
          <input className={inp} value={cv.value} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
          <div className="d-flex justify-content-between mt-2">
            <button type="button" className="btn btn-sm btn-outline-primary" style={{ padding: "1px 8px" }}
              onMouseDown={(e) => { e.preventDefault(); onInsert(cv.key); }}>แทรกในเอกสาร</button>
            <button type="button" className="btn btn-sm btn-outline-danger" style={{ padding: "1px 8px" }}
              onClick={() => { if (window.confirm(`ลบข้อมูล "${cv.label}"? ชิปนี้ในเอกสารจะกลายเป็นช่องว่าง`)) setCustom(custom.filter((_, j) => j !== i)); }}>ลบ</button>
          </div>
        </div>
      ))}
    </div>
  );
}
