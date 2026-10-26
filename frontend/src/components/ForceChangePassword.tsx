import { useState } from "react";
import { authApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { toastSuccess } from "../utils/toast";

// หน้าบังคับตั้งรหัสผ่านใหม่ — แสดงเมื่อบัญชีถูกรีเซ็ตรหัสผ่านเป็นรหัสชั่วคราวโดยผู้ดูแลแพลตฟอร์ม (users.mustChangePassword)
// ต้องกรอกรหัสผ่านใหม่ 2 ครั้งให้ตรงกันก่อนถึงจะใช้งานส่วนอื่นของระบบได้ (backend ก็บล็อก API อื่นไว้จนกว่าจะเปลี่ยนเสร็จ)
export default function ForceChangePassword() {
  const { user, logout, refreshUser } = useAuth();
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pw1.length < 6) { setError("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"); return; }
    if (pw1 !== pw2) { setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน"); return; }
    setSaving(true);
    try {
      await authApi.changePassword(pw1, pw2);
      toastSuccess("ตั้งรหัสผ่านใหม่เรียบร้อย");
      await refreshUser();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? "บันทึกไม่สำเร็จ");
    } finally { setSaving(false); }
  }

  return (
    <div className="login-page-wrap">
      <form className="login-card" onSubmit={submit} style={{ maxWidth: 420, width: "100%" }}>
        <h4 className="mb-1"><i className="fas fa-key me-2 text-primary" />ตั้งรหัสผ่านใหม่</h4>
        <p className="text-muted small mb-3">
          บัญชี <strong>{user?.username}</strong> ใช้รหัสผ่านชั่วคราวอยู่ กรุณาตั้งรหัสผ่านใหม่ของคุณเอง (กรอก 2 ครั้งเพื่อยืนยัน) ก่อนเริ่มใช้งาน
        </p>
        <label className="form-label small fw-bold">รหัสผ่านใหม่</label>
        <input type="password" autoComplete="new-password" className="form-control mb-2" autoFocus value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="อย่างน้อย 6 ตัวอักษร" />
        <label className="form-label small fw-bold">ยืนยันรหัสผ่านใหม่อีกครั้ง</label>
        <input type="password" autoComplete="new-password" className="form-control mb-2" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="พิมพ์รหัสผ่านใหม่ซ้ำ" />
        {error && <div className="alert alert-danger py-2 small mb-2">{error}</div>}
        <button type="submit" className="btn btn-primary w-100 mb-2" disabled={saving}>
          {saving ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</> : "บันทึกรหัสผ่านใหม่"}
        </button>
        <button type="button" className="btn btn-link w-100 text-muted" onClick={logout}>ออกจากระบบ</button>
      </form>
    </div>
  );
}
