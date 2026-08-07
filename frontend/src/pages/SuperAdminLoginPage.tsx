// หน้าล็อกอินหน้าควบคุมแพลตฟอร์ม — คนเดียว (คุณ) เท่านั้นที่เข้าได้ ไม่มีลิงก์จากที่ไหนในแอปเลย ต้องพิมพ์
// URL เอง ล็อกอินได้ 2 ทาง: LINE Login (backend เช็คว่า LINE User ID ตรงกับ SUPERADMIN_LINE_USER_ID) หรือ
// รหัสผ่านเดียว (ตรงกับ SUPERADMIN_PASSWORD) — ดู backend/src/routes/superadmin.ts ทั้งสองทางปิดได้อิสระ
// จากกันแค่เว้นค่า env var นั้นๆ ว่างไว้
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { superAdminApi, setSuperAdminToken } from "../api/client";

export default function SuperAdminLoginPage() {
  const navigate = useNavigate();
  const params = new URLSearchParams(window.location.search);
  const [error, setError] = useState(params.get("error") ?? "");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (params.get("error")) window.history.replaceState({}, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!password) { setError("กรุณากรอกรหัสผ่าน"); return; }
    setSubmitting(true);
    try {
      const { token } = await superAdminApi.login(password);
      setSuperAdminToken(token);
      navigate("/superadmin", { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page-wrap">
      <div className="login-card custom-card">
        <div className="text-center mb-4">
          <div className="login-icon"><i className="fas fa-user-shield" /></div>
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>หน้าควบคุมแพลตฟอร์ม</h5>
          <p className="text-muted small mb-0">เข้าถึงได้เฉพาะที่ได้รับอนุญาตเท่านั้น</p>
        </div>

        {error && <div className="room-modal-error mb-3"><i className="fas fa-exclamation-circle me-2" />{error}</div>}

        <a href="/api/auth/superadmin/authorize" className="btn btn-success w-100 mb-3">
          <i className="fab fa-line me-2" />เข้าสู่ระบบด้วย LINE
        </a>

        <div className="d-flex align-items-center gap-2 mb-3">
          <hr className="flex-grow-1 m-0" />
          <small className="text-muted">หรือ</small>
          <hr className="flex-grow-1 m-0" />
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="form-label small fw-bold">รหัสผ่าน</label>
            <input type="password" className="form-control" autoFocus value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" disabled={submitting} />
          </div>
          <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
            {submitting
              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังเข้าสู่ระบบ...</>
              : <><i className="fas fa-sign-in-alt me-2" />เข้าสู่ระบบ</>}
          </button>
        </form>
      </div>
    </div>
  );
}
