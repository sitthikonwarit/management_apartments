// ปลายทางหลัง backend ยืนยันตัวตนกับ LINE Login สำเร็จแล้วสำหรับหน้าควบคุมแพลตฟอร์ม (routes/superadmin.ts
// redirect มาที่นี่พร้อม ?token=) — เก็บโทเค็นแยกจากบัญชีพนักงาน (ดู setSuperAdminToken ใน api/client.ts)
// แล้วเด้งเข้าหน้าควบคุมทันที มิเรอร์ LineLoginCallbackPage.tsx
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { setSuperAdminToken } from "../api/client";

export default function SuperAdminCallbackPage() {
  const navigate = useNavigate();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return; // กัน effect ยิงซ้ำสองรอบใน React StrictMode (dev)
    ranRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    window.history.replaceState({}, "", window.location.pathname);

    if (!token) {
      navigate("/superadmin/login?error=" + encodeURIComponent("ไม่พบโทเค็นเข้าสู่ระบบ"), { replace: true });
      return;
    }

    setSuperAdminToken(token);
    navigate("/superadmin", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="login-page-wrap">
      <div className="spinner-border" style={{ color: "var(--color-primary)" }} />
    </div>
  );
}
