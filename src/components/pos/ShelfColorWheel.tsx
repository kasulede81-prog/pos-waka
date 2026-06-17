import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import clsx from "clsx";
import { hexToHsl, hslToHex, normalizeShelfHex } from "../../lib/shelfColor";

type Props = {
  value: string;
  onChange: (hex: string | null) => void;
  className?: string;
};

const SIZE = 220;
const CX = SIZE / 2;
const CY = SIZE / 2;
const OUTER_R = SIZE / 2 - 8;
const INNER_R = OUTER_R * 0.2;

function pickHex(clientX: number, clientY: number, rect: DOMRect): string | null {
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const dx = x - CX;
  const dy = y - CY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < INNER_R) return null;
  if (dist > OUTER_R) return null;
  const hue = (Math.atan2(dy, dx) * 180) / Math.PI;
  const normalizedHue = (hue + 360) % 360;
  const sat = Math.min(100, ((dist - INNER_R) / (OUTER_R - INNER_R)) * 100);
  return hslToHex(normalizedHue, sat, 52);
}

function markerPosition(hex: string): { x: number; y: number } {
  const { h, s } = hexToHsl(hex);
  const t = Math.min(1, Math.max(0, s / 100));
  const dist = INNER_R + t * (OUTER_R - INNER_R);
  const rad = (h * Math.PI) / 180;
  return { x: CX + Math.cos(rad) * dist, y: CY + Math.sin(rad) * dist };
}

export function ShelfColorWheel({ value, onChange, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    for (let angle = 0; angle < 360; angle += 1) {
      const start = ((angle - 0.5) * Math.PI) / 180;
      const end = ((angle + 0.5) * Math.PI) / 180;
      for (let r = INNER_R; r <= OUTER_R; r += 1) {
        const sat = ((r - INNER_R) / (OUTER_R - INNER_R)) * 100;
        ctx.beginPath();
        ctx.arc(CX, CY, r, start, end);
        ctx.strokeStyle = hslToHex(angle, sat, 52);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
    ctx.beginPath();
    ctx.arc(CX, CY, INNER_R, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#e7e5e4";
    ctx.lineWidth = 2;
    ctx.stroke();
  }, []);

  const pickAt = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const hex = pickHex(clientX, clientY, rect);
      onChange(hex);
    },
    [onChange],
  );

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
      pickAt(e.clientX, e.clientY);
    },
    [pickAt],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLCanvasElement>) => {
      if (!dragging) return;
      pickAt(e.clientX, e.clientY);
    },
    [dragging, pickAt],
  );

  const onPointerUp = useCallback((e: PointerEvent<HTMLCanvasElement>) => {
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const safeHex = normalizeShelfHex(value) ?? "#ea580c";
  const marker = markerPosition(safeHex);

  return (
    <div className={clsx("relative inline-flex touch-none select-none", className)}>
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className="rounded-full shadow-inner"
        aria-label="Color wheel"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <span
        className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md ring-1 ring-black/20"
        style={{ left: marker.x, top: marker.y, backgroundColor: safeHex }}
        aria-hidden
      />
      <button
        type="button"
        className="absolute left-1/2 top-1/2 h-[40%] w-[40%] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ maxHeight: INNER_R * 2, maxWidth: INNER_R * 2 }}
        aria-label="Reset to default color"
        onClick={() => onChange(null)}
      />
    </div>
  );
}
