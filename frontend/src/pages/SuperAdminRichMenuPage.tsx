// หน้าสร้าง Rich Menu ให้ LINE OA "อิสระ" ใดๆ — ไม่ผูกกับองค์กรไหนในระบบเลย (ต่างจากหมวด LINE Rich Menu ใน
// SettingsPage.tsx ที่อ่าน token/URL/รูปจาก app_config ขององค์กรที่ล็อกอินอยู่เสมอ) ใช้ตอนอยากทำ Rich Menu
// ให้ LINE OA อื่นที่ไม่ได้อยู่ในระบบหลายองค์กรนี้ (เช่น บัญชีทดลอง/ของทีมงานเอง) — Channel Access Token มา
// จาก SUPERADMIN_RICHMENU_LINE_TOKEN ใน .env ฝั่ง backend เท่านั้น (ดู routes/superadmin.ts) ไม่มีช่องกรอก
// token ในหน้านี้ กัน token หลุดผ่าน network tab/log ฝั่งเว็บ ส่วนค่าอื่น (LIFF Login URL/Contact URL/รูป/
// Guest ID ล่าสุด) บันทึกไว้ถาวรฝั่ง backend เหมือนหน้า Settings ปกติขององค์กร (superadmin_richmenu_config —
// ดู routes/superadmin.ts) โหลดหน้าใหม่แล้วยังเห็นค่าที่กรอก/รูปที่อัปโหลดไว้ล่าสุดอยู่ ไม่ต้องกรอกซ้ำ — ตัด
// เหลือแค่เมนู Guest เดียว (1 ปุ่มใหญ่บน + 3 ปุ่มล่าง) เพราะเครื่องมือนี้ใช้สำหรับตั้งค่า Guest menu เริ่มต้น
// ให้ LINE OA ใหม่เป็นหลัก ไม่ได้ใช้สร้างเมนู Member/Admin แบบเต็มระบบ
import { useEffect, useRef, useState } from "react";
import { superAdminApi } from "../api/client";
import { toastSuccess, toastError } from "../utils/toast";

const RICHMENU_WIDTH = 2500;
const RICHMENU_HEIGHT = 1686;

// ลิงก์เข้าสู่ระบบเจ้าของแบบไม่ผ่าน Username/Password — endpoint เดียวกับปุ่ม "เข้าสู่ระบบด้วย LINE" ในหน้า
// Login ปกติ (ดู LoginPage.tsx) ใช้ LINE Login channel เดียวกันทั้งระบบ (LINE_LOGIN_CHANNEL_ID/SECRET ใน
// .env — คนละอย่างกับ Channel Access Token ของ LINE OA ที่จะสร้างเมนูให้) จับคู่องค์กรอัตโนมัติจาก lineUserId
// ที่ล็อกอิน ไม่ต้องระบุองค์กรล่วงหน้า (ล็อกอินครั้งแรกของบัญชี LINE ที่ไม่เคยผูกไว้ = สร้างองค์กรใหม่ให้เอง)
const OWNER_LOGIN_LINK = `${window.location.origin}/api/auth/line/authorize`;

