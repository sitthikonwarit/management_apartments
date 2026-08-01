import { useState, useEffect, useRef } from "react";
import { tenantsApi, addressApi } from "../api/client";
import CustomSelect2 from "./CustomSelect2";
import CustomCreatableSelect2 from "./CustomCreatableSelect2";
import ThaiDatePicker from "./ThaiDatePicker";
import { TENANT_TITLE_OPTIONS } from "../utils/tenantName";

const AVATAR = "https://cdn-icons-png.flaticon.com/512/149/149071.png";

const REQUIRED = ["amount","idLicense","firstName","lastName","tel","houseNo","province","amphoe","tambon","zipcode"];
const LABELS: Record<string,string> = {
  amount:"จำนวนผู้เข้าพัก", idLicense:"เลขบัตรประชาชน",
  firstName:"ชื่อ", lastName:"นามสกุล", houseNo:"บ้านเลขที่",
  province:"จังหวัด", amphoe:"เขต/อำเภอ", tambon:"แขวง/ตำบล",
  zipcode:"รหัสไปรษณีย์", tel:"เบอร์โทรศัพท์",
};

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

function getDriveImgSrc(url: string): string {
  if (!url) return AVATAR;
  const m1 = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return `/api/drive/image/${m1[1]}`;
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return `/api/drive/image/${m2[1]}`;
  return url;
}

interface EditForm {
  amount: string; idLicense: string; title: string; firstName: string; lastName: string;
  tel: string; idLine: string; lineUserId: string;
  houseNo: string; soi: string; road: string;
  province: string; amphoe: string; tambon: string; zipcode: string; address: string;
  contractStartDate: string; contractEndDate: string;
}

