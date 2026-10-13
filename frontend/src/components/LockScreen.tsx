import { useState } from "react";
import { useAuth } from "../context/AuthContext";

// หน้าจอล็อกตอนไม่มีการใช้งานเกินเวลาที่ตั้งไว้ — ตอนนี้แอปทั้งหมด (Sidebar/Header/หน้าต่างๆ) ถูก
// unmount ไปแล้วจาก App.tsx ตอน locked=true (ไม่ใช่แค่ซ่อน/เบลอทับ) จึงใช้ทรงเดียวกับหน้า login เต็มจอ
// ต่างกันแค่ให้กรอกแค่รหัสผ่าน (รู้ชื่อผู้ใช้อยู่แล้ว) ปลดล็อกสำเร็จแล้วกลับไป route เดิมทันที
export default function LockScreen() {
  const { user, unlock, logout } = useAuth();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setError("");
    try {
      await unlock(password);
      setPassword("");
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? "รหัสผ่านไม่ถูกต้อง");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page-wrap">
      <div className="login-card custom-card">
        <div className="text-center mb-4">
          <div className="login-icon"><i className="fas fa-lock" /></div>
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>เซสชันหมดเวลา</h5>
          <p className="text-muted small mb-0">
            ไม่มีการใช้งานเป็นเวลานาน กรุณากรอกรหัสผ่านของ <b>{user?.displayName || user?.username}</b> เพื่อดำเนินการต่อ
          </p>
        </div>
        <form onSubmit={handleSubmit}>
          <input type="password" autoComplete="current-password" className="form-control mb-3" autoFocus placeholder="••••••••"
            value={password} onChange={(e) => setPassword(e.target.value)} />

          {error && <div className="room-modal-error mb-3"><i className="fas fa-exclamation-circle me-2" />{error}</div>}

          <button type="submit" className="btn btn-primary w-100 mb-2" disabled={submitting || !password}>
            {submitting
              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังตรวจสอบ...</>
              : <><i className="fas fa-unlock me-2" />ปลดล็อก</>}
          </button>
          <button type="button" className="btn btn-link w-100 text-muted small" onClick={logout}>
            ออกจากระบบ / เปลี่ยนผู้ใช้
          </button>
        </form>
      </div>
    </div>
  );
}
