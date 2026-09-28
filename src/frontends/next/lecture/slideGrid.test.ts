import { describe, expect, it } from "vitest";
import {
  detectSlideGridFromLuminance,
  makeSlideGrid,
  moveSlideGridSymmetrically,
  resizeSlideGrid,
  trimSlideGridFromLuminance,
} from "./slideGrid";

const width = 180;
const height = 240;

function whitePage() {
  return new Uint8Array(width * height).fill(255);
}

function slide(
  pixels: Uint8Array,
  left: number,
  top: number,
  right: number,
  bottom: number,
) {
  const ink = (x: number, y: number) => {
    pixels[y * width + x] = 0;
  };
  for (let x = left; x <= right; x++) {
    ink(x, top);
    ink(x, bottom);
  }
  for (let y = top; y <= bottom; y++) {
    ink(left, y);
    ink(right, y);
  }
  for (let line = 0; line < 5; line++) {
    const y = top + 12 + line * 6;
    for (let x = left + 8; x < right - 8 - (line % 2) * 10; x++) ink(x, y);
  }
}

describe("detektering av sammansatta slides", () => {
  it("hittar ett jämnt 3×2-rutnät och använder mellanrummen som beskärning", () => {
    const pixels = whitePage();
    for (const top of [20, 94, 168]) {
      slide(pixels, 12, top, 83, top + 52);
      slide(pixels, 97, top, 168, top + 52);
    }
    // Small printed page furniture interrupts the empty band in strict mode.
    for (let y = 80; y < 87; y++) {
      for (let x = 14; x < 18; x++) pixels[y * width + x] = 0;
    }

    const grid = detectSlideGridFromLuminance(width, height, pixels);

    expect(grid).toMatchObject({ rows: 3, columns: 2 });
    expect(grid?.regions).toHaveLength(6);
    expect(grid?.regions[0].y).toBe(0);
    expect(grid?.regions[0].height).toBeLessThan(0.34);
    expect(grid?.regions[1].x).toBeGreaterThan(0.5);
    expect(grid?.regions[2].y).toBeGreaterThan(87 / height);
  });

  it("trimmar tomma ytterkanter men lämnar säkerhetsmarginal runt innehållet", () => {
    const pixels = whitePage();
    slide(pixels, 20, 30, 80, 100);
    slide(pixels, 100, 30, 160, 100);
    slide(pixels, 20, 135, 80, 215);
    slide(pixels, 100, 135, 160, 215);
    const grid = trimSlideGridFromLuminance(
      width,
      height,
      pixels,
      makeSlideGrid(2, 2),
    );

    expect(grid.regions[0].x * width).toBeLessThan(20);
    expect(grid.regions[0].y * height).toBeLessThan(30);
    expect(20 - grid.regions[0].x * width).toBeGreaterThan(width * 0.025);
    expect(30 - grid.regions[0].y * height).toBeGreaterThan(height * 0.025);
    expect(grid.regions[0].width).toBeLessThan(0.46);
    expect(grid.regions[0].height).toBeLessThan(0.42);
  });

  it("bevarar ljusa diagramstreck och lämnar extra marginal runt dem", () => {
    const pixels = whitePage();
    slide(pixels, 12, 55, 78, 155);
    for (let x = 102; x <= 168; x++) {
      pixels[55 * width + x] = 246;
      pixels[155 * width + x] = 246;
    }
    for (let y = 55; y <= 155; y++) {
      pixels[y * width + 102] = 246;
      pixels[y * width + 168] = 246;
    }

    const grid = trimSlideGridFromLuminance(
      width,
      height,
      pixels,
      makeSlideGrid(1, 2),
    );

    expect(grid.regions[1].x).toBeLessThan(102 / width);
    expect(grid.regions[1].x + grid.regions[1].width).toBeGreaterThan(
      168 / width,
    );
  });

  it("avstår från gemensam beskärning om någon ruta saknar säkert innehåll", () => {
    const pixels = whitePage();
    slide(pixels, 20, 30, 80, 100);
    const original = makeSlideGrid(1, 2);

    expect(trimSlideGridFromLuminance(width, height, pixels, original)).toEqual(
      original,
    );
  });

  it("använder samma gemensamma beskärning för alla rutor i ett rutnät", () => {
    const pixels = whitePage();
    slide(pixels, 18, 26, 74, 190);
    slide(pixels, 101, 42, 171, 214);
    const grid = trimSlideGridFromLuminance(
      width,
      height,
      pixels,
      makeSlideGrid(1, 2),
    );

    const [left, right] = grid.regions;
    expect(left.x / 0.5).toBeCloseTo((right.x - 0.5) / 0.5, 5);
    expect(left.width / 0.5).toBeCloseTo(right.width / 0.5, 5);
    expect(left.y).toBeCloseTo(right.y, 5);
    expect(left.height).toBeCloseTo(right.height, 5);
    // The shared crop contains the full content envelope of both slides.
    expect(left.x).toBeLessThan(0.1);
    expect(right.x + right.width).toBeGreaterThan(0.9);
  });

  it("avstår från ett smalt kolumnförslag när två slides ligger staplade", () => {
    const pixels = whitePage();
    slide(pixels, 18, 24, 78, 74);
    slide(pixels, 102, 24, 162, 74);
    slide(pixels, 18, 102, 78, 152);

    expect(detectSlideGridFromLuminance(width, height, pixels)).toBeUndefined();
  });

  it("ignorerar tomma eller ogiltiga pixelunderlag", () => {
    expect(
      detectSlideGridFromLuminance(0, height, new Uint8Array()),
    ).toBeUndefined();
    expect(
      detectSlideGridFromLuminance(width, height, new Uint8Array(2)),
    ).toBeUndefined();
    expect(
      detectSlideGridFromLuminance(width, height, whitePage()),
    ).toBeUndefined();
  });
});

