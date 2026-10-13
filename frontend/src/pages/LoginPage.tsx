import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { authApi } from "../api/client";

export default function LoginPage() {
  const { user, login, sessionRevoked } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // ขั้นตอน "ล็อกอินครั้งแรก" 3 ขั้น: กรอกเบอร์ที่ผู้ดูแลระบบสร้างให้ → ยืนยันแล้วค่อยตั้ง username/password
  // ของตัวเอง → เสร็จแล้วค่อยกดเชื่อม LINE ต่อ (ไปหน้า LINE OAuth จริง) ดู routes/lineLogin.ts ฝั่ง backend —
  // ซ่อนไว้ก่อนจนกว่าจะกด "เข้าสู่ระบบด้วย LINE" แล้วเจอว่ายังไม่มีบัญชี (lineLoginError ส่งกลับมา ดู useEffect
  // ด้านล่าง) ถึงจะโผล่ขึ้นมา กันคนที่มีบัญชีเชื่อม LINE อยู่แล้วเห็นฟอร์มนี้รกหน้าไปเปล่าๆ
  const [showFirstTimeFlow, setShowFirstTimeFlow] = useState(false);
  const [firstTimeStep, setFirstTimeStep] = useState<"phone" | "credentials" | "done">("phone");
  const [firstTimePhone, setFirstTimePhone] = useState("");
  const [firstTimeUsername, setFirstTimeUsername] = useState("");
  const [firstTimePassword, setFirstTimePassword] = useState("");
  const [firstTimeConfirmPassword, setFirstTimeConfirmPassword] = useState("");
  const [firstTimeSubmitting, setFirstTimeSubmitting] = useState(false);
  const [firstTimeError, setFirstTimeError] = useState("");

  function resetFirstTimeFlow() {
    setFirstTimeStep("phone");
    setFirstTimePhone(""); setFirstTimeUsername(""); setFirstTimePassword(""); setFirstTimeConfirmPassword("");
    setFirstTimeError("");
  }

  async function handleCheckPhone() {
    setFirstTimeError("");
    setFirstTimeSubmitting(true);
    try {
      await authApi.checkFirstTimePhone(firstTimePhone.trim());
      setFirstTimeStep("credentials");
    } catch (err: any) {
      setFirstTimeError(err?.response?.data?.error ?? "ตรวจสอบเบอร์ไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setFirstTimeSubmitting(false);
    }
  }

  async function handleSetCredentials() {
    setFirstTimeError("");
    if (!firstTimeUsername.trim()) { setFirstTimeError("กรุณากรอกชื่อผู้ใช้"); return; }
    if (firstTimePassword.length < 6) { setFirstTimeError("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"); return; }
    if (firstTimePassword !== firstTimeConfirmPassword) { setFirstTimeError("รหัสผ่านทั้งสองช่องไม่ตรงกัน"); return; }
    setFirstTimeSubmitting(true);
    try {
      await authApi.setFirstTimeCredentials(firstTimePhone.trim(), firstTimeUsername.trim(), firstTimePassword, firstTimeConfirmPassword);
      setFirstTimeStep("done");
    } catch (err: any) {
      setFirstTimeError(err?.response?.data?.error ?? "บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setFirstTimeSubmitting(false);
    }
  }

  // ล็อกอินอยู่แล้ว ไม่ควรเห็นหน้านี้ — เด้งกลับเข้าแอปทันที
  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  // ข้อผิดพลาดจากขั้นตอน LINE Login (redirect กลับมาพร้อม ?lineLoginError=... — ดู
  // backend/src/routes/lineLogin.ts) แสดงเป็นข้อความเดียวกับฟอร์ม username/password แล้วล้าง query ทิ้ง
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lineLoginError = params.get("lineLoginError");
    if (lineLoginError) {
      setError(lineLoginError);
      setShowFirstTimeFlow(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password) {
      setError("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน");
      return;
    }
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page-wrap">
      <div className="login-card custom-card">
        <div className="text-center mb-4">
          <div className="login-icon"><i className="fas fa-house-lock" /></div>
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>เข้าสู่ระบบ</h5>
          <p className="text-muted small mb-0">เจ้าของหอพักเข้าสู่ระบบด้วย LINE หรือพนักงานใช้ชื่อผู้ใช้/รหัสผ่าน</p>
        </div>

        {sessionRevoked && (
          <div className="room-modal-error mb-3">
            <i className="fas fa-exclamation-circle me-2" />
            บัญชีนี้ถูกเข้าสู่ระบบจากอีกเครื่องหนึ่ง ระบบจึงออกจากระบบเครื่องนี้ให้อัตโนมัติ
          </div>
        )}

        {error && <div className="room-modal-error mb-3"><i className="fas fa-exclamation-circle me-2" />{error}</div>}

        {/* ลิงก์นำทางไปหน้า LINE จริง (ไม่ใช่ fetch) เพราะ OAuth ต้องเป็นการเปลี่ยนหน้าเต็มรูปแบบ */}
        <a href="/api/auth/line/authorize" className="btn btn-success w-100 mb-2">
          <i className="fab fa-line me-2" />เข้าสู่ระบบด้วย LINE
        </a>

        {showFirstTimeFlow && (
        <>
        <p className="text-muted small text-center mb-2">
          ยังไม่มีบัญชีที่เชื่อมกับ LINE นี้ — กรอกเบอร์ที่ผู้ดูแลระบบสร้างให้ด้านล่างนี้เพื่อเชื่อมบัญชี
        </p>

        <div className="mb-3 p-3" style={{ background: "var(--color-background)", borderRadius: "var(--border-radius-1)" }}>
            {/* หัวขั้นตอน — จุดไล่ระดับบอกว่าตอนนี้อยู่ขั้นไหนจาก 3 ขั้น */}
            <div className="d-flex align-items-center justify-content-center gap-2 mb-3">
              {(["phone", "credentials", "done"] as const).map((s, i) => (
                <div key={s} className="d-flex align-items-center gap-2">
                  <span className={`d-inline-flex align-items-center justify-content-center ${firstTimeStep === s ? "bg-success text-white" : "bg-light text-muted"}`}
                    style={{ width: 24, height: 24, borderRadius: "50%", fontSize: 12, fontWeight: 700 }}>
                    {(["phone", "credentials", "done"] as const).indexOf(firstTimeStep) > i ? <i className="fas fa-check" style={{ fontSize: 10 }} /> : i + 1}
                  </span>
                  {i < 2 && <hr className="m-0" style={{ width: 20 }} />}
                </div>
              ))}
            </div>

            {firstTimeError && <div className="room-modal-error mb-3"><i className="fas fa-exclamation-circle me-2" />{firstTimeError}</div>}

            {firstTimeStep === "phone" && (
              <>
                <label className="form-label small fw-bold">1. เบอร์โทรที่ได้รับจากผู้ดูแลระบบ</label>
                <input type="tel" className="form-control mb-2" value={firstTimePhone}
                  onChange={(e) => setFirstTimePhone(e.target.value)} placeholder="เช่น 0812345678"
                  onKeyDown={(e) => { if (e.key === "Enter") handleCheckPhone(); }} />
                <button type="button" className="btn btn-success w-100"
                  disabled={firstTimeSubmitting || firstTimePhone.replace(/\D/g, "").length < 9}
                  onClick={handleCheckPhone}>
                  {firstTimeSubmitting ? <span className="spinner-border spinner-border-sm" /> : "ตรวจสอบเบอร์"}
                </button>
                <p className="text-muted small mt-1 mb-0">เบอร์นี้ต้องเป็นเบอร์ที่ผู้ดูแลระบบสร้างบัญชีไว้ให้ล่วงหน้าเท่านั้น</p>
              </>
            )}

            {firstTimeStep === "credentials" && (
              <>
                <label className="form-label small fw-bold">2. ตั้งชื่อผู้ใช้ที่ต้องการ (ห้ามซ้ำ)</label>
                <input className="form-control mb-2" value={firstTimeUsername}
                  onChange={(e) => setFirstTimeUsername(e.target.value)} placeholder="username" />

                <label className="form-label small fw-bold">3. ตั้งรหัสผ่าน (อย่างน้อย 6 ตัวอักษร)</label>
                <input type="password" autoComplete="new-password" className="form-control mb-2" value={firstTimePassword}
                  onChange={(e) => setFirstTimePassword(e.target.value)} placeholder="••••••••" />
                <input type="password" autoComplete="new-password" className="form-control mb-2" value={firstTimeConfirmPassword}
                  onChange={(e) => setFirstTimeConfirmPassword(e.target.value)} placeholder="ยืนยันรหัสผ่านอีกครั้ง"
                  onKeyDown={(e) => { if (e.key === "Enter") handleSetCredentials(); }} />

                <button type="button" className="btn btn-success w-100 mb-2" disabled={firstTimeSubmitting} onClick={handleSetCredentials}>
                  {firstTimeSubmitting
                    ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
                    : "บันทึกและดำเนินการต่อ"}
                </button>
                <button type="button" className="btn btn-link btn-sm w-100 text-decoration-none" disabled={firstTimeSubmitting} onClick={resetFirstTimeFlow}>
                  กรอกเบอร์ผิด? ย้อนกลับไปแก้เบอร์
                </button>
              </>
            )}

            {firstTimeStep === "done" && (
              <div className="text-center">
                <i className="fas fa-circle-check text-success mb-2" style={{ fontSize: 28 }} />
                <p className="small mb-3">
                  ตั้งชื่อผู้ใช้ <strong>{firstTimeUsername}</strong> เรียบร้อยแล้ว ขั้นตอนสุดท้ายคือเชื่อมบัญชี LINE ของคุณเข้ากับบัญชีนี้
                </p>
                <a href={`/api/auth/line/authorize?phone=${encodeURIComponent(firstTimePhone.trim())}`} className="btn btn-success w-100">
                  <i className="fab fa-line me-2" />เชื่อม LINE เพื่อเข้าสู่ระบบ
                </a>
                <p className="text-muted small mt-2 mb-0">ครั้งต่อไปกดปุ่ม "เข้าสู่ระบบด้วย LINE" ด้านบนได้เลย หรือใช้ชื่อผู้ใช้/รหัสผ่านที่เพิ่งตั้งก็ได้</p>
              </div>
            )}
        </div>
        </>
        )}

        <div className="d-flex align-items-center gap-2 mb-3">
          <hr className="flex-grow-1 m-0" />
          <small className="text-muted">หรือ</small>
          <hr className="flex-grow-1 m-0" />
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="form-label small fw-bold">ชื่อผู้ใช้</label>
            <input className="form-control" value={username}
              onChange={(e) => setUsername(e.target.value)} placeholder="username" />
          </div>

          <div className="mb-3">
            <label className="form-label small fw-bold">รหัสผ่าน</label>
            <input type="password" autoComplete="current-password" className="form-control" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>

          <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
            {submitting
              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังดำเนินการ...</>
              : <><i className="fas fa-sign-in-alt me-2" />เข้าสู่ระบบ</>}
          </button>
        </form>
      </div>
    </div>
  );
}
