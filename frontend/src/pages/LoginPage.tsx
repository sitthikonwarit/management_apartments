import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { user, login, register, sessionRevoked } = useAuth();
  const navigate = useNavigate();

  const [checkingSetup, setCheckingSetup] = useState(true);
  const [isFirstRun, setIsFirstRun] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // ล็อกอินอยู่แล้ว ไม่ควรเห็นหน้านี้ — เด้งกลับเข้าแอปทันที
  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    authApi.setupStatus()
      .then((res) => setIsFirstRun(!res.hasUsers))
      .catch(() => setIsFirstRun(false))
      .finally(() => setCheckingSetup(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password) {
      setError("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน");
      return;
    }
    if (isFirstRun) {
      if (password.length < 6) { setError("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"); return; }
      if (password !== confirmPassword) { setError("รหัสผ่านยืนยันไม่ตรงกัน"); return; }
    }
    setSubmitting(true);
    try {
      if (isFirstRun) {
        await register(username.trim(), password, displayName.trim() || undefined);
      } else {
        await login(username.trim(), password);
      }
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingSetup) {
    return (
      <div className="login-page-wrap">
        <div className="spinner-border" style={{ color: "var(--color-primary)" }} />
      </div>
    );
  }

  return (
    <div className="login-page-wrap">
      <div className="login-card custom-card">
        <div className="text-center mb-4">
          <div className="login-icon"><i className="fas fa-house-lock" /></div>
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>
            {isFirstRun ? "ตั้งค่าบัญชีผู้ดูแลระบบแรก" : "เข้าสู่ระบบ"}
          </h5>
          <p className="text-muted small mb-0">
            {isFirstRun ? "ยังไม่มีผู้ใช้ในระบบ กรุณาสร้างบัญชีแรกเพื่อเริ่มใช้งาน" : "กรอกชื่อผู้ใช้และรหัสผ่านเพื่อเข้าใช้งาน"}
          </p>
        </div>

        {sessionRevoked && !isFirstRun && (
          <div className="room-modal-error mb-3">
            <i className="fas fa-exclamation-circle me-2" />
            บัญชีนี้ถูกเข้าสู่ระบบจากอีกเครื่องหนึ่ง ระบบจึงออกจากระบบเครื่องนี้ให้อัตโนมัติ
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="form-label small fw-bold">ชื่อผู้ใช้</label>
            <input className="form-control" autoFocus value={username}
              onChange={(e) => setUsername(e.target.value)} placeholder="username" />
          </div>

          {isFirstRun && (
            <div className="mb-3">
              <label className="form-label small fw-bold">ชื่อที่แสดง (ถ้ามี)</label>
              <input className="form-control" value={displayName}
                onChange={(e) => setDisplayName(e.target.value)} placeholder="เช่น ผู้ดูแลระบบ" />
            </div>
          )}

          <div className="mb-3">
            <label className="form-label small fw-bold">รหัสผ่าน</label>
            <input type="password" className="form-control" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>

          {isFirstRun && (
            <div className="mb-3">
              <label className="form-label small fw-bold">ยืนยันรหัสผ่าน</label>
              <input type="password" className="form-control" value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" />
            </div>
          )}

          {error && <div className="room-modal-error mb-3"><i className="fas fa-exclamation-circle me-2" />{error}</div>}

          <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
            {submitting
              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังดำเนินการ...</>
              : isFirstRun
                ? <><i className="fas fa-user-plus me-2" />สร้างบัญชีและเข้าสู่ระบบ</>
                : <><i className="fas fa-sign-in-alt me-2" />เข้าสู่ระบบ</>}
          </button>
        </form>
      </div>
    </div>
  );
}
