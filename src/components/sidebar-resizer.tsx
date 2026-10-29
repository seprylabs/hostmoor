const WIDTH_KEY = "stackport-sidebar-width";
const DEFAULT_WIDTH = 256;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

const clamp = (width: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));

export function loadSidebarWidth(): number {
  const saved = Number(localStorage.getItem(WIDTH_KEY));
  return saved ? clamp(saved) : DEFAULT_WIDTH;
}

function saveWidth(width: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // nur Komfort, darf fehlschlagen
  }
}

/** Ziehgriff am rechten Rand der Sidebar; Doppelklick setzt die Breite zurück */
export function SidebarResizer({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    let current = width;
    const move = (ev: PointerEvent) => {
      current = clamp(width + ev.clientX - startX);
      onResize(current);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      saveWidth(current);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Breite der Sidebar"
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      title="Ziehen zum Anpassen, Doppelklick setzt zurück"
      onPointerDown={onPointerDown}
      onDoubleClick={() => {
        onResize(DEFAULT_WIDTH);
        saveWidth(DEFAULT_WIDTH);
      }}
      className="hover:after:bg-sidebar-border active:after:bg-sidebar-ring fixed inset-y-0 left-[calc(var(--sidebar-width)-4px)] z-20 hidden w-2 cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 md:block"
    />
  );
}
