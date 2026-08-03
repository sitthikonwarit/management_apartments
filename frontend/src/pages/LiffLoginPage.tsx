// หน้า LIFF Login — ปลายทางของปุ่มใหญ่บนเมนู Guest (LIFF Login URL ที่ตั้งค่าไว้ในหน้า Settings >
// LINE Rich Menu) เปิดในเบราว์เซอร์ในตัวของ LINE เอง ไม่ผ่านระบบล็อกอินพนักงาน (ไม่มี Sidebar/Header)
// ยืนยันตัวตนด้วย LIFF access token ของผู้ใช้ LINE เอง ส่งให้ backend ตรวจกับ LINE ตรงๆ อีกที (ดู
// verifyLiffAccessToken ใน backend/src/services/line.ts) แล้วผูก Rich Menu แบบ Member ให้อัตโนมัติถ้า
// เจอว่า LINE นี้ผูกกับผู้เช่าอยู่แล้ว
import { useEffect, useState } from "react";
import liff from "@line/liff";
import { liffApi } from "../api/client";
import { extractLiffId } from "../utils/liffHelpers";

type Status = "loading" | "linked" | "unlinked" | "error";

export default function LiffLoginPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [lineUserId, setLineUserId] = useState("");
  const [copied, setCopied] = useState(false);
  const [branding, setBranding] = useState({ logoUrl: "", nameText: "" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await liffApi.getConfig();
        if (cancelled) return;
        setBranding({ logoUrl: cfg.appIdentity.logoUrl, nameText: cfg.appIdentity.nameText });

        const liffId = extractLiffId(cfg.liffLoginUrl);
        if (!liffId) { setErrorMsg("ระบบยังไม่ได้ตั้งค่า LIFF Login URL กรุณาติดต่อผู้ดูแลระบบ"); setStatus("error"); return; }

        await liff.init({ liffId });
        // ยังไม่ได้ล็อกอิน LINE — liff.login() จะ redirect ออกจากหน้านี้ไปหน้ายืนยันตัวตนของ LINE เอง
        // แล้วเด้งกลับมาที่หน้านี้อีกครั้งพร้อมสถานะล็อกอินแล้ว (โค้ดด้านล่างจะไม่ทำงานต่อในรอบนี้)
        if (!liff.isLoggedIn()) { liff.login(); return; }

        const accessToken = liff.getAccessToken();
        if (!accessToken) { setErrorMsg("ไม่พบ Access Token จาก LINE กรุณาลองใหม่อีกครั้ง"); setStatus("error"); return; }

        const result = await liffApi.login(accessToken);
        if (cancelled) return;
        if (result.linked) {
          setTenantName(result.tenantName);
          setRoomNumber(result.roomNumber);
          setStatus("linked");
        } else {
          setLineUserId(result.lineUserId);
          setStatus("unlinked");
        }
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(e?.response?.data?.error ?? e?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
        setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function copyLineUserId() {
    navigator.clipboard.writeText(lineUserId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="login-page-wrap">
      <div className="login-card custom-card text-center">
        {branding.logoUrl
          ? <img src={branding.logoUrl} alt="" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: "50%", margin: "0 auto", display: "block" }} />
          : <div className="login-icon"><i className="fab fa-line" /></div>}
        <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>{branding.nameText || "เข้าสู่ระบบ"}</h5>

        {status === "loading" && (
          <div className="py-4">
            <div className="spinner-border" style={{ color: "var(--color-primary)" }} />
            <p className="text-muted small mt-3 mb-0">กำลังเข้าสู่ระบบผ่าน LINE...</p>
          </div>
        )}

        {status === "linked" && (
          <div className="py-3">
            <div className="login-icon mb-3" style={{ background: "rgba(27,156,133,0.15)", color: "var(--color-success)" }}>
              <i className="fas fa-check-circle" />
            </div>
            <p className="mb-1">ยินดีต้อนรับคุณ <strong>{tenantName}</strong></p>
            {roomNumber && <p className="text-muted small mb-3">ห้อง {roomNumber}</p>}
            <div className="alert alert-success py-2 px-3 small mb-0">
              เข้าสู่ระบบสำเร็จ เมนูด้านล่างช่องแชทถูกเปลี่ยนเป็นเมนูสมาชิกให้แล้ว ปิดหน้านี้แล้วกลับไปที่แชทได้เลย
            </div>
          </div>
        )}

        {status === "unlinked" && (
          <div className="py-3 text-start">
            <div className="room-modal-error mb-3">
              <i className="fas fa-exclamation-circle me-2" />ยังไม่พบข้อมูลผู้เช่าที่ผูกกับบัญชี LINE นี้
            </div>
            <p className="text-muted small">กรุณาแจ้ง LINE User ID ด้านล่างนี้ให้ผู้ดูแลหอพัก เพื่อผูกบัญชีให้ที่หน้า "ผู้เช่า" ในระบบ</p>
            <div className="input-group mb-2">
              <input type="text" className="form-control font-monospace small" readOnly value={lineUserId} />
              <button className="btn btn-outline-secondary" type="button" onClick={copyLineUserId} title="คัดลอก">
                <i className={`fas ${copied ? "fa-check" : "fa-copy"}`} />
              </button>
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="room-modal-error mt-3">
            <i className="fas fa-exclamation-circle me-2" />{errorMsg}
          </div>
        )}
      </div>
    </div>
  );
}
