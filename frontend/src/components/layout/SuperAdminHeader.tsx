// แถบหัวเรื่องของหน้าควบคุมแพลตฟอร์ม — ใช้ CSS class เดียวกับ Header.tsx (.main-header/.nav/.profile/
// .profile-menu-wrap/.profile-dropdown ฯลฯ ใน App.css) ให้หน้าตาเหมือนกันเป๊ะ ตัดส่วนที่ผูกกับระบบสิทธิ์
// พนักงาน/องค์กรออก (ไม่มี breadcrumb, ไม่มีกระดิ่งแจ้งเตือน — ทั้งสองอย่างผูกกับ WebSocket ต่อองค์กรที่
// หน้านี้ไม่มีแนวคิดนี้เลย) เหลือแค่ปุ่มสลับธีม (ใช้ ThemeContext ตัวเดียวกับทั้งแอปได้ตรงๆ ไม่ผูกกับ auth)
// กับเมนูโปรไฟล์ที่มีแค่ปุ่ม Logout
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../../context/ThemeContext";
import { clearSuperAdminToken } from "../../api/client";

interface HeaderProps {
  title: string;
  onMenuClick: () => void;
}

export default function SuperAdminHeader({ title, onMenuClick }: HeaderProps) {
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  function handleLogout() {
    setShowMenu(false);
    clearSuperAdminToken();
    navigate("/superadmin/login", { replace: true });
  }

  return (
    <div className="main-header">
      <h1 id="main-title">{title}</h1>
      <div className="nav">
        <button id="menu-btn" onClick={onMenuClick} title="เมนู">
          <span className="material-icons-sharp">menu</span>
        </button>
        <div className="profile">
          <button className="theme-toggle-btn"
            onClick={(e) => toggle({ x: e.clientX, y: e.clientY })}
            title={theme === "dark" ? "เปลี่ยนเป็น Light Mode" : "เปลี่ยนเป็น Dark Mode"}>
            <span className="material-icons-sharp">
              {theme === "dark" ? "light_mode" : "dark_mode"}
            </span>
          </button>
          <div className="profile-menu-wrap" ref={menuRef}>
            <div className="profile-photo" onClick={() => setShowMenu((v) => !v)} style={{ cursor: "pointer" }}>
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-primary)" }}>
                <span className="material-icons-sharp" style={{ color: "#fff", fontSize: "1.3rem" }}>admin_panel_settings</span>
              </div>
            </div>
            {showMenu && (
              <div className="profile-dropdown">
                <div className="profile-dropdown-name">
                  <b>Platform Admin</b>
                </div>
                <button type="button" className="profile-dropdown-item" onClick={handleLogout}>
                  <span className="material-icons-sharp">logout</span>
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
