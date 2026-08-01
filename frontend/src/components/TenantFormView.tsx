import { useState, useEffect, useRef } from "react";
import { roomsApi, tenantsApi, addressApi } from "../api/client";
import CustomSelect2 from "./CustomSelect2";
import CustomCreatableSelect2 from "./CustomCreatableSelect2";
import { TENANT_TITLE_OPTIONS } from "../utils/tenantName";

const AVATAR = "https://cdn-icons-png.flaticon.com/512/149/149071.png";

const REQUIRED = ["roomId","amount","idLicense","firstName","lastName","houseNo","province","amphoe","tambon","zipcode","tel"];
const LABELS: Record<string,string> = {
  roomId:"เลขห้อง", amount:"จำนวนผู้เข้าพัก", idLicense:"เลขบัตรประชาชน",
  firstName:"ชื่อ", lastName:"นามสกุล", houseNo:"บ้านเลขที่",
  province:"จังหวัด", amphoe:"เขต/อำเภอ", tambon:"แขวง/ตำบล",
  zipcode:"รหัสไปรษณีย์", tel:"เบอร์โทรศัพท์",
};

interface FormState {
  amount: string; idLicense: string; title: string; firstName: string; lastName: string;
  tel: string; idLine: string; lineUserId: string;
  houseNo: string; soi: string; road: string;
  province: string; amphoe: string; tambon: string; zipcode: string; address: string;
  roomId: string;
}

const EMPTY: FormState = {
  amount:"", idLicense:"", title:"", firstName:"", lastName:"",
  tel:"", idLine:"", lineUserId:"",
  houseNo:"", soi:"", road:"", province:"", amphoe:"", tambon:"", zipcode:"", address:"",
  roomId:"",
};

