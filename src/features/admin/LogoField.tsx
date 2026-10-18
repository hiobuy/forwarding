import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Dialog } from "../../components/ui";
import { useToast } from "../../components/toast";
import { ApiError, api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { imageFrame, initialCrop, movedCrop, outputSize, resizedCrop, sameRect, sourceRect, type Handle, type Rect } from "../../domain/logo-crop";

type Kind = "primary" | "square" | "favicon";

const LIMITS: Record<Kind, { aspect: number | null; maxEdge: number; maxBytes: number }> = {
  primary: { aspect: null, maxEdge: 1200, maxBytes: 1024 * 1024 },
  square: { aspect: 1, maxEdge: 512, maxBytes: 1024 * 1024 },
  favicon: { aspect: 1, maxEdge: 128, maxBytes: 256 * 1024 },
};

const MIN_CROP = 32;
const HANDLES: { id: Handle; className: string }[] = [
  { id: "nw", className: "-top-1.5 -left-1.5 cursor-nwse-resize" },
  { id: "ne", className: "-top-1.5 -right-1.5 cursor-nesw-resize" },
  { id: "sw", className: "-bottom-1.5 -left-1.5 cursor-nesw-resize" },
  { id: "se", className: "-right-1.5 -bottom-1.5 cursor-nwse-resize" },
  { id: "n", className: "-top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize" },
  { id: "s", className: "-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize" },
  { id: "w", className: "top-1/2 -left-1.5 -translate-y-1/2 cursor-ew-resize" },
  { id: "e", className: "top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize" },
];

const checker =
  "bg-white bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0] bg-[linear-gradient(45deg,#e7e9ef_25%,transparent_25%),linear-gradient(-45deg,#e7e9ef_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e7e9ef_75%),linear-gradient(-45deg,transparent_75%,#e7e9ef_75%)]";

export function LogoField({
  kind,
  label,
  hint,
  present,
  version,
  canWrite,
  onChange,
}: {
  kind: Kind;
  label: string;
  hint: string;
  present: boolean;
  version: number;
  canWrite: boolean;
  onChange: (present: boolean, version: number) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.set("file", file);
      return api(`/api/admin/settings/business/assets/${kind}`, { method: "POST", body });
    },
    onSuccess: async () => {
      setCropFile(null);
      onChange(true, Date.now());
      await queryClient.invalidateQueries({ queryKey: ["branding"] });
      toast({ title: `${label} saved.`, tone: "success" });
    },
    onError: (error) => toast({ title: error instanceof ApiError ? error.message : "Could not upload that image.", tone: "danger" }),
  });
  const clear = useMutation({
    mutationFn: () => api(`/api/admin/settings/business/assets/${kind}`, { method: "DELETE" }),
    onSuccess: async () => {
      onChange(false, Date.now());
      await queryClient.invalidateQueries({ queryKey: ["branding"] });
      toast({ title: `${label} restored to the default mark.`, tone: "success" });
    },
    onError: (error) => toast({ title: error instanceof ApiError ? error.message : "Could not remove that image.", tone: "danger" }),
  });

  function take(file: File | undefined) {
    if (!file || !canWrite) return;
    const svg = file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
    const raster = ["image/png", "image/jpeg", "image/webp"].includes(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
    if (!svg && !raster) {
      toast({ title: "Upload a PNG, JPEG, WebP, or SVG file.", tone: "danger" });
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      toast({ title: "Choose an image under 12 MB.", tone: "danger" });
      return;
    }
    if (svg) upload.mutate(file);
    else setCropFile(file);
  }

  const frameClass = kind === "primary" ? "h-[72px] w-[148px]" : "size-[72px]";
  return (
    <div
      className={cn("flex gap-3 rounded-lg border border-line bg-slate-50/70 p-3 transition-colors", dragging && canWrite && "border-indigo-300 bg-indigo-50/70")}
      onDragOver={(event) => {
        if (!canWrite) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        if (!canWrite) return;
        event.preventDefault();
        setDragging(false);
        take(event.dataTransfer.files[0]);
      }}
    >
      <button
        type="button"
        disabled={!canWrite || upload.isPending}
        aria-label={present ? `Replace ${label}` : `Upload ${label}`}
        className={cn(
          "relative grid shrink-0 place-items-center overflow-hidden rounded-lg border bg-white",
          checker,
          frameClass,
          canWrite ? "border-dashed border-slate-300 hover:border-indigo-400" : "cursor-default border-slate-200",
        )}
        onClick={() => inputRef.current?.click()}
      >
        {present ? (
          <img src={`/api/branding/assets/${kind}?v=${version}`} alt="" className="h-full w-full object-contain p-1.5" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-slate-500">
            <ImagePlus size={16} aria-hidden="true" />
            <span className="text-[11px] font-medium">{canWrite ? "Upload" : "Default"}</span>
          </span>
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[13px] font-medium text-slate-800">{label}</span>
          <span className="text-[12px] font-normal text-slate-400">Optional</span>
        </div>
        <p className="mt-0.5 text-[12px] leading-5 text-slate-500">{hint}</p>
        {canWrite ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Button type="button" size="sm" variant="secondary" loading={upload.isPending && !cropFile} onClick={() => inputRef.current?.click()}>
              <Upload size={13} aria-hidden="true" />
              {present ? "Replace" : "Upload"}
            </Button>
            {present ? (
              <Button type="button" size="sm" variant="ghost" loading={clear.isPending} onClick={() => clear.mutate()}>
                Restore default
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-slate-400">{present ? "Custom mark" : "Default mark"}</p>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          take(file);
        }}
      />
      {cropFile ? (
        <LogoCropDialog
          file={cropFile}
          label={label}
          kind={kind}
          pending={upload.isPending}
          onClose={() => {
            if (!upload.isPending) setCropFile(null);
          }}
          onSave={(file) => upload.mutateAsync(file)}
        />
      ) : null}
    </div>
  );
}

function LogoCropDialog({
  file,
  label,
  kind,
  pending,
  onClose,
  onSave,
}: {
  file: File;
  label: string;
  kind: Kind;
  pending: boolean;
  onClose: () => void;
  onSave: (file: File) => Promise<unknown>;
}) {
  const toast = useToast();
  const maskId = useId().replace(/:/g, "");
  const spec = LIMITS[kind];
  const stageRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const panRef = useRef({ x: 0, y: 0 });
  const seeded = useRef(false);
  const [src, setSrc] = useState("");
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [crop, setCrop] = useState<Rect | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    setNatural(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    panRef.current = { x: 0, y: 0 };
    setCrop(null);
    seeded.current = false;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const measure = () => setStage({ w: node.clientWidth, h: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [src]);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((current) => Math.min(3, Math.max(1, current * (event.deltaY < 0 ? 1.06 : 0.94))));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [src]);

  useEffect(() => {
    if (!natural || stage.w < 8 || stage.h < 8) return;
    const frame = imageFrame(stage.w, stage.h, natural.w, natural.h, zoom, panRef.current.x, panRef.current.y);
    setCrop((current) => {
      const next = !seeded.current || !current ? initialCrop(frame, spec.aspect, MIN_CROP) : movedCrop(current, 0, 0, frame, spec.aspect, MIN_CROP);
      seeded.current = true;
      return current && sameRect(current, next) ? current : next;
    });
  }, [natural, stage.w, stage.h, zoom, spec.aspect]);

  const frame = natural && stage.w > 0 ? imageFrame(stage.w, stage.h, natural.w, natural.h, zoom, pan.x, pan.y) : null;
  const source = frame && crop && natural ? sourceRect(crop, frame, natural.w, natural.h) : null;

  useEffect(() => {
    const canvas = previewRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !source) return;
    const preview = outputSize(source.w, source.h, 224);
    canvas.width = preview.w;
    canvas.height = preview.h;
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, source.x, source.y, source.w, source.h, 0, 0, canvas.width, canvas.height);
  }, [source, kind]);

  function startDrag(event: ReactPointerEvent, mode: "move" | "pan" | Handle) {
    if (!natural || !crop || !frame) return;
    event.preventDefault();
    event.stopPropagation();
    const originX = event.clientX;
    const originY = event.clientY;
    const startCrop = crop;
    const startPan = pan;
    const move = (pointer: PointerEvent) => {
      const dx = pointer.clientX - originX;
      const dy = pointer.clientY - originY;
      if (mode === "pan") {
        const nextPan = { x: startPan.x + dx, y: startPan.y + dy };
        const nextFrame = imageFrame(stage.w, stage.h, natural.w, natural.h, zoom, nextPan.x, nextPan.y);
        panRef.current = nextPan;
        setPan(nextPan);
        setCrop(movedCrop({ ...startCrop, x: startCrop.x + dx, y: startCrop.y + dy }, 0, 0, nextFrame, spec.aspect, MIN_CROP));
        return;
      }
      const still = imageFrame(stage.w, stage.h, natural.w, natural.h, zoom, startPan.x, startPan.y);
      setCrop(mode === "move" ? movedCrop(startCrop, dx, dy, still, spec.aspect, MIN_CROP) : resizedCrop(startCrop, mode, dx, dy, still, spec.aspect, MIN_CROP));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  function reset() {
    if (!natural || stage.w < 8) return;
    panRef.current = { x: 0, y: 0 };
    seeded.current = true;
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setCrop(initialCrop(imageFrame(stage.w, stage.h, natural.w, natural.h, 1, 0, 0), spec.aspect, MIN_CROP));
  }

  async function save() {
    const image = imageRef.current;
    if (!image || !source || saving) return;
    setSaving(true);
    try {
      await onSave(await encodeLogo(image, source, spec.maxEdge, spec.maxBytes, kind));
    } catch (error) {
      if (!(error instanceof ApiError)) toast({ title: error instanceof Error ? error.message : "Could not crop that image.", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  const pixels = source ? outputSize(source.w, source.h, spec.maxEdge) : null;
  return (
    <Dialog
      open
      size="xl"
      title={`Crop ${label.toLowerCase()}`}
      description={spec.aspect === 1 ? "Drag the photo or the frame. The crop stays square. Scroll to zoom." : "Drag the frame to choose the mark, or drag the photo to reposition it. Scroll to zoom."}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending || saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} loading={pending || saving} disabled={!source}>
            Save image
          </Button>
        </>
      }
    >
      <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_132px]">
        <div>
          <div
            ref={stageRef}
            className={cn("relative h-[300px] touch-none overflow-hidden rounded-lg select-none", checker)}
            onPointerDown={(event) => startDrag(event, "pan")}
          >
            {src ? (
              <img
                ref={imageRef}
                src={src}
                alt=""
                draggable={false}
                className="pointer-events-none absolute max-w-none"
                style={frame ? { left: frame.x, top: frame.y, width: frame.w, height: frame.h } : undefined}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (image.naturalWidth < 1 || image.naturalHeight < 1) {
                    toast({ title: "Could not read that image.", tone: "danger" });
                    onClose();
                    return;
                  }
                  setNatural({ w: image.naturalWidth, h: image.naturalHeight });
                }}
                onError={() => {
                  toast({ title: "Could not read that image.", tone: "danger" });
                  onClose();
                }}
              />
            ) : null}
            {crop ? (
              <>
                <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
                  <defs>
                    <mask id={maskId}>
                      <rect width="100%" height="100%" fill="white" />
                      <rect x={crop.x} y={crop.y} width={crop.w} height={crop.h} fill="black" />
                    </mask>
                  </defs>
                  <rect width="100%" height="100%" fill="rgba(15,23,42,0.55)" mask={`url(#${maskId})`} />
                </svg>
                <div
                  role="group"
                  aria-label="Crop frame"
                  className="absolute cursor-move border-2 border-white"
                  style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h }}
                  onPointerDown={(event) => startDrag(event, "move")}
                >
                  <div className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/55" />
                  <div className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/55" />
                  <div className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/55" />
                  <div className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/55" />
                  {HANDLES.map((handle) => (
                    <button
                      key={handle.id}
                      type="button"
                      aria-label={`Resize ${handle.id}`}
                      className={cn("absolute size-3 rounded-sm border border-slate-300 bg-white shadow-sm", handle.className)}
                      onPointerDown={(event) => startDrag(event, handle.id)}
                    />
                  ))}
                </div>
              </>
            ) : (
              <span className="absolute inset-0 grid place-items-center text-[13px] text-slate-500">Preparing image…</span>
            )}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-slate-500">
              Zoom
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                aria-label="Zoom"
                className="h-1.5 min-w-0 flex-1 accent-indigo-600"
                onChange={(event) => setZoom(Number(event.target.value))}
              />
              <span className="w-9 tabular-nums">{Math.round(zoom * 100)}%</span>
            </label>
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              Reset
            </Button>
          </div>
        </div>
        <div>
          <p className="text-[12px] font-medium text-slate-500">Preview</p>
          <div className={cn("mt-1.5 grid min-h-16 place-items-center rounded-lg border border-line p-2", checker)}>
            <canvas ref={previewRef} className="max-h-28 max-w-full" />
          </div>
          <p className="mt-1.5 text-[12px] text-slate-500 tabular-nums">{pixels ? `${pixels.w} × ${pixels.h}` : "—"}</p>
          <p className="mt-1 text-[12px] leading-4 text-slate-400">{kind === "favicon" ? "Saved as a square icon." : "Transparent areas stay transparent."}</p>
        </div>
      </div>
    </Dialog>
  );
}

async function encodeLogo(image: HTMLImageElement, source: Rect, maxEdge: number, maxBytes: number, kind: Kind) {
  let size = outputSize(source.w, source.h, maxEdge);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = size.w;
    canvas.height = size.h;
    const context = canvas.getContext("2d");
    if (!context) break;
    context.drawImage(image, source.x, source.y, source.w, source.h, 0, 0, size.w, size.h);
    const png = await canvasBlob(canvas, "image/png");
    if (png && png.size <= maxBytes) return new File([png], `${kind}.png`, { type: "image/png" });
    for (const quality of [0.9, 0.75, 0.6]) {
      const webp = await canvasBlob(canvas, "image/webp", quality);
      if (webp && webp.type === "image/webp" && webp.size <= maxBytes) return new File([webp], `${kind}.webp`, { type: "image/webp" });
    }
    size = { w: Math.max(1, Math.round(size.w * 0.75)), h: Math.max(1, Math.round(size.h * 0.75)) };
  }
  throw new Error(kind === "favicon" ? "Favicon must be 256 KB or smaller." : "Logo must be 1 MB or smaller.");
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality));
}
