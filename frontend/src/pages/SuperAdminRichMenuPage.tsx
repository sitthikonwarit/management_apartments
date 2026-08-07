// หน้าสร้าง Rich Menu ให้ LINE OA "อิสระ" ใดๆ — ไม่ผูกกับองค์กรไหนในระบบเลย (ต่างจากหมวด LINE Rich Menu ใน
// SettingsPage.tsx ที่อ่าน token/URL/รูปจาก app_config ขององค์กรที่ล็อกอินอยู่เสมอ) ใช้ตอนอยากทำ Rich Menu
// ให้ LINE OA อื่นที่ไม่ได้อยู่ในระบบหลายองค์กรนี้ (เช่น บัญชีทดลอง/ของทีมงานเอง) กรอก token + รูปทั้ง 3 แล้ว
// กดสร้างได้เลยในหน้าเดียว ไม่มีการบันทึกค่าอะไรไว้ถาวรฝั่งเรา (โหลดหน้าใหม่ = กรอกใหม่หมด)
import { useRef, useState } from "react";
import { superAdminApi } from "../api/client";
import { toastSuccess, toastError } from "../utils/toast";

const RICHMENU_WIDTH = 2500;
const RICHMENU_HEIGHT = 1686;
type RichMenuKey = "guest" | "member" | "admin";

