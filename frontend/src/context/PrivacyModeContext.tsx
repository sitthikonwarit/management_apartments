import { createContext, useContext, useEffect, useState } from "react";

// ── โหมดความเป็นส่วนตัว ─────────────────────────────────────────────────────────
// ปิดบังข้อมูลอ่อนไหวของผู้เช่า (เลขบัตร ปชช./ที่อยู่/เบอร์โทร/รูปโปรไฟล์) ทั่วทั้งเว็บด้วยการกดสวิตช์เอง
// (ที่ Header ปุ่มลัด หรือหน้า Settings) ก่อนจะแคปหน้าจอ/แชร์หน้าจอ/อัดวิดีโอ — ต้องเข้าใจข้อจำกัดสำคัญ:
// เว็บเบราว์เซอร์ไม่มีทางรู้ได้เลยว่ากำลังถูก screenshot หรือถูกโปรแกรมอื่น (Zoom/Teams/OBS) จับภาพหน้าจออยู่
// จึง "ซ่อนอัตโนมัติตอนแคป/แชร์จอ" จริงๆ เป็นไปไม่ได้บนเว็บ — ฟีเจอร์นี้จึงเป็นสวิตช์ที่ผู้ใช้ต้องกดเปิดเอง
// ก่อนแคป/แชร์ แล้วกดปิดเองทีหลัง ไม่ใช่การตรวจจับอัตโนมัติ
//
// ค่าที่เก็บเป็น "ความชอบส่วนตัวของเครื่อง/เบราว์เซอร์นี้" (localStorage) ไม่ใช่ค่าองค์กรที่ซิงก์ข้ามเครื่อง —
// ตรงตามจุดประสงค์ (ป้องกันตอนแชร์จอเครื่องนี้เครื่องเดียว) และไม่ต้องพึ่งการเชื่อมต่อเซิร์ฟเวอร์
const STORAGE_KEY = "privacyModeEnabled";

const PrivacyModeContext = createContext<{ enabled: boolean; setEnabled: (v: boolean) => void; toggle: () => void }>({
  enabled: false,
  setEnabled: () => {},
  toggle: () => {},
});

export function PrivacyModeProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean>(() => localStorage.getItem(STORAGE_KEY) === "true");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  }, [enabled]);

  // ซิงก์ระหว่างแท็บ/หน้าต่างของเบราว์เซอร์เดียวกัน (event "storage" ยิงเฉพาะแท็บอื่นที่ไม่ใช่ตัวเอง) — เผื่อเปิด
  // เว็บนี้ไว้หลายแท็บพร้อมกันตอนแชร์จอ กดปิดจากแท็บหนึ่งแล้วอยากให้ทุกแท็บปิดตามทันที ไม่ต้องไล่ปิดทีละแท็บ
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setEnabledState(e.newValue === "true");
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function setEnabled(v: boolean) { setEnabledState(v); }
  function toggle() { setEnabledState((v) => !v); }

  return (
    <PrivacyModeContext.Provider value={{ enabled, setEnabled, toggle }}>
      {children}
    </PrivacyModeContext.Provider>
  );
}

export function usePrivacyMode() {
  return useContext(PrivacyModeContext);
}