describe("redigering av gemensamt slide-rutnät", () => {
  it("ändrar storleken proportionellt för alla rutor", () => {
    const grid = makeSlideGrid(2, 2);
    const resized = resizeSlideGrid(grid, 0, "right", { x: 0.04, y: 0 });

    for (const region of resized.regions)
      expect(region.width).toBeCloseTo(0.54);
    expect(resized.regions[0].x).toBeCloseTo(grid.regions[0].x);
    expect(resized.regions[1].x).toBeCloseTo(0.46);
  });

  it("Shift behåller rutans proportioner", () => {
    const grid = makeSlideGrid(2, 2);
    const resized = resizeSlideGrid(
      grid,
      0,
      "right",
      { x: 0.04, y: 0 },
      { preserveAspectRatio: true },
    );

    for (const region of resized.regions)
      expect(region.width / region.height).toBeCloseTo(1, 5);
  });

  it("Ctrl skalar från mitten av varje ruta", () => {
    const grid = makeSlideGrid(2, 2);
    const resized = resizeSlideGrid(
      grid,
      0,
      "right",
      { x: -0.04, y: 0 },
      { fromCenter: true },
    );

    expect(resized.regions[0].x + resized.regions[0].width / 2).toBeCloseTo(
      grid.regions[0].x + grid.regions[0].width / 2,
    );
    expect(resized.regions[0].width).toBeCloseTo(0.42);
    expect(resized.regions[3].width).toBeCloseTo(0.42);
  });

  it("begränsar resize så inga rutor går utanför originalsidan", () => {
    const resized = resizeSlideGrid(makeSlideGrid(2, 2), 0, "left", {
      x: -1,
      y: 0,
    });

    for (const region of resized.regions) {
      expect(region.x).toBeGreaterThanOrEqual(0);
      expect(region.y).toBeGreaterThanOrEqual(0);
      expect(region.x + region.width).toBeLessThanOrEqual(1);
      expect(region.y + region.height).toBeLessThanOrEqual(1);
    }
  });

  it("flyttar motsatta kolumner och rader symmetriskt", () => {
    const moved = moveSlideGridSymmetrically(makeSlideGrid(2, 2), 0, {
      x: 0.04,
      y: 0.03,
    });

    expect(moved.regions[0].x).toBeCloseTo(0.04);
    expect(moved.regions[1].x).toBeCloseTo(0.46);
    expect(moved.regions[2].x).toBeCloseTo(0.04);
    expect(moved.regions[2].y).toBeCloseTo(0.47);
    expect(moved.regions[3].x).toBeCloseTo(0.46);
    expect(moved.regions[3].y).toBeCloseTo(0.47);
    expect(moved.regions[0].x + moved.regions[1].x).toBeCloseTo(0.5);
    expect(moved.regions[0].y + moved.regions[2].y).toBeCloseTo(0.5);
  });

  it("klampar symmetrisk förflyttning vid sidans kanter", () => {
    const moved = moveSlideGridSymmetrically(makeSlideGrid(2, 2), 0, {
      x: -1,
      y: -1,
    });

    for (const region of moved.regions) {
      expect(region.x).toBeGreaterThanOrEqual(0);
      expect(region.y).toBeGreaterThanOrEqual(0);
      expect(region.x + region.width).toBeLessThanOrEqual(1);
      expect(region.y + region.height).toBeLessThanOrEqual(1);
    }
  });
});