export default function TenantEditView({
  tenant, onBack, onSuccess,
}: {
  tenant: any;
  onBack: () => void;
  onSuccess: (updated: any) => void;
}) {
  const [form, setForm] = useState<EditForm>({
    amount: tenant.amount ?? "",
    idLicense: tenant.idLicense ?? "",
    title: tenant.title ?? "",
    firstName: tenant.firstName ?? "",
    lastName: tenant.lastName ?? "",
    tel: tenant.tel ?? "",
    idLine: tenant.idLine ?? "",
    lineUserId: tenant.lineUserId ?? "",
    houseNo: tenant.houseNo ?? "",
    soi: tenant.soi ?? "",
    road: tenant.road ?? "",
    province: tenant.province ?? "",
    amphoe: tenant.amphoe ?? "",
    tambon: tenant.tambon ?? "",
    zipcode: tenant.zipcode ?? "",
    address: tenant.address ?? "",
    contractStartDate: tenant.contractStartDate ?? "",
    contractEndDate: tenant.contractEndDate ?? "",
  });

  const [imgSrc, setImgSrc] = useState(getDriveImgSrc(tenant.driveImageUrl));
  const [imageBase64, setImageBase64] = useState<string>("");
  const [existingPdfs, setExistingPdfs] = useState<Array<{ name: string; url: string }>>(tenant.pdfLinks ?? []);
  const [newPdfFiles, setNewPdfFiles] = useState<File[]>([]);
  const [provinces, setProvinces] = useState<string[]>([]);
  const [amphoes, setAmphoes] = useState<string[]>([]);
  const [tambons, setTambons] = useState<Array<{ tambon: string; zipcode: number }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const imgInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    addressApi.getProvinces().then(setProvinces);
    if (form.province) {
      addressApi.getAmphoes(form.province).then(setAmphoes);
      if (form.amphoe) {
        addressApi.getTambons(form.province, form.amphoe).then(setTambons);
      }
    }
  }, []);

  function set(key: keyof EditForm, val: string) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function onProvinceChange(val: string) {
    setForm((f) => ({ ...f, province: val, amphoe: "", tambon: "", zipcode: "" }));
    setAmphoes([]); setTambons([]);
    if (!val) return;
    setAmphoes(await addressApi.getAmphoes(val));
  }

  async function onAmphoeChange(val: string) {
    setForm((f) => ({ ...f, amphoe: val, tambon: "", zipcode: "" }));
    setTambons([]);
    if (!val || !form.province) return;
    setTambons(await addressApi.getTambons(form.province, val));
  }

  function onTambonChange(val: string) {
    const found = tambons.find((t) => t.tambon === val);
    setForm((f) => ({ ...f, tambon: val, zipcode: found ? String(found.zipcode) : "" }));
  }

  function onPdfChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setNewPdfFiles((prev) => [...prev, ...files]);
    e.target.value = "";
  }

  function removeNewPdf(idx: number) {
    setNewPdfFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function removeExistingPdf(idx: number) {
    setExistingPdfs((prev) => prev.filter((_, i) => i !== idx));
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

  async function handleSubmit() {
    setError("");
    for (const key of REQUIRED) {
      if (!form[key as keyof EditForm]?.trim()) {
        setError(`กรุณากรอก/เลือก ${LABELS[key]}`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const pdfData = await Promise.all(
        newPdfFiles.map((file) => new Promise<{ name: string; data: string }>((res) => {
          const reader = new FileReader();
          reader.onloadend = () => res({ name: file.name, data: reader.result as string });
          reader.readAsDataURL(file);
        }))
      );
      const updated = await tenantsApi.update(tenant.id, {
        formData: form,
        imageBase64: imageBase64 || undefined,
        pdfFiles: pdfData.length > 0 ? pdfData : undefined,
        pdfLinksToKeep: existingPdfs,
      });
      onSuccess(updated);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSubmitting(false);
    }
  }

  const provinceOptions = provinces.map((p) => ({ value: p, label: p }));
  const amphoeOptions   = amphoes.map((a)   => ({ value: a, label: a }));
  const tambonOptions   = tambons.map((t)   => ({ value: t.tambon, label: t.tambon }));

  return (
    <div className="custom-card">
      <div className="row g-3">

        {/* ── ข้อมูลผู้เช่า ── */}
        <div className="col-12 mt-2">
          <h5 className="form-section-title">แก้ไขข้อมูลผู้เช่า</h5>
        </div>

        {/* Image */}
        <div className="col-12 text-center">
          <label className="form-label">รูปภาพผู้เช่า <span className="text-muted" style={{ fontSize:"0.8rem" }}>(ไม่เปลี่ยนก็ได้)</span></label>
          <div className="image-upload-container" onClick={() => imgInputRef.current?.click()} style={{ cursor:"pointer" }}>
            <img src={imgSrc} alt="preview"
              style={{ width:"100%", height:"100%", objectFit:"cover", borderRadius:"50%", border:"5px solid var(--color-light)", boxShadow:"0 4px 10px rgba(0,0,0,0.1)" }}
              onError={(e) => { (e.target as HTMLImageElement).src = AVATAR; }}
            />
            <div className="image-upload-label"><i className="fas fa-camera" /></div>
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
            <input type="text" className="form-control" placeholder="รหัสเชื่อมต่อ"
              value={form.lineUserId} onChange={(e) => set("lineUserId", e.target.value)} />
          </div>
        </div>

        {/* ── ที่อยู่ ── */}
        <div className="col-12 mt-2">
          <h5 className="form-section-title">ที่อยู่ตามบัตรประชาชน</h5>
        </div>
        <div className="col-md-4">
          <label className="form-label">บ้านเลขที่<span className="text-danger">*</span></label>
          <input type="text" className="form-control"
            value={form.houseNo} onChange={(e) => set("houseNo", e.target.value)} />
        </div>
        <div className="col-md-4">
          <label className="form-label">ซอย</label>
          <input type="text" className="form-control"
            value={form.soi} onChange={(e) => set("soi", e.target.value)} />
        </div>
        <div className="col-md-4">
          <label className="form-label">ถนน</label>
          <input type="text" className="form-control"
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
          <input type="text" className="form-control" readOnly
            value={form.zipcode} style={{ backgroundColor: "var(--color-background)" }} />
        </div>
        <div className="col-12">
          <label className="form-label">ที่อยู่เพิ่มเติม</label>
          <textarea className="form-control" rows={2}
            value={form.address} onChange={(e) => set("address", e.target.value)} />
        </div>

        {/* ── สัญญาเช่า ── */}
        <div className="col-12 mt-2">
          <h5 className="form-section-title">สัญญาเช่า</h5>
        </div>
        <div className="col-md-6">
          <label className="form-label">วันเข้าพัก</label>
          <ThaiDatePicker
            value={form.contractStartDate}
            onChange={(v) => set("contractStartDate", v)}
            placeholder="เลือกวันเข้าพัก"
          />
        </div>
        <div className="col-md-6">
          <label className="form-label">วันหมดอายุสัญญา</label>
          <ThaiDatePicker
            value={form.contractEndDate}
            onChange={(v) => set("contractEndDate", v)}
            placeholder="เลือกวันหมดสัญญา"
          />
        </div>

        {/* ── เอกสาร ── */}
        <div className="col-12 mt-2">
          <h5 className="form-section-title">เอกสารแนบ (PDF)</h5>
        </div>
        <div className="col-12">
          {existingPdfs.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, marginBottom: "0.75rem" }}>
              {existingPdfs.map((f, i) => (
                <li key={i} className="file-view-item" style={{ justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <i className="fas fa-file-pdf text-danger" style={{ fontSize: "1.3rem" }} />
                    <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>{f.name}</div>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <a href={f.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-primary">
                      <i className="fas fa-eye" />
                    </a>
                    <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => removeExistingPdf(i)}>
                      <i className="fas fa-trash" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <label
            className="drop-area w-100"
            style={{ cursor: "pointer", display: "block" }}
            onClick={() => pdfInputRef.current?.click()}
          >
            <i className="fas fa-cloud-upload-alt" style={{ fontSize: "2.5rem", color: "var(--color-primary)", display: "block", textAlign: "center", marginBottom: "0.5rem" }} />
            <p style={{ textAlign: "center", margin: 0, color: "var(--color-dark-variant)", fontWeight: 500 }}>คลิกเพื่อเพิ่มไฟล์ PDF</p>
            <small style={{ display: "block", textAlign: "center", color: "var(--color-info-dark)" }}>(รองรับหลายไฟล์)</small>
          </label>
          <input ref={pdfInputRef} type="file" accept="application/pdf" multiple style={{ display: "none" }} onChange={onPdfChange} />
          {newPdfFiles.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, marginTop: "0.75rem" }}>
              {newPdfFiles.map((f, i) => (
                <li key={i} className="file-view-item" style={{ justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <i className="fas fa-file-pdf text-danger" style={{ fontSize: "1.3rem" }} />
                    <div>
                      <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>{f.name}</div>
                      <small className="text-muted">{(f.size / 1024).toFixed(1)} KB</small>
                    </div>
                  </div>
                  <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => removeNewPdf(i)}>
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
              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
              : <><i className="fas fa-save me-2" />บันทึกข้อมูล</>}
          </button>
        </div>

      </div>
    </div>
  );
}
