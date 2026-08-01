import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

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
  plugins: [react(), bunDestroySoonPolyfill()],
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
