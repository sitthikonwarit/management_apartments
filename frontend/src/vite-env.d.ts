/// <reference types="vite/client" />

declare module "*.css" {
  const content: string;
  export default content;
}

// รหัสประจำรุ่นของ build ปัจจุบัน — ฝังตอน build ผ่าน `define` ใน vite.config.ts (ดู useVersionCheck.ts)
declare const __APP_BUILD__: string;
