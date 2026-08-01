import { useBreadcrumb } from "../../context/BreadcrumbContext";

export default function BreadcrumbBar() {
  const { items } = useBreadcrumb();
  if (items.length === 0) return null;

  return (
    <div id="breadcrumb-container" style={{ display: "block" }}>
      <nav aria-label="breadcrumb">
        <ol className="breadcrumb">
          {items.map((item, i) => (
            <li
              key={i}
              className={`breadcrumb-item${i === items.length - 1 ? " active" : ""}`}
              aria-current={i === items.length - 1 ? "page" : undefined}
            >
              {item.onClick ? (
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); item.onClick!(); }}
                >
                  {item.label}
                </a>
              ) : (
                item.label
              )}
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
