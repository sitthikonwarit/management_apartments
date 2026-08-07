import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// ปลายทางหลัง backend ยืนยันตัวตนกับ LINE Login สำเร็จแล้ว (routes/lineLogin.ts redirect มาที่นี่พร้อม
// ?token=) — อ่านโทเค็นครั้งเดียว เก็บเข้าระบบ แล้วเด้งเข้าแอปทันที ไม่ปล่อยให้โทเค็นค้างอยู่ใน URL/ประวัติ
export default function LineLoginCallbackPage() {
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return; // กัน effect ยิงซ้ำสองรอบใน React StrictMode (dev)
    ranRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    window.history.replaceState({}, "", window.location.pathname);

    if (!token) {
      navigate("/login?lineLoginError=" + encodeURIComponent("ไม่พบโทเค็นเข้าสู่ระบบ"), { replace: true });
      return;
    }

    loginWithToken(token)
      .then(() => navigate("/", { replace: true }))
      .catch(() => navigate("/login?lineLoginError=" + encodeURIComponent("เข้าสู่ระบบด้วย LINE ไม่สำเร็จ"), { replace: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="login-page-wrap">
      <div className="spinner-border" style={{ color: "var(--color-primary)" }} />
    </div>
  );
}
