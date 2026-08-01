// แถบลากปรับความกว้างคอลัมน์ — วางไว้ในสุดของ <th> แต่ละอัน (ทางขอบขวา)
export default function ColResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <span
      className="col-resize-handle"
      onMouseDown={onMouseDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
