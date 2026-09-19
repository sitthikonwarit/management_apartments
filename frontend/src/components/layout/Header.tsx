import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useBreadcrumb } from "../../context/BreadcrumbContext";
import { useTheme } from "../../context/ThemeContext";
import { usePrivacyMode } from "../../context/PrivacyModeContext";
import { useAuth } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import { timeAgo } from "../../utils/timeAgo";

interface HeaderProps {
  titles: Record<string, string>;
  onMenuClick: () => void;
}

const NOTIF_ICONS: Record<string, string> = {
  tenant: "person_outline", "tenant-tag": "sell",
  room: "meeting_room", tower: "apartment", "room-tag": "sell",
  meter: "speed",
  bill: "receipt", payment: "payments",
  vehicle: "directions_car", "vehicle-type": "directions_car",
  settings: "settings", formula: "calculate",
  user: "manage_accounts",
};

export default function Header({ titles, onMenuClick }: HeaderProps) {
  const { pathname } = useLocation();
  const { items } = useBreadcrumb();
  const { theme, toggle } = useTheme();
  const { enabled: privacyEnabled, toggle: togglePrivacy } = usePrivacyMode();
  const { user, logout } = useAuth();
  const { notifications, unreadCount, markAllRead } = useNotifications();
  const navigate = useNavigate();
  const [showMenu, setShowMenu] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const title = items.length > 0
    ? items[items.length - 1].label
    : (titles[pathname] ?? "Dashboard");

  // ปิดเมนูเมื่อคลิกที่อื่นนอกกรอบรูปโปรไฟล์/เมนู
  useEffect(() => {
    if (!showMenu) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  // ปิดกล่องแจ้งเตือนเมื่อคลิกที่อื่นนอกกรอบกระดิ่ง
  useEffect(() => {
    if (!showNotif) return;
    function handleClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotif(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showNotif]);

  function handleLogout() {
    setShowMenu(false);
    logout();
    navigate("/login", { replace: true });
  }

  function toggleNotif() {
    setShowNotif((v) => {
      if (!v) markAllRead();
      return !v;
    });
  }

  return (
    <div className="main-header">
      <h1 id="main-title">{title}</h1>
      <div className="nav">
        <button id="menu-btn" onClick={onMenuClick} title="เมนู">
          <span className="material-icons-sharp">menu</span>
        </button>
        <div className="profile">
          <div className="notif-wrap" ref={notifRef}>
            <button className="notif-btn" onClick={toggleNotif} title="การแจ้งเตือน">
              <span className="material-icons-sharp">notifications</span>
              {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
            </button>
            {showNotif && (
              <div className="notif-dropdown">
                <div className="notif-dropdown-header"><b>การแจ้งเตือน</b></div>
                {notifications.length === 0 ? (
                  <div className="notif-empty">ไม่มีการแจ้งเตือน</div>
                ) : (
                  <div className="notif-list">
                    {notifications.map((n) => (
                      <div key={n.id} className="notif-item">
                        <span className="material-icons-sharp notif-item-icon">{NOTIF_ICONS[n.entityType] ?? "notifications"}</span>
                        <div className="notif-item-body">
                          <div className="notif-item-label">{n.label}</div>
                          <small className="text-muted">{n.username ? `โดย ${n.username} · ` : ""}{timeAgo(n.timestamp)}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {/* ปุ่มลัดโหมดความเป็นส่วนตัว — ปิดบังข้อมูลอ่อนไหวของผู้เช่า (เลขบัตร ปชช./ที่อยู่/เบอร์โทร/รูป)
              ทั่วเว็บทันที ไว้กดก่อนแคป/แชร์หน้าจอ (ดูคอมเมนต์ข้อจำกัดที่ context/PrivacyModeContext.tsx —
              เว็บตรวจจับการแคป/แชร์จอเองไม่ได้ ต้องกดเปิด/ปิดเอง) ตั้งค่าเดียวกับสวิตช์ในหน้า Settings */}
          <button className="theme-toggle-btn"
            onClick={togglePrivacy}
            style={privacyEnabled ? { color: "var(--color-danger)" } : undefined}
            title={privacyEnabled ? "ปิดโหมดความเป็นส่วนตัว (แสดงข้อมูลผู้เช่าตามปกติ)" : "เปิดโหมดความเป็นส่วนตัว (ซ่อนข้อมูลผู้เช่าก่อนแคป/แชร์จอ)"}>
            <span className="material-icons-sharp">{privacyEnabled ? "visibility_off" : "visibility"}</span>
          </button>
          <button className="theme-toggle-btn"
            onClick={(e) => toggle({ x: e.clientX, y: e.clientY })}
            title={theme === "dark" ? "เปลี่ยนเป็น Light Mode" : "เปลี่ยนเป็น Dark Mode"}>
            <span className="material-icons-sharp">
              {theme === "dark" ? "light_mode" : "dark_mode"}
            </span>
          </button>
          <div className="profile-menu-wrap" ref={menuRef}>
            <div className="profile-photo" onClick={() => setShowMenu((v) => !v)} style={{ cursor: "pointer" }}>
              <img src="https://placehold.co/100x100/FF0060/FFFFFF?text=A" alt="Profile" />
            </div>
            {showMenu && (
              <div className="profile-dropdown">
                <div className="profile-dropdown-name">
                  <b>{user?.displayName || user?.username || "ผู้ใช้"}</b>
                  {user?.displayName && <small className="text-muted">{user.username}</small>}
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
