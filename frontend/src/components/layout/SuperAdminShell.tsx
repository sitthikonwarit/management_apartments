// โครงหน้าควบคุมแพลตฟอร์ม (Sidebar/Header) — มิเรอร์ AuthenticatedShell ใน App.tsx แต่เช็คสิทธิ์จาก
// getSuperAdminToken() แทน useAuth() (คนละระบบสิทธิ์กันโดยสิ้นเชิง ดูคอมเมนต์หัวไฟล์ SuperAdminSidebar.tsx)
// ไม่มี token เลยก็ redirect ไปหน้า login ทันทีโดยไม่ต้อง mount โครง sidebar/header ให้เห็นแวบก่อน (ส่วน
// token ที่มีอยู่แต่หมดอายุ/ไม่ถูกต้องแล้ว ตรวจจากการเรียก API จริงในตัวหน้าเอง — ดู SuperAdminDashboardPage.tsx)
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { getSuperAdminToken } from "../../api/client";
import SuperAdminSidebar from "./SuperAdminSidebar";
import SuperAdminHeader from "./SuperAdminHeader";

export default function SuperAdminShell({ title, children }: { title: string; children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (!getSuperAdminToken()) return <Navigate to="/superadmin/login" replace />;

  return (
    <div className="dashboard-container">
      <SuperAdminSidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
      <main>
        <SuperAdminHeader title={title} onMenuClick={() => setMobileMenuOpen((v) => !v)} />
        <div id="content-wrapper">{children}</div>
      </main>
    </div>
  );
}
