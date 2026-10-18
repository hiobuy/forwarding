export type Rect = { x: number; y: number; w: number; h: number };

export type Handle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

export type Frame = Rect & { scale: number };

export function imageFrame(stageW: number, stageH: number, naturalW: number, naturalH: number, zoom: number, panX: number, panY: number): Frame {
  const fit = Math.min(stageW / naturalW, stageH / naturalH);
  const scale = fit * zoom;
  const w = naturalW * scale;
  const h = naturalH * scale;
  return { x: (stageW - w) / 2 + panX, y: (stageH - h) / 2 + panY, w, h, scale };
}

export function initialCrop(frame: Rect, aspect: number | null, min: number): Rect {
  let w = frame.w * 0.9;
  let h = frame.h * 0.9;
  if (aspect) {
    if (w / h > aspect) w = h * aspect;
    else h = w / aspect;
  }
  return clampCrop({ x: frame.x + (frame.w - w) / 2, y: frame.y + (frame.h - h) / 2, w, h }, frame, aspect, min);
}

export function clampCrop(rect: Rect, bounds: Rect, aspect: number | null, min: number): Rect {
  const limit = Math.max(1, Math.min(bounds.w, bounds.h));
  const minSize = Math.min(min, limit);
  let w = rect.w;
  let h = rect.h;
  if (aspect) {
    w = Math.max(minSize, w);
    h = w / aspect;
    if (h < minSize) {
      h = minSize;
      w = h * aspect;
    }
    if (w > bounds.w) {
      w = bounds.w;
      h = w / aspect;
    }
    if (h > bounds.h) {
      h = bounds.h;
      w = h * aspect;
    }
  } else {
    w = Math.min(Math.max(minSize, w), bounds.w);
    h = Math.min(Math.max(minSize, h), bounds.h);
  }
  const x = Math.min(Math.max(rect.x, bounds.x), bounds.x + bounds.w - w);
  const y = Math.min(Math.max(rect.y, bounds.y), bounds.y + bounds.h - h);
  return { x, y, w, h };
}

export function movedCrop(start: Rect, dx: number, dy: number, bounds: Rect, aspect: number | null, min: number): Rect {
  return clampCrop({ ...start, x: start.x + dx, y: start.y + dy }, bounds, aspect, min);
}

export function resizedCrop(start: Rect, handle: Handle, dx: number, dy: number, bounds: Rect, aspect: number | null, min: number): Rect {
  const left = start.x;
  const top = start.y;
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  if (!aspect) {
    let x1 = left;
    let y1 = top;
    let x2 = right;
    let y2 = bottom;
    if (handle.includes("w")) x1 = left + dx;
    if (handle.includes("e")) x2 = right + dx;
    if (handle.includes("n")) y1 = top + dy;
    if (handle.includes("s")) y2 = bottom + dy;
    if (x2 < x1) [x1, x2] = [x2, x1];
    if (y2 < y1) [y1, y2] = [y2, y1];
    return clampCrop({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, bounds, null, min);
  }
  const fromWest = handle.includes("w");
  const fromNorth = handle.includes("n");
  const horizontal = handle === "e" || handle === "w";
  const vertical = handle === "n" || handle === "s";
  let w = start.w;
  let h = start.h;
  if (vertical) {
    h = Math.max(min, start.h + (fromNorth ? -dy : dy));
    w = h * aspect;
  } else {
    w = Math.max(min, start.w + (fromWest ? -dx : dx));
    h = w / aspect;
  }
  let x = fromWest ? right - w : left;
  let y = fromNorth ? bottom - h : top;
  if (vertical) x = left + (start.w - w) / 2;
  if (horizontal) y = top + (start.h - h) / 2;
  return clampCrop({ x, y, w, h }, bounds, aspect, min);
}

export function sourceRect(crop: Rect, frame: Frame, naturalW: number, naturalH: number) {
  const x = (crop.x - frame.x) / frame.scale;
  const y = (crop.y - frame.y) / frame.scale;
  const w = crop.w / frame.scale;
  const h = crop.h / frame.scale;
  const sx = Math.min(Math.max(x, 0), naturalW);
  const sy = Math.min(Math.max(y, 0), naturalH);
  return {
    x: sx,
    y: sy,
    w: Math.max(1, Math.min(w, naturalW - sx)),
    h: Math.max(1, Math.min(h, naturalH - sy)),
  };
}

export function outputSize(sourceW: number, sourceH: number, maxEdge: number) {
  const edge = Math.max(sourceW, sourceH);
  const scale = edge > maxEdge ? maxEdge / edge : 1;
  return {
    w: Math.max(1, Math.round(sourceW * scale)),
    h: Math.max(1, Math.round(sourceH * scale)),
  };
}

export function sameRect(a: Rect, b: Rect) {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
}