export default function SuperAdminRichMenuPage() {
  const [loaded, setLoaded] = useState(false);
  const [liffLoginUrl, setLiffLoginUrl] = useState("");
  const [contactUrl, setContactUrl] = useState("");

  const [image, setImage] = useState("");
  const [validating, setValidating] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [prevGuestId, setPrevGuestId] = useState("");

  const [creating, setCreating] = useState(false);
  const [resultMsg, setResultMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [menuId, setMenuId] = useState("");

  const [copiedField, setCopiedField] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);

  // โหลดค่าที่บันทึกไว้ล่าสุดตอนเปิดหน้า (LIFF Login URL/Contact URL/รูป/Guest ID ล่าสุด) — เติมช่อง "ID เมนู
  // Guest เดิมที่จะแทนที่" อัตโนมัติด้วย Guest ID ล่าสุดที่เคยสร้างไว้ (ยังแก้ไข/ลบทิ้งได้ตามปกติ)
  useEffect(() => {
    superAdminApi.getRichMenuConfig()
      .then((cfg) => {
        setLiffLoginUrl(cfg.liffLoginUrl);
        setContactUrl(cfg.contactUrl);
        setImage(cfg.image);
        setPrevGuestId(cfg.richMenuGuestId);
      })
      .catch(() => toastError("โหลดค่าที่บันทึกไว้ไม่สำเร็จ"))
      .finally(() => setLoaded(true));
  }, []);

  // คัดลอกค่าในช่องกรอกไปคลิปบอร์ด — แพทเทิร์นเดียวกับ copyLiffField ใน SettingsPage.tsx
  function copyField(field: string, label: string, value: string) {
    if (!value.trim()) return;
    navigator.clipboard.writeText(value.trim());
    setCopiedField(field);
    setTimeout(() => setCopiedField((cur) => (cur === field ? "" : cur)), 1500);
    toastSuccess(`คัดลอก ${label} แล้ว`);
  }

  // ตรวจขนาดรูปให้ตรง 2500x1686 พิกเซลเป๊ะก่อน (LINE ปฏิเสธรูปที่ขนาดไม่ตรงตอนสร้างเมนู) แล้วอัปโหลดขึ้น
  // backend ทันที (แพทเทิร์นเดียวกับ POST /richmenu/image ของหน้า Settings ปกติ) — บันทึกไฟล์ถาวรไว้ ไม่ต้อง
  // รอกด "สร้าง"
  function handleFile(file: File) {
    setValidating(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const img = new Image();
      img.onload = async () => {
        if (img.width !== RICHMENU_WIDTH || img.height !== RICHMENU_HEIGHT) {
          toastError(`รูปต้องมีขนาด ${RICHMENU_WIDTH}x${RICHMENU_HEIGHT} พิกเซลเป๊ะ (รูปนี้ ${img.width}x${img.height})`);
          setValidating(false);
          return;
        }
        setValidating(false);
        setUploading(true);
        try {
          const { url } = await superAdminApi.uploadRichMenuImage(dataUrl);
          setImage(url);
          toastSuccess("บันทึกรูปเมนูแล้ว");
        } catch {
          toastError("อัปโหลดรูปเมนูไม่สำเร็จ");
        } finally {
          setUploading(false);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  async function handleCreate() {
    setCreating(true);
    setResultMsg(null);
    try {
      const result = await superAdminApi.createRichMenuSet({
        liffLoginUrl: liffLoginUrl.trim(),
        contactUrl: contactUrl.trim(),
        previousGuestId: prevGuestId.trim(),
      });
      setMenuId(result.menuId);
      setPrevGuestId(result.menuId);
      if (result.defaultSet) {
        setResultMsg({ type: "success", text: "สร้างเมนู Guest สำเร็จ และตั้งเป็นค่าเริ่มต้นของผู้ใช้ทุกคนแล้ว" });
        toastSuccess("สร้าง Rich Menu สำเร็จ");
      } else {
        setResultMsg({ type: "error", text: `สร้างเมนูสำเร็จ แต่${result.warning ?? "ตั้งเมนู Guest เป็นค่าเริ่มต้นไม่สำเร็จ"}` });
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? "สร้าง Rich Menu ไม่สำเร็จ";
      setResultMsg({ type: "error", text: msg });
      toastError(msg);
    } finally {
      setCreating(false);
    }
  }

  const canCreate = loaded && !creating && !uploading && liffLoginUrl.trim() && image;

  return (
    <div className="detail-section custom-card">
      <div className="detail-section-header">
        <h6 className="mb-0"><i className="fas fa-border-all me-2" />สร้าง Rich Menu สำหรับ LINE OA อื่น</h6>
      </div>

      <div className="p-3">
        <p className="text-muted small mb-3">
          เครื่องมือนี้สร้างเมนู Guest ให้ LINE Official Account ที่ตั้งค่า SUPERADMIN_RICHMENU_LINE_TOKEN
          ไว้ใน .env ของ backend แล้ว (เช่น บัญชีทดลอง/ของทีมงานเอง — เป็นคนละ LINE OA กับที่ล็อกอินอยู่)
          ปุ่มใหญ่บน ("เข้าเว็บหลัก") พาเจ้าของหอพักเข้าสู่ระบบด้วยบัญชี LINE ของตัวเองทันที ไม่ต้องกรอก
          Username/Password ค่าที่กรอก/รูปที่อัปโหลดในหน้านี้บันทึกไว้ถาวรฝั่งเซิร์ฟเวอร์ — ปิดหรือรีเฟรชหน้า
          แล้วค่าเดิมยังอยู่
        </p>

        <div className="detail-section mb-3" style={{ background: "var(--color-background)", border: "1px solid var(--color-light)" }}>
          <label className="form-label small fw-bold mb-2">
            <i className="fas fa-link me-1" />ลิงก์เข้าสู่ระบบเจ้าของ (ไม่ผ่าน Username/Password)
          </label>
          <div className="input-group input-group-sm">
            <input type="text" className="form-control" readOnly value={OWNER_LOGIN_LINK} />
            <button type="button" className="btn btn-outline-secondary" title="คัดลอก"
              onClick={() => copyField("ownerLogin", "ลิงก์เข้าสู่ระบบเจ้าของ", OWNER_LOGIN_LINK)}>
              <i className={`fas ${copiedField === "ownerLogin" ? "fa-check" : "fa-copy"}`} />
            </button>
            <button type="button" className="btn btn-outline-primary" onClick={() => setLiffLoginUrl(OWNER_LOGIN_LINK)}>
              ใช้ลิงก์นี้
            </button>
          </div>
          <div className="form-text small mt-2">
            กด "ใช้ลิงก์นี้" เพื่อใส่ในช่อง LIFF Login URL ด้านล่างอัตโนมัติ — เมื่อเจ้าของหอพักกดปุ่มใหญ่บนเมนู
            Guest จะพาเข้าสู่ระบบผ่านบัญชี LINE ของตัวเองทันที ระบบจับคู่องค์กรให้อัตโนมัติจากบัญชี LINE ที่ใช้
            ล็อกอิน (ล็อกอินครั้งแรกของบัญชี LINE ที่ไม่เคยผูกไว้เลย = สร้างองค์กรใหม่ให้อัตโนมัติ) ไม่ต้องสร้าง
            LIFF app หรือระบุองค์กรล่วงหน้า
          </div>
        </div>

        <div className="row g-3 mb-3">
          <div className="col-md-6">
            <label className="form-label small fw-bold">LIFF Login URL <span className="text-muted fw-normal">(ปุ่มใหญ่บน — เข้าเว็บหลัก management ด้วย LINE Login)</span></label>
            <div className="input-group">
              <input type="text" className="form-control" placeholder="https://liff.line.me/xxxxxxxxxx-xxxxxxxx"
                value={liffLoginUrl} onChange={(e) => setLiffLoginUrl(e.target.value)} />
              <button type="button" className="btn btn-outline-secondary" title="คัดลอก"
                disabled={!liffLoginUrl.trim()} onClick={() => copyField("login", "LIFF Login URL", liffLoginUrl)}>
                <i className={`fas ${copiedField === "login" ? "fa-check" : "fa-copy"}`} />
              </button>
            </div>
          </div>
          <div className="col-md-6">
            <label className="form-label small fw-bold">Contact URL <span className="text-muted fw-normal">(ไม่บังคับ — ปุ่ม "ติดต่อ")</span></label>
            <div className="input-group">
              <input type="text" className="form-control" placeholder="https://... หรือเว้นว่างไว้"
                value={contactUrl} onChange={(e) => setContactUrl(e.target.value)} />
              <button type="button" className="btn btn-outline-secondary" title="คัดลอก"
                disabled={!contactUrl.trim()} onClick={() => copyField("contact", "Contact URL", contactUrl)}>
                <i className={`fas ${copiedField === "contact" ? "fa-check" : "fa-copy"}`} />
              </button>
            </div>
          </div>
          <div className="col-12">
            <div className="form-text small">
              ถ้าเว้นว่าง Contact URL ไว้ ปุ่ม "ติดต่อ" จะส่งข้อความเข้าแชทแทน ส่วนปุ่ม "แจ้งปัญหา" และ "เพิ่มเติม" จะส่งข้อความเข้าแชทเสมอ
            </div>
          </div>
        </div>

        <div className="row g-3 mb-3">
          <div className="col-md-4">
            <label className="form-label small fw-bold">เมนู Guest</label>
            <div className="p-2 rounded" style={{ border: "1px solid var(--color-light)", background: "var(--color-background)" }}>
              <div style={{
                width: "100%", aspectRatio: `${RICHMENU_WIDTH} / ${RICHMENU_HEIGHT}`, borderRadius: 8, overflow: "hidden",
                background: "#fff", border: "1px solid var(--color-light)", display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {image
                  ? <img src={image} alt="เมนู Guest" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <span className="text-muted small"><i className="fas fa-image me-1" />ยังไม่มีรูป</span>}
              </div>
              <div className="text-muted small mt-1 mb-2">1 ปุ่มใหญ่บน (เข้าเว็บหลัก) + 3 ปุ่มล่าง (ติดต่อ/แจ้งปัญหา/เพิ่มเติม) — ขนาด {RICHMENU_WIDTH}x{RICHMENU_HEIGHT} พิกเซล</div>
              <button className="btn btn-sm btn-outline-secondary w-100" type="button" disabled={validating || uploading}
                onClick={() => fileRef.current?.click()}>
                {validating
                  ? <><span className="spinner-border spinner-border-sm me-1" />กำลังตรวจสอบ...</>
                  : uploading
                  ? <><span className="spinner-border spinner-border-sm me-1" />กำลังบันทึกรูป...</>
                  : <><i className="fas fa-upload me-1" />{image ? "เปลี่ยนรูป" : "เลือกรูป"}</>}
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
            </div>
          </div>
        </div>

        <div className="detail-section mb-3" style={{ background: "var(--color-background)", border: "1px solid var(--color-light)" }}>
          <label className="form-label small fw-bold mb-2">
            <i className="fas fa-recycle me-1" />ID เมนู Guest เดิมที่จะแทนที่ <span className="text-muted fw-normal">(ไม่บังคับ — กรอกถ้าเคยสร้างเมนูนี้ไว้แล้วและอยากลบของเดิมทิ้งก่อน)</span>
          </label>
          <div className="input-group input-group-sm">
            <input className="form-control" placeholder="Guest richMenuId เดิม" value={prevGuestId} onChange={(e) => setPrevGuestId(e.target.value)} />
            <button type="button" className="btn btn-outline-secondary" title="คัดลอก"
              disabled={!prevGuestId.trim()} onClick={() => copyField("prevGuest", "Guest richMenuId เดิม", prevGuestId)}>
              <i className={`fas ${copiedField === "prevGuest" ? "fa-check" : "fa-copy"}`} />
            </button>
          </div>
        </div>

        {resultMsg && (
          <div className={`alert ${resultMsg.type === "success" ? "alert-success" : "alert-danger"} py-2 px-3 small mb-3`}>
            {resultMsg.text}
          </div>
        )}

        <button className="btn btn-primary" onClick={handleCreate} disabled={!canCreate}>
          {creating
            ? <><span className="spinner-border spinner-border-sm me-2" />กำลังสร้าง Rich Menu...</>
            : <><i className="fas fa-magic me-2" />สร้าง Rich Menu Guest</>}
        </button>

        {menuId && (
          <div className="mt-3">
            <label className="form-label small text-muted mb-1"><i className="fas fa-check-circle text-success me-1" />Guest ID</label>
            <div className="input-group input-group-sm">
              <input type="text" className="form-control" readOnly value={menuId} />
              <button type="button" className="btn btn-outline-secondary" title="คัดลอก"
                onClick={() => copyField("menuId", "Guest ID", menuId)}>
                <i className={`fas ${copiedField === "menuId" ? "fa-check" : "fa-copy"}`} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