export default function TenantFormView({
  onBack, onSuccess,
}: {
  onBack: () => void;
  onSuccess: (tenant: any) => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [imgSrc, setImgSrc] = useState(AVATAR);
  const [imageBase64, setImageBase64] = useState<string>("");
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<any>(null);
  const [provinces, setProvinces] = useState<string[]>([]);
  const [amphoes, setAmphoes] = useState<string[]>([]);
  const [tambons, setTambons] = useState<Array<{tambon:string;zipcode:number}>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const imgInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([roomsApi.getAll(), addressApi.getProvinces()]).then(([r, p]) => {
      setRooms(r.filter((rm: any) => rm.status === "ว่าง"));
      setProvinces(p);
    });
  }, []);

  function set(key: keyof FormState, val: string) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function formatPhone(val: string): string {
    const d = val.replace(/\D/g, "").slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0,3)}-${d.slice(3)}`;
    return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  }

  function formatIdCard(val: string): string {
    const d = val.replace(/\D/g, "").slice(0, 13);
    if (d.length <= 1) return d;
    if (d.length <= 5) return `${d.slice(0,1)}-${d.slice(1)}`;
    if (d.length <= 10) return `${d.slice(0,1)}-${d.slice(1,5)}-${d.slice(5)}`;
    if (d.length <= 12) return `${d.slice(0,1)}-${d.slice(1,5)}-${d.slice(5,10)}-${d.slice(10)}`;
    return `${d.slice(0,1)}-${d.slice(1,5)}-${d.slice(5,10)}-${d.slice(10,12)}-${d.slice(12)}`;
  }

  async function onProvinceChange(val: string) {
    setForm((f) => ({ ...f, province: val, amphoe: "", tambon: "", zipcode: "" }));
    setAmphoes([]);
    setTambons([]);
    if (!val) return;
    const a = await addressApi.getAmphoes(val);
    setAmphoes(a);
  }

  async function onAmphoeChange(val: string) {
    setForm((f) => ({ ...f, amphoe: val, tambon: "", zipcode: "" }));
    setTambons([]);
    if (!val || !form.province) return;
    const t = await addressApi.getTambons(form.province, val);
    setTambons(t);
  }

  function onTambonChange(val: string) {
    const found = tambons.find((t) => t.tambon === val);
    setForm((f) => ({ ...f, tambon: val, zipcode: found ? String(found.zipcode) : "" }));
  }

  function onRoomChange(roomId: string) {
    const room = rooms.find((r) => r.id === roomId);
    setSelectedRoom(room ?? null);
    set("roomId", roomId);
  }

  function onImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setImgSrc(result);
      setImageBase64(result);
    };
    reader.readAsDataURL(file);
  }

  function onPdfChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setPdfFiles((prev) => [...prev, ...files]);
    e.target.value = "";
  }

  function removePdf(idx: number) {
    setPdfFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit() {
    setError("");
    for (const key of REQUIRED) {
      if (!form[key as keyof FormState]?.trim()) {
        setError(`กรุณากรอก/เลือก ${LABELS[key]}`);
        return;
      }
    }
    if (!imageBase64) { setError("กรุณาอัปโหลดรูปภาพผู้เช่า"); return; }

    setSubmitting(true);
    try {
      const pdfData = await Promise.all(
        pdfFiles.map((file) => new Promise<{ name: string; data: string }>((res) => {
          const reader = new FileReader();
          reader.onloadend = () => res({ name: file.name, data: reader.result as string });
          reader.readAsDataURL(file);
        }))
      );
      const newTenant = await tenantsApi.create({ formData: form, imageBase64, pdfFiles: pdfData });
      onSuccess(newTenant);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSubmitting(false);
    }
  }

  const roomOptions = rooms.map((r) => ({ value: r.id, label: `ห้อง ${r.number}${r.detail ? ` – ${r.detail}` : ""}` }));
  const provinceOptions = provinces.map((p) => ({ value: p, label: p }));
  const amphoeOptions = amphoes.map((a) => ({ value: a, label: a }));
  const tambonOptions = tambons.map((t) => ({ value: t.tambon, label: t.tambon }));

  return (
    <div className="custom-card">
      <div className="row g-3">

        {/* ── ข้อมูลผู้เช่า ── */}
        <div className="col-12 mt-2">
          <h5 className="form-section-title">ข้อมูลผู้เช่า</h5>
        </div>

        {/* Image upload */}
        <div className="col-12 text-center">
          <label className="form-label">รูปภาพผู้เช่า<span className="text-danger">*</span></label>
          <div className="image-upload-container" onClick={() => imgInputRef.current?.click()} style={{ cursor: "pointer" }}>
            <img src={imgSrc} alt="preview" style={{ width:"100%", height:"100%", objectFit:"cover", borderRadius:"50%", border:"5px solid var(--color-light)", boxShadow:"0 4px 10px rgba(0,0,0,0.1)" }} onError={(e) => { (e.target as HTMLImageElement).src = AVATAR; }} />
            <div className="image-upload-label">
              <i className="fas fa-camera" />
            </div>
          </div>
          <input ref={imgInputRef} type="file" accept="image/*" style={{ display:"none" }} onChange={onImageChange} />
        </div>

        <div className="col-md-4">
          <label className="form-label">จำนวนผู้เข้าพัก<span className="text-danger">*</span></label>
          <input type="number" className="form-control" placeholder="ระบุจำนวน" min={1}
            value={form.amount} onChange={(e) => set("amount", e.target.value)} />
        </div>
        <div className="col-md-8">
          <label className="form-label">เลขบัตรประชาชน<span className="text-danger">*</span></label>
          <input type="text" className="form-control" placeholder="x-xxxx-xxxxx-xx-x" maxLength={17}
            value={form.idLicense} onChange={(e) => set("idLicense", formatIdCard(e.target.value))} />
        </div>
        <div className="col-md-3">
          <label className="form-label">คำนำหน้าชื่อ</label>
          <CustomCreatableSelect2
            options={TENANT_TITLE_OPTIONS.map((t) => ({ value: t, label: t }))}
            value={form.title ? { value: form.title, label: form.title } : null}
            onChange={(opt: any) => set("title", opt?.value ?? "")}
            onCreateOption={(val: string) => set("title", val)}
            placeholder="คุณ"
            isClearable
          />
        </div>
        <div className="col-md-4">
          <label className="form-label">ชื่อ<span className="text-danger">*</span></label>
          <input type="text" className="form-control" placeholder="ชื่อจริง"
            value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
        </div>
        <div className="col-md-5">
          <label className="form-label">นามสกุล<span className="text-danger">*</span></label>
          <input type="text" className="form-control" placeholder="นามสกุล"
            value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
        </div>
        <div className="col-md-6">
          <label className="form-label">เบอร์โทรศัพท์<span className="text-danger">*</span></label>
          <input type="tel" className="form-control" placeholder="089-999-9999" maxLength={12}
            value={form.tel} onChange={(e) => set("tel", formatPhone(e.target.value))} />
        </div>
        <div className="col-md-6">
          <label className="form-label">Line ID</label>
          <input type="text" className="form-control" placeholder="ID Line"
            value={form.idLine} onChange={(e) => set("idLine", e.target.value)} />
        </div>
        <div className="col-12">
          <label className="form-label">Line Connect (User ID)</label>
          <div className="input-group">
            <span className="input-group-text"><i className="fab fa-line text-success" /></span>
            <input type="text" className="form-control" placeholder="รหัสเชื่อมต่อ (Auto/Manual)"
              value={form.lineUserId} onChange={(e) => set("lineUserId", e.target.value)} />
          </div>
        </div>

        {/* ── ที่อยู่ ── */}
        <div className="col-12 mt-2">
          <h5 className="form-section-title">ที่อยู่ตามบัตรประชาชน</h5>
        </div>
        <div className="col-md-4">
          <label className="form-label">บ้านเลขที่<span className="text-danger">*</span></label>
          <input type="text" className="form-control" placeholder="กรุณากรอก"
            value={form.houseNo} onChange={(e) => set("houseNo", e.target.value)} />
        </div>
        <div className="col-md-4">
          <label className="form-label">ซอย</label>
          <input type="text" className="form-control" placeholder="กรุณากรอก"
            value={form.soi} onChange={(e) => set("soi", e.target.value)} />
        </div>
        <div className="col-md-4">
          <label className="form-label">ถนน</label>
          <input type="text" className="form-control" placeholder="กรุณากรอก"
            value={form.road} onChange={(e) => set("road", e.target.value)} />
        </div>
        <div className="col-md-6">
          <label className="form-label">จังหวัด<span className="text-danger">*</span></label>
          <CustomSelect2
            options={provinceOptions}
            value={form.province ? { value: form.province, label: form.province } : null}
            onChange={(opt: any) => onProvinceChange(opt?.value ?? "")}
            placeholder="เลือกจังหวัด"
            isSearchable
          />
        </div>
        <div className="col-md-6">
          <label className="form-label">เขต/อำเภอ<span className="text-danger">*</span></label>
          <CustomSelect2
            options={amphoeOptions}
            value={form.amphoe ? { value: form.amphoe, label: form.amphoe } : null}
            onChange={(opt: any) => onAmphoeChange(opt?.value ?? "")}
            placeholder="เลือกอำเภอ"
            isSearchable
            isDisabled={!form.province}
          />
        </div>
        <div className="col-md-6">
          <label className="form-label">แขวง/ตำบล<span className="text-danger">*</span></label>
          <CustomSelect2
            options={tambonOptions}
            value={form.tambon ? { value: form.tambon, label: form.tambon } : null}
            onChange={(opt: any) => onTambonChange(opt?.value ?? "")}
            placeholder="เลือกตำบล"
            isSearchable
            isDisabled={!form.amphoe}
          />
        </div>
        <div className="col-md-6">
          <label className="form-label">รหัสไปรษณีย์<span className="text-danger">*</span></label>
          <input type="text" className="form-control" placeholder="ระบบจะกรอกให้อัตโนมัติ"
            value={form.zipcode} readOnly style={{ backgroundColor: "var(--color-background)" }} />
        </div>
        <div className="col-12">
          <label className="form-label">ที่อยู่เพิ่มเติม</label>
          <textarea className="form-control" rows={3}
            value={form.address} onChange={(e) => set("address", e.target.value)} />
        </div>

        {/* ── ข้อมูลห้องเช่า ── */}
        <div className="col-12 mt-2">
          <h5 className="form-section-title">ข้อมูลห้องเช่า</h5>
        </div>
        <div className="col-md-6">
          <label className="form-label">เลขห้อง<span className="text-danger">*</span></label>
          <CustomSelect2
            options={roomOptions}
            value={form.roomId ? roomOptions.find((o) => o.value === form.roomId) ?? null : null}
            onChange={(opt: any) => onRoomChange(opt?.value ?? "")}
            placeholder="กรุณาเลือกห้อง"
            isSearchable
          />
        </div>
        <div className="col-md-6">
          <label className="form-label">รหัสห้อง</label>
          <input type="text" className="form-control" readOnly
            value={selectedRoom?.code ?? ""} style={{ backgroundColor: "var(--color-background)" }} />
        </div>
        <div className="col-md-6">
          <label className="form-label">ราคาห้อง</label>
          <input type="text" className="form-control" readOnly
            value={selectedRoom ? `${selectedRoom.price?.toLocaleString()} ฿/เดือน` : ""} style={{ backgroundColor: "var(--color-background)" }} />
        </div>
        <div className="col-md-6">
          <label className="form-label">รายละเอียดห้อง</label>
          <input type="text" className="form-control" readOnly
            value={selectedRoom?.detail ?? ""} style={{ backgroundColor: "var(--color-background)" }} />
        </div>

        {/* ── PDF Upload ── */}
        <div className="col-12 mt-2">
          <h5 className="form-section-title">อัปโหลดสัญญาเช่า (PDF)</h5>
        </div>
        <div className="col-12">
          <label htmlFor="pdf-upload" className="drop-area w-100" style={{ cursor:"pointer", display:"block" }}>
            <i className="fas fa-cloud-upload-alt" style={{ fontSize:"3rem", color:"var(--color-primary)", display:"block", textAlign:"center", marginBottom:"0.5rem" }} />
            <p style={{ textAlign:"center", margin:0, color:"var(--color-dark-variant)", fontWeight:500 }}>ลากไฟล์ PDF มาวางที่นี่ หรือ คลิกเพื่อเลือกไฟล์</p>
            <small style={{ display:"block", textAlign:"center", color:"var(--color-info-dark)" }}>(รองรับหลายไฟล์)</small>
          </label>
          <input id="pdf-upload" type="file" accept="application/pdf" multiple style={{ display:"none" }} onChange={onPdfChange} />
          {pdfFiles.length > 0 && (
            <ul style={{ listStyle:"none", padding:0, marginTop:"0.75rem" }}>
              {pdfFiles.map((f, i) => (
                <li key={i} className="file-view-item" style={{ justifyContent:"space-between" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
                    <i className="fas fa-file-pdf text-danger" style={{ fontSize:"1.3rem" }} />
                    <div>
                      <div style={{ fontWeight:500, fontSize:"0.9rem" }}>{f.name}</div>
                      <small className="text-muted">{(f.size / 1024).toFixed(1)} KB</small>
                    </div>
                  </div>
                  <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => removePdf(i)}>
                    <i className="fas fa-times" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="col-12">
            <div className="alert alert-danger py-2 mb-0">{error}</div>
          </div>
        )}

        {/* Actions */}
        <div className="col-12 d-flex justify-content-between gap-2 mt-2">
          <button type="button" className="btn btn-outline-secondary" onClick={onBack} disabled={submitting}>
            <i className="fas fa-arrow-left me-1" />กลับ
          </button>
          <button type="button" className="btn btn-primary px-4" onClick={handleSubmit} disabled={submitting}>
            {submitting
              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังส่งข้อมูล...</>
              : <><i className="fas fa-paper-plane me-2" />ส่งข้อมูล</>}
          </button>
        </div>

      </div>
    </div>
  );
}
