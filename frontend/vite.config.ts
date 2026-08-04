import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { execSync } from "child_process";

// รหัสประจำรุ่นของ build นี้ — ใช้ git commit ล่าสุดถ้ามี (ตอน deploy จริงบนเซิร์ฟเวอร์ build ต่อจาก
// `git pull` เสมอ ดู .github/workflows/deploy.yml เลยได้ commit ที่ถูกต้องเป๊ะ) fallback เป็น timestamp
// ตอน build เผื่อรันนอก git repo (เช่น build แบบแยกไฟล์ไปทดสอบ) ฝัง build id นี้ทั้งใน JS bundle
// (ตัวแปร __APP_BUILD__ ดู vite-env.d.ts) และใน <meta name="app-build"> ของ index.html (ดู
// transformIndexHtml ด้านล่าง) ให้ useVersionCheck.ts เทียบกันได้ว่ามีเว็บเวอร์ชันใหม่กว่าที่โหลดค้างอยู่ไหม
function getBuildId(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return String(Date.now());
  }
}
const BUILD_ID = getBuildId();

function buildIdHtmlPlugin(): Plugin {
  return {
    name: "inject-build-id-meta",
    transformIndexHtml(html) {
      return html.replace("</head>", `    <meta name="app-build" content="${BUILD_ID}" />\n  </head>`);
    },
  };
}

// Bun's HTTP socket implementation ยังไม่มี `destroySoon` (มีใน Node ปกติ)
// ทำให้ vite proxy (ws:true) ล่มด้วย "socket.destroySoon is not a function"
// เวลาที่ handshake ของ WebSocket ไปยัง /api ไม่ได้ตอบกลับด้วย 101 Switching Protocols
// จึง patch เมธอดนี้เข้าไปให้ ตั้งแต่ตอนที่ socket ถูกสร้าง
function bunDestroySoonPolyfill(): Plugin {
  return {
    name: "bun-destroy-soon-polyfill",
    configureServer(server) {
      server.httpServer?.on("connection", (socket: any) => {
        if (typeof socket.destroySoon !== "function") {
          socket.destroySoon = function (callback?: () => void) {
            this.end(callback);
          };
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), bunDestroySoonPolyfill(), buildIdHtmlPlugin()],
  define: {
    __APP_BUILD__: JSON.stringify(BUILD_ID),
  },
  server: {
    port: 3000,
    host: true, // ฟังทุก network interface (0.0.0.0) เพื่อให้เปิดจากเครื่องอื่นในวง LAN เดียวกันได้
    fs: {
      allow: [resolve(__dirname, ".."), resolve(__dirname)],
    },
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        ws: true, // ให้พร็อกซี WebSocket ด้วย (ใช้กับ /api/ws สำหรับแจ้งเตือนแบบเรียลไทม์)
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      // รูปที่อัปโหลด (ห้อง/รถ/ผู้เช่า/สลิป) ให้ backend คืนเป็น path สัมพัทธ์ (ดู uploads/* ในแต่ละ route)
      // แล้วพร็อกซีผ่านตรงนี้แทนการฝัง host:port ตายตัว — กัน URL รูปพังตอน IP เครื่องใน LAN เปลี่ยน (DHCP)
      "/uploads": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
