import { useEffect } from "react";

// ป็อปอัพดูรูปเต็มๆ — ใช้คลาส .lightbox-overlay/.lightbox-close/.lightbox-img ชุดเดียวกับที่หน้าผู้เช่าใช้ดูรูป
// (App.css) เพื่อให้หน้าตา/ขนาดรูปตรงกันทั้งเว็บ เพิ่มปุ่มเลื่อนซ้าย/ขวา+ตัวนับให้เฉพาะตอนมีหลายรูป (เช่น
// ดูรูปในเธรดแชทที่มีหลายรูป) ซึ่งหน้าผู้เช่าไม่ต้องใช้เพราะมีรูปเดียว
interface ImageLightboxProps {
  images: string[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}

export default function ImageLightbox({ images, index, onClose, onIndexChange }: ImageLightboxProps) {
  const hasMultiple = images.length > 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose}>
        <i className="fas fa-times" />
      </button>
      {hasMultiple && (
        <button
          className="lightbox-nav lightbox-nav-prev"
          onClick={(e) => { e.stopPropagation(); onIndexChange((index - 1 + images.length) % images.length); }}
        >
          <i className="fas fa-chevron-left" />
        </button>
      )}
      <img
        className="lightbox-img"
        src={images[index]}
        alt="ขยายรูป"
        onClick={(e) => e.stopPropagation()}
      />
      {hasMultiple && (
        <button
          className="lightbox-nav lightbox-nav-next"
          onClick={(e) => { e.stopPropagation(); onIndexChange((index + 1) % images.length); }}
        >
          <i className="fas fa-chevron-right" />
        </button>
      )}
      {hasMultiple && (
        <div className="lightbox-counter">{index + 1} / {images.length}</div>
      )}
    </div>
  );
}
