// หน้า "ติดต่อ" — ปลายทางของปุ่ม "ติดต่อ" บนเมนู Guest/Member เป็นหน้าสาธารณะธรรมดา ไม่ต้องรู้ตัวตนผู้เช่า
// จึงไม่ต้องผ่าน LIFF SDK เลย (ต่างจากหน้า LIFF Login/Payment/Profile/Repair) แค่ดึงเบอร์ติดต่อที่ตั้งไว้ใน
// หน้า Settings > LINE Rich Menu มาแสดง
import { useEffect, useState } from "react";
import { liffApi } from "../api/client";

export default function ContactPage() {
  const [phone, setPhone] = useState("");
  const [branding, setBranding] = useState({ logoUrl: "", nameText: "" });
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    liffApi.getConfig()
      .then((cfg) => {
        setPhone(cfg.contactPhone);
        setBranding({ logoUrl: cfg.appIdentity.logoUrl, nameText: cfg.appIdentity.nameText });
      })
      .finally(() => setLoading(false));
  }, []);

  function copyPhone() {
    navigator.clipboard.writeText(phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="login-page-wrap">
      <div className="login-card custom-card text-center">
        {branding.logoUrl
          ? <img src={branding.logoUrl} alt="" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: "50%", margin: "0 auto", display: "block" }} />
          : <div className="login-icon"><i className="fas fa-phone" /></div>}
        <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>{branding.nameText || "ติดต่อเรา"}</h5>

        {loading ? (
          <div className="py-4"><div className="spinner-border" style={{ color: "var(--color-primary)" }} /></div>
        ) : phone ? (
          <div className="py-3">
            <div className="login-icon mb-3" style={{ background: "rgba(27,156,133,0.15)", color: "var(--color-success)" }}>
              <i className="fas fa-phone-alt" />
            </div>
            <div className="fw-bold fs-4 mb-3" style={{ color: "var(--color-primary)" }}>{phone}</div>
            <div className="d-flex gap-2">
              <a href={`tel:${phone}`} className="btn btn-primary flex-grow-1"><i className="fas fa-phone me-1" />โทรเลย</a>
              <button className="btn btn-outline-secondary" type="button" onClick={copyPhone} title="คัดลอกเบอร์">
                <i className={`fas ${copied ? "fa-check" : "fa-copy"}`} />
              </button>
            </div>
          </div>
        ) : (
          <div className="room-modal-error mt-3"><i className="fas fa-exclamation-circle me-2" />ยังไม่ได้ตั้งค่าเบอร์ติดต่อ กรุณาติดต่อผู้ดูแลระบบ</div>
        )}
      </div>
    </div>
  );
}
