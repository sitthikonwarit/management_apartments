import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { user, login, sessionRevoked } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [showFirstTimeLogin, setShowFirstTimeLogin] = useState(false);
  const [firstTimePhone, setFirstTimePhone] = useState("");

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

        <button type="button" className="btn btn-link btn-sm w-100 mb-3 text-decoration-none"
          onClick={() => setShowFirstTimeLogin((v) => !v)}>
          {showFirstTimeLogin ? "ยกเลิก" : "เจ้าของใหม่ที่ยังไม่เคยเชื่อมบัญชี LINE? ล็อกอินครั้งแรกที่นี่"}
        </button>

        {showFirstTimeLogin && (
          <div className="mb-3">
            <label className="form-label small fw-bold">เบอร์โทรที่ได้รับจากผู้ดูแลระบบ</label>
            <div className="d-flex gap-2">
              <input type="tel" className="form-control" value={firstTimePhone}
                onChange={(e) => setFirstTimePhone(e.target.value)} placeholder="เช่น 0812345678" />
              <button type="button" className="btn btn-success flex-shrink-0"
                disabled={firstTimePhone.replace(/\D/g, "").length < 9}
                onClick={() => { window.location.href = `/api/auth/line/authorize?phone=${encodeURIComponent(firstTimePhone.trim())}`; }}>
                <i className="fab fa-line me-1" />เชื่อม LINE
              </button>
            </div>
            <p className="text-muted small mt-1 mb-0">ใช้ครั้งแรกครั้งเดียวเท่านั้น — ครั้งต่อไปกดปุ่ม "เข้าสู่ระบบด้วย LINE" ด้านบนได้เลย</p>
          </div>
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
            <input type="password" className="form-control" value={password}
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
