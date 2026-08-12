import { useTheme } from "../context/ThemeContext";

// ปุ่มสลับธีมลอยมุมขวาบน สำหรับหน้า LIFF ทุกหน้า (ไม่มี Header ของตัวเองเหมือนหน้าแดชบอร์ดพนักงาน — ดู
// theme-toggle-btn ใน components/layout/Header.tsx ที่ใช้ useTheme ตัวเดียวกันนี้)
export default function LiffThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      className="liff-theme-toggle"
      onClick={(e) => toggle({ x: e.clientX, y: e.clientY })}
      title={theme === "dark" ? "เปลี่ยนเป็น Light Mode" : "เปลี่ยนเป็น Dark Mode"}
    >
      <span className="material-icons-sharp">{theme === "dark" ? "light_mode" : "dark_mode"}</span>
    </button>
  );
}
