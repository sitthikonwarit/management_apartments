import { useEffect, useRef, useState } from "react";

// ตรวจว่ามีเว็บเวอร์ชันใหม่กว่าที่โหลดค้างอยู่ในเบราว์เซอร์ตอนนี้ไหม — เทียบ __APP_BUILD__ ที่ฝังไว้ตอน build
// (ดู vite.config.ts) กับค่าใน <meta name="app-build"> ของ index.html ตัวจริงบนเซิร์ฟเวอร์ ณ ขณะนี้ (fetch
// ใหม่ทุกครั้งด้วย cache: "no-store" กันโดนแคชของเบราว์เซอร์บังเวอร์ชันเก่าค้างไว้ ไม่ต้องพึ่ง header ฝั่ง
// nginx เลย) ใช้แค่ "แจ้งเตือน" ผู้ใช้ให้กดรีเฟรชเอง ไม่บังคับ reload ทันที กันข้อมูลที่กำลังกรอกอยู่หายไป
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // ทุก 5 นาที

function extractBuildId(html: string): string | null {
  return html.match(/<meta\s+name="app-build"\s+content="([^"]*)"/)?.[1] ?? null;
}

export function useVersionCheck(): boolean {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const checkedOnceRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch(`/index.html?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const html = await res.text();
        const latestBuildId = extractBuildId(html);
        if (!cancelled && latestBuildId && latestBuildId !== __APP_BUILD__) {
          setUpdateAvailable(true);
        }
      } catch {
        // เช็คไม่สำเร็จรอบนี้ไม่เป็นไร (เช่นเน็ตหลุดชั่วคราว) รอบถัดไปลองใหม่
      }
    }

    // เช็คทันทีตอนเปิดหน้าครั้งแรก (เผื่อพลาดรอบ deploy ไปตอนที่ปิดแท็บอยู่) แล้วค่อยเช็คเป็นระยะ +
    // เช็คซ้ำทุกครั้งที่กลับมาที่แท็บนี้ (สลับแท็บ/เปิดแอปกลับมาจากพื้นหลัง) ไม่ต้องรอครบรอบ interval เสมอไป
    if (!checkedOnceRef.current) { checkedOnceRef.current = true; check(); }
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    function onVisible() { if (document.visibilityState === "visible") check(); }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return updateAvailable;
}