export default function SuperAdminRichMenuPage() {
  const [token, setToken] = useState("");
  const [liffLoginUrl, setLiffLoginUrl] = useState("");
  const [liffPaymentUrl, setLiffPaymentUrl] = useState("");
  const [liffProfileUrl, setLiffProfileUrl] = useState("");
  const [liffRepairUrl, setLiffRepairUrl] = useState("");
  const [liffRoomsUrl, setLiffRoomsUrl] = useState("");
  const [liffBookingUrl, setLiffBookingUrl] = useState("");
  const [contactUrl, setContactUrl] = useState("");

  const [images, setImages] = useState({ guest: "", member: "", admin: "" });
  const [validating, setValidating] = useState({ guest: false, member: false, admin: false });

  const [prevGuestId, setPrevGuestId] = useState("");
  const [prevMemberId, setPrevMemberId] = useState("");
  const [prevAdminId, setPrevAdminId] = useState("");

  const [creating, setCreating] = useState(false);
  const [resultMsg, setResultMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [menuIds, setMenuIds] = useState({ guest: "", member: "", admin: "" });

  const guestFileRef = useRef<HTMLInputElement>(null);
  const memberFileRef = useRef<HTMLInputElement>(null);
  const adminFileRef = useRef<HTMLInputElement>(null);

  // ตรวจขนาดรูปให้ตรง 2500x1686 พิกเซลเป๊ะก่อน (LINE ปฏิเสธรูปที่ขนาดไม่ตรงตอนสร้างเมนู) — เก็บเป็น
  // dataURL ไว้ในหน่วยความจำเฉยๆ ไม่มีการอัปโหลดแยกขั้นตอนแบบ SettingsPage.tsx (ส่งไปพร้อมกันตอนกด "สร้าง")
  function handleFile(menu: RichMenuKey, file: File) {
    setValidating((prev) => ({ ...prev, [menu]: true }));
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        if (img.width !== RICHMENU_WIDTH || img.height !== RICHMENU_HEIGHT) {
          toastError(`รูปต้องมีขนาด ${RICHMENU_WIDTH}x${RICHMENU_HEIGHT} พิกเซลเป๊ะ (รูปนี้ ${img.width}x${img.height})`);
          setValidating((prev) => ({ ...prev, [menu]: false }));
          return;
        }
        setImages((prev) => ({ ...prev, [menu]: dataUrl }));
        setValidating((prev) => ({ ...prev, [menu]: false }));
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
        token: token.trim(),
        liffLoginUrl: liffLoginUrl.trim(), liffPaymentUrl: liffPaymentUrl.trim(),
        liffProfileUrl: liffProfileUrl.trim(), liffRepairUrl: liffRepairUrl.trim(),
        liffRoomsUrl: liffRoomsUrl.trim(), liffBookingUrl: liffBookingUrl.trim(),
        contactUrl: contactUrl.trim(),
        images,
        previousIds: { guest: prevGuestId.trim(), member: prevMemberId.trim(), admin: prevAdminId.trim() },
      });
      setMenuIds(result.menuIds);
      if (result.defaultSet) {
        setResultMsg({ type: "success", text: "สร้าง Rich Menu ทั้ง 3 แบบสำเร็จ และตั้งเมนู Guest เป็นค่าเริ่มต้นของผู้ใช้ทุกคนแล้ว" });
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

  const canCreate = !creating && token.trim() && liffLoginUrl.trim() && liffPaymentUrl.trim()
    && images.guest && images.member && images.admin;

  return (
    <div className="detail-section custom-card">
      <div className="detail-section-header">
        <h6 className="mb-0"><i className="fas fa-border-all me-2" />สร้าง Rich Menu สำหรับ LINE OA อื่น</h6>
      </div>

      <div className="p-3">
        <p className="text-muted small mb-3">
          เครื่องมือนี้ไม่ผูกกับองค์กรไหนในระบบเลย — ใช้สร้างเมนู Guest/Member/Admin ให้ LINE Official Account
          ใดก็ได้ที่คุณมี Channel Access Token (เช่น บัญชีทดลอง/ของทีมงานเอง) ค่าที่กรอกในหน้านี้ไม่ถูกบันทึกไว้
          ที่ไหน — ปิดหรือรีเฟรชหน้าแล้วต้องกรอกใหม่ทั้งหมด
        </p>

        <div className="mb-3">
          <label className="form-label small fw-bold">LINE Channel Access Token</label>
          <input type="password" className="form-control" placeholder="วาง Channel Access Token ของ LINE OA เป้าหมาย"
            value={token} onChange={(e) => setToken(e.target.value)} />
        </div>

        <div className="row g-3 mb-3">
          <div className="col-md-6">
            <label className="form-label small fw-bold">LIFF Login URL <span className="text-muted fw-normal">(ปุ่มใหญ่บนเมนู Guest)</span></label>
            <input type="text" className="form-control" placeholder="https://liff.line.me/xxxxxxxxxx-xxxxxxxx"
              value={liffLoginUrl} onChange={(e) => setLiffLoginUrl(e.target.value)} />
          </div>
          <div className="col-md-6">
            <label className="form-label small fw-bold">LIFF Payment URL <span className="text-muted fw-normal">(ปุ่มชำระเงินบนเมนู Member)</span></label>
            <input type="text" className="form-control" placeholder="https://liff.line.me/xxxxxxxxxx-xxxxxxxx"
              value={liffPaymentUrl} onChange={(e) => setLiffPaymentUrl(e.target.value)} />
          </div>
          <div className="col-md-6">
            <label className="form-label small fw-bold">LIFF Profile URL <span className="text-muted fw-normal">(ไม่บังคับ)</span></label>
            <input type="text" className="form-control" placeholder="https://liff.line.me/xxxxxxxxxx-xxxxxxxx"
              value={liffProfileUrl} onChange={(e) => setLiffProfileUrl(e.target.value)} />
          </div>
          <div className="col-md-6">
            <label className="form-label small fw-bold">LIFF Repair URL <span className="text-muted fw-normal">(ไม่บังคับ)</span></label>
            <input type="text" className="form-control" placeholder="https://liff.line.me/xxxxxxxxxx-xxxxxxxx"
              value={liffRepairUrl} onChange={(e) => setLiffRepairUrl(e.target.value)} />
          </div>
          <div className="col-md-6">
            <label className="form-label small fw-bold">LIFF Rooms URL <span className="text-muted fw-normal">(ไม่บังคับ)</span></label>
            <input type="text" className="form-control" placeholder="https://liff.line.me/xxxxxxxxxx-xxxxxxxx"
              value={liffRoomsUrl} onChange={(e) => setLiffRoomsUrl(e.target.value)} />
          </div>
          <div className="col-md-6">
            <label className="form-label small fw-bold">LIFF Booking URL <span className="text-muted fw-normal">(ไม่บังคับ)</span></label>
            <input type="text" className="form-control" placeholder="https://liff.line.me/xxxxxxxxxx-xxxxxxxx"
              value={liffBookingUrl} onChange={(e) => setLiffBookingUrl(e.target.value)} />
          </div>
          <div className="col-md-6">
            <label className="form-label small fw-bold">Contact URL <span className="text-muted fw-normal">(ไม่บังคับ — ปุ่ม "ติดต่อ")</span></label>
            <input type="text" className="form-control" placeholder="https://... หรือเว้นว่างไว้"
              value={contactUrl} onChange={(e) => setContactUrl(e.target.value)} />
          </div>
          <div className="col-12">
            <div className="form-text small">ช่องที่ไม่บังคับถ้าเว้นว่างไว้ ปุ่มนั้นจะยังส่งข้อความเข้าแชทแบบเดิมแทน</div>
          </div>
        </div>

        <div className="row g-3 mb-3">
          {([
            { key: "guest" as RichMenuKey, label: "เมนู Guest", desc: "1 ปุ่มใหญ่บน + 3 ปุ่มล่าง", ref: guestFileRef },
            { key: "member" as RichMenuKey, label: "เมนู Member", desc: "6 ปุ่ม (3x2)", ref: memberFileRef },
            { key: "admin" as RichMenuKey, label: "เมนู Admin", desc: "6 ปุ่ม (3x2)", ref: adminFileRef },
          ]).map((m) => (
            <div className="col-md-4" key={m.key}>
              <label className="form-label small fw-bold">{m.label}</label>
              <div className="p-2 rounded" style={{ border: "1px solid var(--color-light)", background: "var(--color-background)" }}>
                <div style={{
                  width: "100%", aspectRatio: `${RICHMENU_WIDTH} / ${RICHMENU_HEIGHT}`, borderRadius: 8, overflow: "hidden",
                  background: "#fff", border: "1px solid var(--color-light)", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {images[m.key]
                    ? <img src={images[m.key]} alt={m.label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span className="text-muted small"><i className="fas fa-image me-1" />ยังไม่มีรูป</span>}
                </div>
                <div className="text-muted small mt-1 mb-2">{m.desc} — ขนาด {RICHMENU_WIDTH}x{RICHMENU_HEIGHT} พิกเซล</div>
                <button className="btn btn-sm btn-outline-secondary w-100" type="button" disabled={validating[m.key]}
                  onClick={() => m.ref.current?.click()}>
                  {validating[m.key]
                    ? <><span className="spinner-border spinner-border-sm me-1" />กำลังตรวจสอบ...</>
                    : <><i className="fas fa-upload me-1" />{images[m.key] ? "เปลี่ยนรูป" : "เลือกรูป"}</>}
                </button>
                <input ref={m.ref} type="file" accept="image/png,image/jpeg" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(m.key, f); e.target.value = ""; }} />
              </div>
            </div>
          ))}
        </div>

        <div className="detail-section mb-3" style={{ background: "var(--color-background)", border: "1px solid var(--color-light)" }}>
          <label className="form-label small fw-bold mb-2">
            <i className="fas fa-recycle me-1" />ID เมนูเดิมที่จะแทนที่ <span className="text-muted fw-normal">(ไม่บังคับ — กรอกถ้าเคยสร้างชุดนี้ไว้แล้วและอยากลบของเดิมทิ้งก่อน)</span>
          </label>
          <div className="row g-2">
            <div className="col-md-4">
              <input className="form-control form-control-sm" placeholder="Guest richMenuId เดิม" value={prevGuestId} onChange={(e) => setPrevGuestId(e.target.value)} />
            </div>
            <div className="col-md-4">
              <input className="form-control form-control-sm" placeholder="Member richMenuId เดิม" value={prevMemberId} onChange={(e) => setPrevMemberId(e.target.value)} />
            </div>
            <div className="col-md-4">
              <input className="form-control form-control-sm" placeholder="Admin richMenuId เดิม" value={prevAdminId} onChange={(e) => setPrevAdminId(e.target.value)} />
            </div>
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
            : <><i className="fas fa-magic me-2" />สร้าง Rich Menu ทั้ง 3 แบบ</>}
        </button>

        {(menuIds.guest || menuIds.member || menuIds.admin) && (
          <div className="mt-3 small text-muted">
            <div><i className="fas fa-check-circle text-success me-1" />Guest ID: <code>{menuIds.guest || "-"}</code></div>
            <div><i className="fas fa-check-circle text-success me-1" />Member ID: <code>{menuIds.member || "-"}</code></div>
            <div><i className="fas fa-check-circle text-success me-1" />Admin ID: <code>{menuIds.admin || "-"}</code></div>
          </div>
        )}
      </div>
    </div>
  );
}
