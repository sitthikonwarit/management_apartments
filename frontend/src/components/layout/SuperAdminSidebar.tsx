// เมนูด้านข้างของหน้าควบคุมแพลตฟอร์ม — ใช้ CSS class เดียวกับ Sidebar.tsx (aside/.toggle/.logo/.sidebar
// ฯลฯ ใน App.css) ทุกตัวเพื่อให้หน้าตาเหมือนเมนูหลักเป๊ะๆ แต่ไม่พึ่ง useAppConfig()/chatApi เหมือนตัวจริง
// เพราะหน้านี้ไม่มีแนวคิด "องค์กร" ของตัวเองเลย (คนละระบบสิทธิ์กันโดยสิ้นเชิง ดู SuperAdminShell.tsx)
import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";

const CLOSE_ANIM_MS = 400;

const navItems = [
  { to: "/superadmin", icon: "apartment", label: "องค์กรทั้งหมด" },
  { to: "/superadmin/richmenu", icon: "grid_view", label: "สร้าง Rich Menu" },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

type Phase = "closed" | "open" | "closing";

export default function SuperAdminSidebar({ open, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>(open ? "open" : "closed");
  const prevOpenRef = useRef(open);

  if (open !== prevOpenRef.current) {
    prevOpenRef.current = open;
    setPhase(open ? "open" : "closing");
  }

  useEffect(() => {
    if (phase !== "closing") return;
    const timer = setTimeout(() => setPhase("closed"), CLOSE_ANIM_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const closing = phase === "closing";

  return (
    <>
      <aside className={phase === "open" ? "mobile-open" : closing ? "mobile-closing" : ""}>
        <div className="toggle">
          <div className="logo">
            <span className="material-icons-sharp" style={{ fontSize: "2rem", color: "var(--color-primary)" }}>admin_panel_settings</span>
            <h2 style={{ fontSize: "1.1rem" }}>Platform Admin</h2>
          </div>
          <div className="close" id="close-btn" onClick={onClose}>
            <span className="material-icons-sharp">close</span>
          </div>
        </div>

        <div className="sidebar">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/superadmin"}
              className={({ isActive }) => isActive ? "active" : ""}
              onClick={(e) => { e.preventDefault(); onClose(); navigate(item.to); }}
            >
              <span className="sidebar-icon-wrap">
                <span className="material-icons-sharp">{item.icon}</span>
              </span>
              <h3>{item.label}</h3>
            </NavLink>
          ))}
        </div>
      </aside>
      {phase !== "closed" && (
        <div className={`mobile-menu-backdrop${closing ? " closing" : ""}`} onClick={onClose} />
      )}
    </>
  );
}
