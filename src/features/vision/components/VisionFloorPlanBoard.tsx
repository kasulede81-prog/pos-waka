import { useRef, useState, type DragEvent } from "react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { EnterpriseCard } from "../../../components/enterprise/EnterpriseCard";
import { Body, Caption, SectionTitle } from "../../../components/enterprise/EnterpriseTypography";
import { WakaButton } from "../../../components/ui/wakaPrimitives";
import type { VisionCamera } from "../types";
import type { VisionFloorPlan } from "../workspace/types";
import { readFloorPlanImage } from "../workspace/workspaceStore";

export function VisionFloorPlanBoard({
  lang,
  plan,
  cameras,
  onUpload,
  onPinsChange,
  onClear,
  onSelectCamera,
}: {
  lang: Language;
  plan: VisionFloorPlan | null;
  cameras: VisionCamera[];
  onUpload: (dataUrl: string, name: string) => void;
  onPinsChange: (pins: VisionFloorPlan["pins"]) => void;
  onClear: () => void;
  onSelectCamera: (id: string) => void;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const byId = new Map(cameras.map((c) => [c.id, c]));

  const onFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await readFloorPlanImage(file);
      onUpload(dataUrl, file.name.replace(/\.[^.]+$/, "") || t(lang, "visionFloorDefaultName"));
    } catch (e) {
      const code = e instanceof Error ? e.message : "read_failed";
      setError(
        code === "image_too_large" ? t(lang, "visionFloorTooLarge") : t(lang, "visionFloorBadImage"),
      );
    }
  };

  const placePin = (clientX: number, clientY: number, cameraId: string) => {
    const el = mapRef.current;
    if (!el || !plan) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100));
    const rest = plan.pins.filter((p) => p.cameraId !== cameraId);
    onPinsChange([...rest, { cameraId, x, y }]);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const cameraId = e.dataTransfer.getData("text/vision-camera-id") || dragId;
    if (!cameraId) return;
    placePin(e.clientX, e.clientY, cameraId);
    setDragId(null);
  };

  return (
    <EnterpriseCard className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <SectionTitle>{t(lang, "visionFloorTitle")}</SectionTitle>
          <Caption className="text-muted-foreground">{t(lang, "visionFloorSub")}</Caption>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted/40">
            {t(lang, "visionFloorUpload")}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {plan ? (
            <WakaButton type="button" variant="ghost" onClick={onClear}>
              {t(lang, "visionFloorClear")}
            </WakaButton>
          ) : null}
        </div>
      </div>
      {error ? <Caption className="text-rose-600">{error}</Caption> : null}

      {!plan?.imageDataUrl ? (
        <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-4 text-center">
          <Caption className="text-muted-foreground">{t(lang, "visionFloorEmpty")}</Caption>
        </div>
      ) : (
        <div
          ref={mapRef}
          className="relative min-h-[280px] overflow-hidden rounded-xl border border-border bg-zinc-100 dark:bg-zinc-900"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={(e) => {
            if (!dragId) return;
            placePin(e.clientX, e.clientY, dragId);
            setDragId(null);
          }}
        >
          <img
            src={plan.imageDataUrl}
            alt={plan.name}
            className="pointer-events-none h-full max-h-[480px] w-full object-contain"
            draggable={false}
          />
          {plan.pins.map((pin) => {
            const cam = byId.get(pin.cameraId);
            if (!cam) return null;
            return (
              <button
                key={pin.cameraId}
                type="button"
                title={cam.name}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectCamera(cam.id);
                }}
                className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary px-2 py-1 text-[11px] font-bold text-primary-foreground shadow"
                style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
              >
                ● {cam.name}
              </button>
            );
          })}
        </div>
      )}

      {plan?.imageDataUrl ? (
        <div>
          <Caption className="mb-2 block text-muted-foreground">{t(lang, "visionFloorDragHint")}</Caption>
          <ul className="flex flex-wrap gap-2">
            {cameras.map((cam) => (
              <li key={cam.id}>
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/vision-camera-id", cam.id);
                    setDragId(cam.id);
                  }}
                  onClick={() => setDragId(cam.id)}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${
                    dragId === cam.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"
                  }`}
                >
                  {cam.name}
                </button>
              </li>
            ))}
          </ul>
          {dragId ? <Body className="mt-2 text-sm text-primary">{t(lang, "visionFloorTapPlace")}</Body> : null}
        </div>
      ) : null}
    </EnterpriseCard>
  );
}
