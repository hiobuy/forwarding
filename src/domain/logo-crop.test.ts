import { describe, expect, it } from "vitest";
import { clampCrop, imageFrame, initialCrop, movedCrop, outputSize, resizedCrop, sourceRect } from "./logo-crop";

const bounds = { x: 0, y: 0, w: 400, h: 300 };

describe("logo crop", () => {
  it("fits the image inside the stage and pans from the center", () => {
    const frame = imageFrame(200, 100, 100, 100, 1, 10, 0);
    expect(frame).toMatchObject({ x: 60, y: 0, w: 100, h: 100, scale: 1 });
  });

  it("starts the crop inside the image", () => {
    const frame = imageFrame(200, 100, 400, 200, 1, 0, 0);
    const crop = initialCrop(frame, null, 32);
    expect(crop.x).toBeGreaterThanOrEqual(frame.x);
    expect(crop.y).toBeGreaterThanOrEqual(frame.y);
    expect(crop.x + crop.w).toBeLessThanOrEqual(frame.x + frame.w + 0.01);
    expect(crop.y + crop.h).toBeLessThanOrEqual(frame.y + frame.h + 0.01);
  });

  it("keeps a square crop square while resizing a corner", () => {
    const next = resizedCrop({ x: 40, y: 40, w: 80, h: 80 }, "se", 20, 0, bounds, 1, 24);
    expect(next).toEqual({ x: 40, y: 40, w: 100, h: 100 });
  });

  it("resizes a free crop from the dragged edges", () => {
    const next = resizedCrop({ x: 40, y: 40, w: 80, h: 80 }, "se", 20, 10, bounds, null, 24);
    expect(next).toEqual({ x: 40, y: 40, w: 100, h: 90 });
  });

  it("stops the frame at the image bounds", () => {
    const next = movedCrop({ x: 10, y: 10, w: 80, h: 40 }, 500, -40, bounds, null, 24);
    expect(next).toEqual({ x: 320, y: 0, w: 80, h: 40 });
  });

  it("maps the stage crop back to source pixels", () => {
    const frame = imageFrame(100, 100, 100, 100, 1, 0, 0);
    expect(sourceRect({ x: 10, y: 20, w: 30, h: 40 }, frame, 100, 100)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });

  it("caps the long edge and shrinks an oversized square", () => {
    expect(outputSize(2400, 800, 1200)).toEqual({ w: 1200, h: 400 });
    expect(clampCrop({ x: 0, y: 0, w: 500, h: 100 }, { x: 0, y: 0, w: 100, h: 100 }, 1, 24)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});
