import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";
import { BreadcrumbProvider } from "./context/BreadcrumbContext";
import { ThemeProvider } from "./context/ThemeContext";
import { PrivacyModeProvider } from "./context/PrivacyModeContext";
import { AppConfigProvider, useAppConfig } from "./context/AppConfigContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { NotificationProvider } from "./context/NotificationContext";
import { useIdleLogout } from "./utils/useIdleLogout";
import { useLiveSyncConnection } from "./utils/useLiveSync";
import { useVersionCheck } from "./utils/useVersionCheck";
import Sidebar from "./components/layout/Sidebar";
import Header from "./components/layout/Header";
import BreadcrumbBar from "./components/layout/BreadcrumbBar";
import LockScreen from "./components/LockScreen";
import ChatToastHost from "./components/ChatToastHost";
import UpdateBanner from "./components/UpdateBanner";
import LoginPage from "./pages/LoginPage";
import LineLoginCallbackPage from "./pages/LineLoginCallbackPage";
import SuperAdminLoginPage from "./pages/SuperAdminLoginPage";
import SuperAdminCallbackPage from "./pages/SuperAdminCallbackPage";
import SuperAdminDashboardPage from "./pages/SuperAdminDashboardPage";
import SuperAdminRichMenuPage from "./pages/SuperAdminRichMenuPage";
import SuperAdminShell from "./components/layout/SuperAdminShell";
import LiffLoginPage from "./pages/LiffLoginPage";
import LiffPaymentPage from "./pages/LiffPaymentPage";
import LiffProfilePage from "./pages/LiffProfilePage";
import LiffRepairPage from "./pages/LiffRepairPage";
import LiffBookingPage from "./pages/LiffBookingPage";
import LiffRoomsPage from "./pages/LiffRoomsPage";
import ContactPage from "./pages/ContactPage";
import TenantsPage from "./pages/TenantsPage";
import RoomsPage from "./pages/RoomsPage";
import MetersPage from "./pages/MetersPage";
import BillsPage from "./pages/BillsPage";
import VehiclesPage from "./pages/VehiclesPage";
import RepairsPage from "./pages/RepairsPage";
import SettingsPage from "./pages/SettingsPage";
import OnboardingWizard from "./pages/OnboardingWizard";
import LogPage from "./pages/LogPage";
import ChatPage from "./pages/ChatPage";

const PAGE_TITLES: Record<string, string> = {
  "/tenants": "ผู้เช่า",
  "/rooms": "จัดการห้องพัก",
  "/meters": "จดมิเตอร์",
  "/bills": "ใบแจ้งหนี้",
  "/vehicles": "ยานพาหนะ",
  "/repairs": "ซ่อมแซม",
  "/chat": "แชท LINE",
  "/settings": "Settings",
  "/logs": "Log กิจกรรม",
};

// ── โครงแอปหลัก (Sidebar/Header/หน้าต่างๆ) — ต้องล็อกอินก่อนถึงจะเห็น ไม่งั้นเด้งไป /login ─────
function AuthenticatedShell() {
  const { user, loading, locked, lock } = useAuth();
  const { config, loading: configLoading } = useAppConfig();
  // องค์กรใหม่ที่ยังไม่เคยกดปุ่ม "เสร็จสิ้นการตั้งค่าเริ่มต้น" ในหน้า Settings (setupCompleted=false ใน
  // app_config — ดู backend routes/settings.ts) ต้องรอโหลด config จริงจบก่อน (configLoading) ไม่งั้นจะติด
  // ค่า default ชั่วคราวแล้วเด้งพาไป Settings ผิดๆ ตอนเพิ่งล็อกอินเสร็จใหม่ๆ
  const setupLocked = !configLoading && !config.setupCompleted;
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
            {setupLocked ? (
              // ยังไม่เสร็จสิ้นการตั้งค่าเริ่มต้น — บังคับทุก route ไปหน้า wizard ตั้งค่าเริ่มต้นค้างไว้เสมอ
              // (แม้พิมพ์ URL อื่นเองตรงๆ ก็เด้งกลับมาเสมอ) เรียงลำดับบังคับทำทีละขั้น: รูปลักษณ์ → ค่าน้ำไฟ →
              // สร้างตึก → สร้างห้อง จนกว่าจะกดปุ่ม "เริ่มใช้งานระบบ" ในขั้นสุดท้าย (ดู OnboardingWizard.tsx)
              <Route path="*" element={<OnboardingWizard />} />
            ) : (
              <>
                <Route path="/" element={<Navigate to="/tenants" replace />} />
                <Route path="/tenants" element={<TenantsPage />} />
                <Route path="/rooms" element={<RoomsPage />} />
                <Route path="/meters" element={<MetersPage />} />
                <Route path="/bills" element={<BillsPage />} />
                <Route path="/vehicles" element={<VehiclesPage />} />
                <Route path="/repairs" element={<RepairsPage />} />
                <Route path="/chat" element={<ChatPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/logs" element={<LogPage />} />
              </>
            )}
          </Routes>
        </div>
      </main>
      <ChatToastHost />
    </div>
  );
}

