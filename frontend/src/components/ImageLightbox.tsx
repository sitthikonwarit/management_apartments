// ป็อปอัพดูรูปเต็มจอ พร้อมปุ่มเลื่อนซ้าย/ขวา — สไตล์เดียวกับที่ใช้ดูรูปห้องพัก/ผู้เช่า/ยานพาหนะ/บิล
// ทั่วทั้งเว็บ (เดิมแต่ละหน้า copy โค้ดเดียวกันนี้ซ้ำกันเอง ดึงมารวมไว้ที่นี่ให้หน้าแชทเรียกใช้ร่วมด้วย)
interface ImageLightboxProps {
  images: string[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}

export default function ImageLightbox({ images, index, onClose, onIndexChange }: ImageLightboxProps) {
  const hasMultiple = images.length > 1;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <button
        style={{ position: "absolute", top: 16, right: 20, background: "none", border: "none", color: "#fff", fontSize: "2rem", cursor: "pointer" }}
        onClick={onClose}
      >
        ×
      </button>
      {hasMultiple && (
        <button
          style={{ position: "absolute", left: 16, background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", borderRadius: "50%", width: 40, height: 40, fontSize: "1.2rem", cursor: "pointer" }}
          onClick={(e) => { e.stopPropagation(); onIndexChange((index - 1 + images.length) % images.length); }}
        >
          <i className="fas fa-chevron-left" />
        </button>
      )}
      <img
        src={images[index]} alt=""
        style={{ maxWidth: "90vw", maxHeight: "85vh", borderRadius: 8, boxShadow: "0 4px 32px rgba(0,0,0,0.5)" }}
        onClick={(e) => e.stopPropagation()}
      />
      {hasMultiple && (
        <button
          style={{ position: "absolute", right: 16, background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", borderRadius: "50%", width: 40, height: 40, fontSize: "1.2rem", cursor: "pointer" }}
          onClick={(e) => { e.stopPropagation(); onIndexChange((index + 1) % images.length); }}
        >
          <i className="fas fa-chevron-right" />
        </button>
      )}
      {hasMultiple && (
        <div style={{ position: "absolute", bottom: 12, color: "rgba(255,255,255,0.7)", fontSize: "0.85rem" }}>
          {index + 1} / {images.length}
        </div>
      )}
    </div>
  );
}
