import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";
import { BreadcrumbProvider } from "./context/BreadcrumbContext";
import { ThemeProvider } from "./context/ThemeContext";
import { AppConfigProvider, useAppConfig } from "./context/AppConfigContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { NotificationProvider } from "./context/NotificationContext";
import { useIdleLogout } from "./utils/useIdleLogout";
import { useLiveSyncConnection } from "./utils/useLiveSync";
import Sidebar from "./components/layout/Sidebar";
import Header from "./components/layout/Header";
import BreadcrumbBar from "./components/layout/BreadcrumbBar";
import LockScreen from "./components/LockScreen";
import ChatToastHost from "./components/ChatToastHost";
import LoginPage from "./pages/LoginPage";
import LiffLoginPage from "./pages/LiffLoginPage";
import LiffPaymentPage from "./pages/LiffPaymentPage";
import TenantsPage from "./pages/TenantsPage";
import RoomsPage from "./pages/RoomsPage";
import MetersPage from "./pages/MetersPage";
import BillsPage from "./pages/BillsPage";
import VehiclesPage from "./pages/VehiclesPage";
import SettingsPage from "./pages/SettingsPage";
import LogPage from "./pages/LogPage";
import ChatPage from "./pages/ChatPage";

const PAGE_TITLES: Record<string, string> = {
  "/tenants": "ผู้เช่า",
  "/rooms": "จัดการห้องพัก",
  "/meters": "จดมิเตอร์",
  "/bills": "ใบแจ้งหนี้",
  "/vehicles": "ยานพาหนะ",
  "/chat": "แชท LINE",
  "/settings": "Settings",
  "/logs": "Log กิจกรรม",
};

// ── โครงแอปหลัก (Sidebar/Header/หน้าต่างๆ) — ต้องล็อกอินก่อนถึงจะเห็น ไม่งั้นเด้งไป /login ─────
function AuthenticatedShell() {
  const { user, loading, locked, lock } = useAuth();
  const { config } = useAppConfig();
  // เมนูด้านข้างบนมือถือ (ซ่อนไว้เป็นค่าเริ่มต้นตาม CSS @media ที่ ≤768px) — ปุ่มแฮมเบอร์เกอร์ใน Header
  // เปิด, กากบาท/แตะพื้นหลังใน Sidebar ปิด ไม่กระทบจอเดสก์ท็อปเพราะ CSS นั้นใช้เฉพาะช่วงจอแคบเท่านั้น
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // ไม่มีการกระทำใดๆ เกินเวลาที่ตั้งไว้ (Settings > ฟีเจอร์เสริม) ให้ล็อกหน้าจอ แทนออกจากระบบเต็มรูปแบบ
  // พอปลดล็อกสำเร็จจะกลับมาที่ route เดิมอัตโนมัติ (ไม่ได้ navigate ออกไปไหนตั้งแต่แรก)
  useIdleLogout(config.sessionTimeoutMinutes, lock);

  // เชื่อมต่อแบบเรียลไทม์เฉพาะตอนล็อกอินอยู่จริงและไม่ได้ล็อกหน้าจอ — คนอื่นแก้ไขข้อมูลที่ไหนก็ตาม
  // หน้านี้จะรู้ทันที (แต่ละหน้าเอง sync กับ useLiveRefreshTick แยกไปตาม entityType ที่สนใจ)
  useLiveSyncConnection(!!user && !locked);

  if (loading) {
    return (
      <div className="login-page-wrap">
        <div className="spinner-border" style={{ color: "var(--color-primary)" }} />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // ล็อกอยู่ = ไม่ render dashboard/Routes เลย (unmount ทั้งหมด ไม่ใช่แค่ซ่อน/เบลอทับไว้) เพราะถ้ายังฝัง
  // อยู่ใน DOM คนที่มี DevTools จะลบ overlay ออกแล้วเห็นข้อมูลจริงได้ทันที — ต้องไม่มีข้อมูลอะไรให้เปิดดูเลย
  // จนกว่าจะกรอกรหัสผ่านถูก (unlock() ใน AuthContext เอง ก็ล้าง token จริงตอน lock() ไปแล้วด้วย)
  if (locked) return <LockScreen />;

  return (
    <div className="dashboard-container">
      <Sidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
      <main>
        <Header titles={PAGE_TITLES} onMenuClick={() => setMobileMenuOpen((v) => !v)} />
        <BreadcrumbBar />
        <div id="content-wrapper">
          <Routes>
            <Route path="/" element={<Navigate to="/tenants" replace />} />
            <Route path="/tenants" element={<TenantsPage />} />
            <Route path="/rooms" element={<RoomsPage />} />
            <Route path="/meters" element={<MetersPage />} />
            <Route path="/bills" element={<BillsPage />} />
            <Route path="/vehicles" element={<VehiclesPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/logs" element={<LogPage />} />
          </Routes>
        </div>
      </main>
      <ChatToastHost />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
      <AuthProvider>
      <NotificationProvider>
      <AppConfigProvider>
      <BreadcrumbProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* หน้า LIFF ฝั่งผู้เช่า — สาธารณะ ไม่ผ่าน AuthenticatedShell (ไม่มี Sidebar/Header, ไม่ต้อง
              ล็อกอินด้วยบัญชีพนักงาน) เปิดจากปุ่มบน LINE Rich Menu ผ่านเบราว์เซอร์ในตัวของ LINE เอง */}
          <Route path="/liff/login" element={<LiffLoginPage />} />
          <Route path="/liff/payment" element={<LiffPaymentPage />} />
          <Route path="/*" element={<AuthenticatedShell />} />
        </Routes>
      </BreadcrumbProvider>
      </AppConfigProvider>
      </NotificationProvider>
      </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
