// หน้า LIFF Login — ปลายทางของปุ่มใหญ่บนเมนู Guest (LIFF Login URL ที่ตั้งค่าไว้ในหน้า Settings >
// LINE Rich Menu) เปิดในเบราว์เซอร์ในตัวของ LINE เอง ไม่ผ่านระบบล็อกอินพนักงาน (ไม่มี Sidebar/Header)
// ยืนยันตัวตนด้วย LIFF access token ของผู้ใช้ LINE เอง ส่งให้ backend ตรวจกับ LINE ตรงๆ อีกที (ดู
// verifyLiffAccessToken ใน backend/src/services/line.ts) แล้วผูก Rich Menu แบบ Member ให้อัตโนมัติถ้า
// เจอว่า LINE นี้ผูกกับผู้เช่าอยู่แล้ว
import { useEffect, useState } from "react";
import liff from "@line/liff";
import { liffApi, startLiffPresenceHeartbeat } from "../api/client";
import { extractLiffId } from "../utils/liffHelpers";
import LiffThemeToggle from "../components/LiffThemeToggle";

type Status = "loading" | "linked" | "unlinked" | "error";

export default function LiffLoginPage() {
  // รหัสองค์กร (?org=<slug>) จาก Endpoint URL ของ LIFF app นี้เอง — ตั้งค่าไว้ใน LINE Developers Console ต่อ
  // องค์กร (ดู resolveOrgId ใน backend/src/routes/liff.ts) อ่านทุก render (เบา ไม่ต้องพึ่ง state) รอดผ่านรอบ
  // liff.login() redirect ได้เพราะเป็นการโหลดหน้าใหม่ทั้งหน้า (LIFF SDK คืน URL เดิมพร้อม query string เดิม
  // กลับมาเสมอ — เหมือนที่ billId/roomId ใน LiffPaymentPage.tsx รอดผ่านรอบเดียวกันนี้ได้) undefined ถ้าไม่มี
  // (ระบบยังมีองค์กรเดียว — ดู resolveOrgIdWithFallback ใน backend/src/lib/orgContext.ts)
  const org = new URLSearchParams(window.location.search).get("org") || undefined;
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [lineUserId, setLineUserId] = useState("");
  const [copied, setCopied] = useState(false);
  const [branding, setBranding] = useState({ logoUrl: "", nameText: "" });
  const [accessToken, setAccessToken] = useState("");
  const [phone, setPhone] = useState("");
  const [linkingPhone, setLinkingPhone] = useState(false);
  const [phoneError, setPhoneError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let stopPresence: (() => void) | null = null;
    (async () => {
      try {
        const cfg = await liffApi.getConfig(org);
        if (cancelled) return;
        setBranding({ logoUrl: cfg.appIdentity.logoUrl, nameText: cfg.appIdentity.nameText });

        const liffId = extractLiffId(cfg.liffLoginUrl);
        if (!liffId) { setErrorMsg("ระบบยังไม่ได้ตั้งค่า LIFF Login URL กรุณาติดต่อผู้ดูแลระบบ"); setStatus("error"); return; }

        await liff.init({ liffId });
        // ยังไม่ได้ล็อกอิน LINE — liff.login() จะ redirect ออกจากหน้านี้ไปหน้ายืนยันตัวตนของ LINE เอง
        // แล้วเด้งกลับมาที่หน้านี้อีกครั้งพร้อมสถานะล็อกอินแล้ว (โค้ดด้านล่างจะไม่ทำงานต่อในรอบนี้)
        if (!liff.isLoggedIn()) { liff.login(); return; }

        const token = liff.getAccessToken();
        if (!token) { setErrorMsg("ไม่พบ Access Token จาก LINE กรุณาลองใหม่อีกครั้ง"); setStatus("error"); return; }
        setAccessToken(token);
        if (!cancelled) stopPresence = startLiffPresenceHeartbeat(token, "login", org);

        const result = await liffApi.login(token, org);
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
    return () => { cancelled = true; stopPresence?.(); };
  }, []);

  function copyLineUserId() {
    navigator.clipboard.writeText(lineUserId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleLinkPhone(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) { setPhoneError("กรุณากรอกเบอร์โทรศัพท์"); return; }
    setLinkingPhone(true); setPhoneError("");
    try {
      const result = await liffApi.linkPhone(accessToken, phone.trim(), org);
      setTenantName(result.tenantName);
      setRoomNumber(result.roomNumber);
      setStatus("linked");
    } catch (e: any) {
      setPhoneError(e?.response?.data?.error ?? e?.message ?? "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setLinkingPhone(false);
    }
  }

  return (
    <div className="login-page-wrap">
      <LiffThemeToggle />
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

            <p className="text-muted small mb-2">กรอกเบอร์โทรศัพท์ที่แจ้งไว้กับหอพัก เพื่อเข้าสู่ระบบทันที</p>
            <form onSubmit={handleLinkPhone}>
              <div className="input-group mb-1">
                <span className="input-group-text"><i className="fas fa-phone" /></span>
                <input type="tel" className="form-control" placeholder="08xxxxxxxx" autoFocus
                  value={phone} onChange={(e) => setPhone(e.target.value)} disabled={linkingPhone} />
              </div>
              {phoneError && (
                <div className="room-modal-error mb-2"><i className="fas fa-exclamation-circle me-2" />{phoneError}</div>
              )}
              <button type="submit" className="btn btn-primary w-100 mb-3" disabled={linkingPhone}>
                {linkingPhone
                  ? <><span className="spinner-border spinner-border-sm me-2" />กำลังเข้าสู่ระบบ...</>
                  : <><i className="fas fa-sign-in-alt me-2" />เข้าสู่ระบบด้วยเบอร์โทร</>}
              </button>
            </form>

            <div className="d-flex align-items-center gap-2 text-muted small mb-3">
              <hr className="flex-grow-1 m-0" /><span>หรือ</span><hr className="flex-grow-1 m-0" />
            </div>

            <p className="text-muted small">ถ้าเบอร์โทรไม่ตรงกับข้อมูลในระบบ ให้แจ้ง LINE User ID ด้านล่างนี้กับผู้ดูแลหอพักแทน</p>
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
