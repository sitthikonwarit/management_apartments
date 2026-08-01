import { createContext, useContext, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

type Theme = "light" | "dark";

const ThemeContext = createContext<{ theme: Theme; toggle: (origin?: { x: number; y: number }) => void }>({
  theme: "light",
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem("theme") as Theme) ?? "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("color-scheme", theme === "dark" ? "dark" : "light");
    document.body.classList.add("theme-transitioning");
    document.body.classList.toggle("dark-mode", theme === "dark");
    localStorage.setItem("theme", theme);
    const t = setTimeout(() => document.body.classList.remove("theme-transitioning"), 300);
    return () => clearTimeout(t);
  }, [theme]);

  // ทำอนิเมชันวงกลมค้างอยู่ (กดปุ่มรัวๆ) — ถ้าเริ่มอันใหม่ทับอันเก่าที่ยังเล่นไม่จบ จะเห็นภาพซ้อน/แหลกได้
  const activeTransitionRef = useRef<any>(null);

  // สลับธีมพร้อมอนิเมชันวงกลมขยายจากจุดที่กด (ปุ่มเปลี่ยนธีม) — ใช้ View Transition API ของเบราว์เซอร์
  // ถ้าเบราว์เซอร์รองรับ (Chrome/Edge/Safari รุ่นใหม่) ไม่งั้น fallback เป็นการสลับธีมตรงๆ แบบเดิม (Firefox
  // หรือกรณีผู้ใช้ตั้งค่า prefers-reduced-motion ไว้ ก็ข้ามอนิเมชันไปเลยเพื่อความเข้าถึงได้)
  function toggle(origin?: { x: number; y: number }) {
    const next: Theme = theme === "light" ? "dark" : "light";
    const supportsViewTransition = typeof document !== "undefined" && "startViewTransition" in document;
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (!supportsViewTransition || prefersReducedMotion) {
      setTheme(next);
      return;
    }

    // ถ้ากดรัวๆ ระหว่างที่วงกลมอันก่อนหน้ายังเล่นค้างอยู่ ให้จบอันเก่าทันทีก่อนเริ่มอันใหม่ กันภาพซ้อนกันแหลก
    activeTransitionRef.current?.skipTransition?.();

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const transition = (document as any).startViewTransition(() => {
      flushSync(() => setTheme(next));
    });
    activeTransitionRef.current = transition;

    transition.ready
      .then(() => {
        const anim = document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
          { duration: 550, easing: "ease-in-out", pseudoElement: "::view-transition-new(root)" }
        );
        anim.finished.catch(() => {});
      })
      .catch(() => {}); // ready จะ reject ถ้า transition ถูก skip/ยกเลิกไปก่อน (เช่นโดน skipTransition ด้านบน) — ไม่ต้องทำอะไรต่อ

    transition.finished.finally(() => {
      if (activeTransitionRef.current === transition) activeTransitionRef.current = null;
    });
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