// ตรวจ+แจ้งเตือนอัปเดตเว็บไซต์ใหม่ระดับบนสุดของแอป — ทำงานทุกหน้ารวมทั้งหน้า LIFF สาธารณะ (ไม่ต้องล็อกอิน
// ก็เห็นได้) ดู useVersionCheck.ts/UpdateBanner.tsx
function VersionCheckBanner() {
  const updateAvailable = useVersionCheck();
  return <UpdateBanner show={updateAvailable} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
      <PrivacyModeProvider>
      <AuthProvider>
      <NotificationProvider>
      <AppConfigProvider>
      <BreadcrumbProvider>
        <VersionCheckBanner />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* ปลายทางหลัง redirect กลับจาก LINE Login สำเร็จ (ดู backend/src/routes/lineLogin.ts) */}
          <Route path="/line-login-callback" element={<LineLoginCallbackPage />} />
          {/* หน้าควบคุมแพลตฟอร์ม (ดูรายชื่อองค์กรลูกค้าทั้งหมด/ระงับ/ลบองค์กร) — คนเดียว (คุณ) เท่านั้น
              ไม่มีลิงก์จากที่ไหนในแอปเลย เข้าถึงได้แค่พิมพ์ URL ตรงๆ เท่านั้น คนละระบบสิทธิ์กับ
              AuthenticatedShell ด้านล่างโดยสิ้นเชิง (ดู SuperAdminDashboardPage.tsx) */}
          <Route path="/superadmin/login" element={<SuperAdminLoginPage />} />
          <Route path="/superadmin/callback" element={<SuperAdminCallbackPage />} />
          <Route path="/superadmin" element={<SuperAdminShell title="องค์กรทั้งหมด"><SuperAdminDashboardPage /></SuperAdminShell>} />
          <Route path="/superadmin/richmenu" element={<SuperAdminShell title="สร้าง Rich Menu"><SuperAdminRichMenuPage /></SuperAdminShell>} />
          {/* หน้า LIFF ฝั่งผู้เช่า — สาธารณะ ไม่ผ่าน AuthenticatedShell (ไม่มี Sidebar/Header, ไม่ต้อง
              ล็อกอินด้วยบัญชีพนักงาน) เปิดจากปุ่มบน LINE Rich Menu ผ่านเบราว์เซอร์ในตัวของ LINE เอง */}
          <Route path="/liff/login" element={<LiffLoginPage />} />
          <Route path="/liff/payment" element={<LiffPaymentPage />} />
          <Route path="/liff/profile" element={<LiffProfilePage />} />
          <Route path="/liff/repair" element={<LiffRepairPage />} />
          <Route path="/liff/booking" element={<LiffBookingPage />} />
          <Route path="/liff/rooms" element={<LiffRoomsPage />} />
          {/* /contact ไม่ต้องรู้ตัวตนผู้เช่า เลยไม่ผ่าน LIFF SDK เหมือนหน้าอื่นด้านบน (ดู ContactPage.tsx) */}
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/*" element={<AuthenticatedShell />} />
        </Routes>
      </BreadcrumbProvider>
      </AppConfigProvider>
      </NotificationProvider>
      </AuthProvider>
      </PrivacyModeProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
