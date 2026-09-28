export type SlideRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SlideGrid = {
  rows: number;
  columns: number;
  regions: SlideRegion[];
};

type Band = { start: number; end: number; center: number };

function blankBands(density: number[], maxFraction = 0.12): Band[] {
  const size = density.length;
  const minLength = Math.max(2, Math.ceil(size * 0.012));
  const maxLength = Math.floor(size * maxFraction);
  const bands: Band[] = [];
  let start = -1;
  for (let index = 0; index <= size; index++) {
    const blank = index < size && density[index] <= 0.012;
    if (blank && start < 0) start = index;
    if (!blank && start >= 0) {
      const length = index - start;
      const center = (start + index) / (2 * size);
      if (
        length >= minLength &&
        length <= maxLength &&
        center >= 0.18 &&
        center <= 0.82
      ) {
        bands.push({ start, end: index, center });
      }
      start = -1;
    }
  }
  return bands;
}

function bandsFor(count: number, bands: Band[]): Band[] | undefined {
  if (count === 1) return [];
  const cuts: Band[] = [];
  for (let part = 1; part < count; part++) {
    const ideal = part / count;
    const band = bands
      .filter((candidate) => !cuts.includes(candidate))
      .sort((left, right) => {
        const leftWidth = left.end - left.start;
        const rightWidth = right.end - right.start;
        if (rightWidth !== leftWidth) return rightWidth - leftWidth;
        const leftDistance = Math.abs(left.center - ideal);
        const rightDistance = Math.abs(right.center - ideal);
        return leftDistance - rightDistance;
      })[0];
    if (!band || Math.abs(band.center - ideal) > 0.14) return undefined;
    cuts.push(band);
  }
  return cuts.sort((left, right) => left.center - right.center);
}

function rangesAroundGutters(count: number, bands: Band[], size: number) {
  const ranges = [];
  let start = 0;
  for (const band of bands) {
    const end = band.start / size;
    if (end > start) ranges.push({ start, end });
    start = band.end / size;
  }
  if (start < 1) ranges.push({ start, end: 1 });
  return ranges.length === count ? ranges : undefined;
}

function expandGutterEdges(bands: Band[], density: number[]): Band[] {
  return bands.map((band) => {
    let start = band.start;
    let end = band.end;
    // A printed page number can interrupt the strict blank run; absorb nearby
    // sparse marks so they stay in the gutter instead of one slide crop.
    while (start > 0 && density[start - 1] <= 0.03) start--;
    while (end < density.length && density[end] <= 0.03) end++;
    return { ...band, start, end };
  });
}

function mergeSparseInterruptions(bands: Band[], density: number[]): Band[] {
  const merged: Band[] = [];
  for (const band of bands) {
    const previous = merged.at(-1);
    if (!previous) {
      merged.push(band);
      continue;
    }
    const gapLength = band.start - previous.end;
    const sparseGap = density
      .slice(previous.end, band.start)
      .every((value) => value <= 0.03);
    if (
      gapLength <= Math.max(3, Math.floor(density.length * 0.04)) &&
      sparseGap
    ) {
      previous.end = band.end;
      previous.center = (previous.start + previous.end) / (2 * density.length);
    } else {
      merged.push(band);
    }
  }
  return merged;
}

function regionInkRatio(
  pixels: Uint8Array,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
) {
  let ink = 0;
  let samples = 0;
  const stride = Math.max(
    1,
    Math.floor(Math.sqrt(((right - left) * (bottom - top)) / 1800)),
  );
  for (let y = top; y < bottom; y += stride) {
    for (let x = left; x < right; x += stride) {
      if (pixels[y * width + x] < 232) ink++;
      samples++;
    }
  }
  return samples ? ink / samples : 0;
}

function containsNestedSlides(
  region: SlideRegion,
  width: number,
  height: number,
  pixels: Uint8Array,
) {
  const left = Math.max(0, Math.floor(region.x * width));
  const right = Math.min(width, Math.ceil((region.x + region.width) * width));
  const top = Math.max(0, Math.floor(region.y * height));
  const bottom = Math.min(
    height,
    Math.ceil((region.y + region.height) * height),
  );
  const cellWidth = right - left;
  const cellHeight = bottom - top;
  if (cellWidth < 16 || cellHeight < 16) return false;

  const rowDensity = Array.from({ length: cellHeight }, (_, y) => {
    let ink = 0;
    for (let x = left; x < right; x++)
      if (pixels[(top + y) * width + x] < 232) ink++;
    return ink / cellWidth;
  });
  const columnDensity = Array.from({ length: cellWidth }, (_, x) => {
    let ink = 0;
    for (let y = top; y < bottom; y++)
      if (pixels[y * width + left + x] < 232) ink++;
    return ink / cellHeight;
  });

  for (const [bands, size, horizontal] of [
    [blankBands(rowDensity, 0.36), cellHeight, true],
    [blankBands(columnDensity, 0.36), cellWidth, false],
  ] as const) {
    const gutter = bandsFor(2, bands)?.[0];
    if (!gutter) continue;
    const ranges = rangesAroundGutters(2, [gutter], size);
    if (!ranges) continue;
    const cells = ranges.map((range) => {
      const child = horizontal
        ? {
            left,
            right,
            top: top + Math.floor(range.start * cellHeight),
            bottom: top + Math.ceil(range.end * cellHeight),
          }
        : {
            left: left + Math.floor(range.start * cellWidth),
            right: left + Math.ceil(range.end * cellWidth),
            top,
            bottom,
          };
      const aspect = (child.right - child.left) / (child.bottom - child.top);
      return (
        aspect >= 0.65 &&
        aspect <= 2.2 &&
        regionInkRatio(
          pixels,
          width,
          child.left,
          child.top,
          child.right,
          child.bottom,
        ) > 0.004
      );
    });
    if (cells.every(Boolean)) return true;
  }
  return false;
}

export function makeSlideGrid(
  rows: number,
  columns: number,
  rowCuts?: number[],
  columnCuts?: number[],
): SlideGrid {
  const yEdges = [
    0,
    ...(rowCuts ?? Array.from({ length: rows - 1 }, (_, i) => (i + 1) / rows)),
    1,
  ];
  const xEdges = [
    0,
    ...(columnCuts ??
      Array.from({ length: columns - 1 }, (_, i) => (i + 1) / columns)),
    1,
  ];
  const yRanges = yEdges
    .slice(0, -1)
    .map((start, index) => ({ start, end: yEdges[index + 1] }));
  const xRanges = xEdges
    .slice(0, -1)
    .map((start, index) => ({ start, end: xEdges[index + 1] }));
  return {
    rows,
    columns,
    regions: yRanges.flatMap(({ start: y0, end: y1 }) =>
      xRanges.map(({ start: x0, end: x1 }) => ({
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
      })),
    ),
  };
}

export type SlideResizeHandle = "top" | "right" | "bottom" | "left";

export type SlideResizeOptions = {
  preserveAspectRatio?: boolean;
  fromCenter?: boolean;
};

const minimumSlideRegionSize = 0.035;
const geometryEpsilon = 0.000001;

function resizeCandidate(
  grid: SlideGrid,
  referenceIndex: number,
  handle: SlideResizeHandle,
  targetWidth: number,
  targetHeight: number,
  fromCenter: boolean,
): SlideGrid {
  const reference = grid.regions[referenceIndex];
  const scaleX = targetWidth / reference.width;
  const scaleY = targetHeight / reference.height;
  const widthChange = (region: SlideRegion) => region.width * (scaleX - 1);
  const heightChange = (region: SlideRegion) => region.height * (scaleY - 1);
  const maxColumn = Math.max(1, grid.columns - 1);
  const maxRow = Math.max(1, grid.rows - 1);

  return {
    ...grid,
    regions: grid.regions.map((region, index) => {
      const row = Math.floor(index / grid.columns);
      const column = index % grid.columns;
      const width = region.width * scaleX;
      const height = region.height * scaleY;
      let x = region.x;
      let y = region.y;

      if (fromCenter) {
        x += (region.width - width) / 2;
        y += (region.height - height) / 2;
      } else {
        const dw = widthChange(region);
        const dh = heightChange(region);
        if (handle === "left") x -= dw * (1 - column / maxColumn);
        if (handle === "right") x -= dw * (column / maxColumn);
        if (handle === "top") y -= dh * (1 - row / maxRow);
        if (handle === "bottom") y -= dh * (row / maxRow);

        // A side handle keeps the corresponding outside edge fixed across the
        // whole grid; an aspect-locked change on the other axis stays centered.
        if (handle === "left" || handle === "right")
          y += (region.height - height) / 2;
        else x += (region.width - width) / 2;
      }

      return { x, y, width, height };
    }),
  };
}

function validSlideRegions(regions: SlideRegion[]) {
  return regions.every(
    ({ x, y, width, height }) =>
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width >= minimumSlideRegionSize - geometryEpsilon &&
      height >= minimumSlideRegionSize - geometryEpsilon &&
      x >= 0 &&
      y >= 0 &&
      x + width <= 1 &&
      y + height <= 1,
  );
}

/**
 * Resize the shared crop geometry from one box. All regions receive the same
 * proportional size change, and a binary-searched clamp keeps every box on
 * the original PDF page.
 */
export function resizeSlideGrid(
  grid: SlideGrid,
  regionIndex: number,
  handle: SlideResizeHandle,
  delta: { x: number; y: number },
  options: SlideResizeOptions = {},
): SlideGrid {
  const reference = grid.regions[regionIndex];
  if (!reference || grid.regions.length === 0) return grid;

  const horizontal = handle === "left" || handle === "right";
  const direction = handle === "right" || handle === "bottom" ? 1 : -1;
  const fromCenter = options.fromCenter ?? false;
  const multiplier = fromCenter ? 2 : 1;
  let targetWidth = reference.width;
  let targetHeight = reference.height;

  if (horizontal) {
    targetWidth += direction * delta.x * multiplier;
    if (options.preserveAspectRatio)
      targetHeight = targetWidth / (reference.width / reference.height);
  } else {
    targetHeight += direction * delta.y * multiplier;
    if (options.preserveAspectRatio)
      targetWidth = targetHeight * (reference.width / reference.height);
  }

  targetWidth = Math.max(minimumSlideRegionSize, targetWidth);
  targetHeight = Math.max(minimumSlideRegionSize, targetHeight);

  const candidateAt = (progress: number) =>
    resizeCandidate(
      grid,
      regionIndex,
      handle,
      reference.width + (targetWidth - reference.width) * progress,
      reference.height + (targetHeight - reference.height) * progress,
      fromCenter,
    );

  const full = candidateAt(1);
  if (validSlideRegions(full.regions)) return full;

  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 32; iteration++) {
    const middle = (low + high) / 2;
    if (validSlideRegions(candidateAt(middle).regions)) low = middle;
    else high = middle;
  }
  return candidateAt(low);
}

function mirroredMoveFactors(
  regions: SlideRegion[],
  activeIndex: number,
  axis: "x" | "y",
  divisions: number,
) {
  const active = regions[activeIndex];
  const activeCenter =
    axis === "x" ? active.x + active.width / 2 : active.y + active.height / 2;
  const activeSide = Math.sign(activeCenter - 0.5);

  // A lone column/row can translate as a unit. With multiple divisions, a
  // center cell is the symmetry anchor and cannot drift off the page center.
  if (divisions > 1 && activeSide === 0) return regions.map(() => 0);

  return regions.map((region) => {
    if (divisions <= 1) return 1;
    const center =
      axis === "x" ? region.x + region.width / 2 : region.y + region.height / 2;
    const side = Math.sign(center - 0.5);
    if (side === 0) return 0;
    return side === activeSide ? 1 : -1;
  });
}

function clampSymmetricDelta(
  regions: SlideRegion[],
  factors: number[],
  axis: "x" | "y",
  delta: number,
) {
  let minimum = -Infinity;
  let maximum = Infinity;
  regions.forEach((region, index) => {
    const factor = factors[index];
    if (!factor) return;
    const position = axis === "x" ? region.x : region.y;
    const size = axis === "x" ? region.width : region.height;
    const first = -position / factor;
    const second = (1 - position - size) / factor;
    minimum = Math.max(minimum, Math.min(first, second));
    maximum = Math.min(maximum, Math.max(first, second));
  });
  return Math.min(maximum, Math.max(minimum, delta));
}

/**
 * Move one crop while mirroring its movement across the source page center.
 * Opposite columns/rows travel in the opposite direction so the layout stays
 * centered; a single row or column translates together.
 */
export function moveSlideGridSymmetrically(
  grid: SlideGrid,
  regionIndex: number,
  delta: { x: number; y: number },
): SlideGrid {
  if (!grid.regions[regionIndex]) return grid;
  const xFactors = mirroredMoveFactors(
    grid.regions,
    regionIndex,
    "x",
    grid.columns,
  );
  const yFactors = mirroredMoveFactors(
    grid.regions,
    regionIndex,
    "y",
    grid.rows,
  );
  const dx = clampSymmetricDelta(grid.regions, xFactors, "x", delta.x);
  const dy = clampSymmetricDelta(grid.regions, yFactors, "y", delta.y);

  return {
    ...grid,
    regions: grid.regions.map((region, index) => ({
      ...region,
      x: region.x + dx * xFactors[index],
      y: region.y + dy * yFactors[index],
    })),
  };
}

type RelativeCrop = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function contentCropForRegion(
  width: number,
  height: number,
  pixels: Uint8Array,
  region: SlideRegion,
): RelativeCrop | undefined {
  const left = Math.max(0, Math.floor(region.x * width));
  const top = Math.max(0, Math.floor(region.y * height));
  const right = Math.min(width, Math.ceil((region.x + region.width) * width));
  const bottom = Math.min(
    height,
    Math.ceil((region.y + region.height) * height),
  );
  const tileWidth = right - left;
  const tileHeight = bottom - top;
  if (tileWidth < 4 || tileHeight < 4) return undefined;

  // Treat light antialiasing, pale diagram fills and compressed PDF text as
  // content. A nearly-white threshold is intentionally conservative: leaving
  // a little margin is preferable to silently cutting a slide.
  const rowIsContent = (y: number) => {
    let ink = 0;
    for (let x = left; x < right; x++) if (pixels[y * width + x] < 250) ink++;
    return ink >= Math.max(2, Math.ceil(tileWidth * 0.004));
  };
  const columnIsContent = (x: number) => {
    let ink = 0;
    for (let y = top; y < bottom; y++) if (pixels[y * width + x] < 250) ink++;
    return ink >= Math.max(2, Math.ceil(tileHeight * 0.004));
  };
  if (
    !Array.from({ length: tileHeight }, (_, offset) =>
      rowIsContent(top + offset),
    ).some(Boolean) ||
    !Array.from({ length: tileWidth }, (_, offset) =>
      columnIsContent(left + offset),
    ).some(Boolean)
  )
    return undefined;

  const frameRows: number[] = [];
  const frameColumns: number[] = [];
  for (let y = top; y < bottom; y++) {
    let ink = 0;
    for (let x = left; x < right; x++) if (pixels[y * width + x] < 250) ink++;
    if (ink >= Math.ceil(tileWidth * 0.25)) frameRows.push(y);
  }
  for (let x = left; x < right; x++) {
    let ink = 0;
    for (let y = top; y < bottom; y++) if (pixels[y * width + x] < 250) ink++;
    if (ink >= Math.ceil(tileHeight * 0.25)) frameColumns.push(x);
  }

  let contentTop: number;
  let contentBottom: number;
  let contentLeft: number;
  let contentRight: number;
  const hasSlideFrame =
    frameRows.length >= 2 &&
    frameColumns.length >= 2 &&
    frameRows.at(-1)! - frameRows[0] >= tileHeight * 0.35 &&
    frameColumns.at(-1)! - frameColumns[0] >= tileWidth * 0.35 &&
    // Internal tables and callout boxes can also form four strong lines.
    // Only trust a frame when its edges sit near the tile's outer edges.
    frameRows[0] - top <= tileHeight * 0.22 &&
    bottom - 1 - frameRows.at(-1)! <= tileHeight * 0.22 &&
    frameColumns[0] - left <= tileWidth * 0.22 &&
    right - 1 - frameColumns.at(-1)! <= tileWidth * 0.22;
  if (hasSlideFrame) {
    // Use the outer slide border when present, excluding dates/page numbers
    // that handouts often place outside the actual slide frame.
    contentTop = frameRows[0];
    contentBottom = frameRows.at(-1)!;
    contentLeft = frameColumns[0];
    contentRight = frameColumns.at(-1)!;
  } else {
    contentTop = top;
    contentBottom = bottom - 1;
    contentLeft = left;
    contentRight = right - 1;
    while (contentTop < contentBottom && !rowIsContent(contentTop))
      contentTop++;
    while (contentBottom > contentTop && !rowIsContent(contentBottom))
      contentBottom--;
    while (contentLeft < contentRight && !columnIsContent(contentLeft))
      contentLeft++;
    while (contentRight > contentLeft && !columnIsContent(contentRight))
      contentRight--;
  }

  const paddingX = Math.ceil(tileWidth * 0.035);
  const paddingY = Math.ceil(tileHeight * 0.04);
  const trimmedLeft = Math.max(left, contentLeft - paddingX);
  const trimmedTop = Math.max(top, contentTop - paddingY);
  const trimmedRight = Math.min(right, contentRight + 1 + paddingX);
  const trimmedBottom = Math.min(bottom, contentBottom + 1 + paddingY);
  // Keep a substantial content area; large page margins on handouts are common.
  if (
    trimmedLeft - left > tileWidth * 0.38 ||
    trimmedTop - top > tileHeight * 0.38 ||
    right - trimmedRight > tileWidth * 0.38 ||
    bottom - trimmedBottom > tileHeight * 0.38
  )
    return undefined;

  return {
    left: (trimmedLeft - left) / tileWidth,
    top: (trimmedTop - top) / tileHeight,
    right: (trimmedRight - left) / tileWidth,
    bottom: (trimmedBottom - top) / tileHeight,
  };
}

/** Applies one shared crop envelope to every tile, preserving equal slide sizes. */
export function trimSlideGridFromLuminance(
  width: number,
  height: number,
  pixels: Uint8Array,
  grid: SlideGrid,
): SlideGrid {
  if (
    width < 1 ||
    height < 1 ||
    pixels.length < width * height ||
    !grid.regions.length
  )
    return grid;
  const crops = grid.regions.map((region) =>
    contentCropForRegion(width, height, pixels, region),
  );
  // One uncertain/empty tile must not let confident neighboring tiles define
  // a crop that could remove its pale or image-only content.
  if (crops.some((crop) => !crop)) return grid;
  const confidentCrops = crops as RelativeCrop[];
  const shared: RelativeCrop = {
    left: Math.min(...confidentCrops.map((crop) => crop.left)),
    top: Math.min(...confidentCrops.map((crop) => crop.top)),
    right: Math.max(...confidentCrops.map((crop) => crop.right)),
    bottom: Math.max(...confidentCrops.map((crop) => crop.bottom)),
  };
  return {
    ...grid,
    regions: grid.regions.map((region) => ({
      x: region.x + region.width * shared.left,
      y: region.y + region.height * shared.top,
      width: region.width * (shared.right - shared.left),
      height: region.height * (shared.bottom - shared.top),
    })),
  };
}

/** Conservative gutter-based guess; the user always previews and confirms it. */
export function detectSlideGridFromLuminance(
  width: number,
  height: number,
  pixels: Uint8Array,
): SlideGrid | undefined {
  if (width < 1 || height < 1 || pixels.length < width * height)
    return undefined;
  const rowDensity = Array.from({ length: height }, (_, y) => {
    let ink = 0;
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x] < 232) ink++;
    }
    return ink / width;
  });
  const columnDensity = Array.from({ length: width }, (_, x) => {
    let ink = 0;
    for (let y = 0; y < height; y++) {
      if (pixels[y * width + x] < 232) ink++;
    }
    return ink / height;
  });
  const rowBands = mergeSparseInterruptions(blankBands(rowDensity), rowDensity);
  const columnBands = mergeSparseInterruptions(
    blankBands(columnDensity),
    columnDensity,
  );
  const candidates: SlideGrid[] = [];
  for (let rows = 1; rows <= 3; rows++) {
    const rowGutters = bandsFor(rows, rowBands);
    if (!rowGutters) continue;
    const yRanges = rangesAroundGutters(
      rows,
      expandGutterEdges(rowGutters, rowDensity),
      height,
    );
    if (!yRanges) continue;
    for (let columns = 1; columns <= 3; columns++) {
      if (rows * columns < 2) continue;
      const columnGutters = bandsFor(columns, columnBands);
      if (!columnGutters) continue;
      const xRanges = rangesAroundGutters(
        columns,
        expandGutterEdges(columnGutters, columnDensity),
        width,
      );
      if (!xRanges) continue;
      const grid: SlideGrid = {
        rows,
        columns,
        regions: yRanges.flatMap(({ start: y0, end: y1 }) =>
          xRanges.map(({ start: x0, end: x1 }) => ({
            x: x0,
            y: y0,
            width: x1 - x0,
            height: y1 - y0,
          })),
        ),
      };
      const plausibleCells = grid.regions.every((region) => {
        const aspect = (width * region.width) / (height * region.height);
        // Dense speaker-notes pages can look like a column grid at first
        // glance. Typical lecture slides are landscape; reject narrow cells
        // rather than suggesting that two stacked slides are one portrait tile.
        if (aspect < 0.55 || aspect > 2.9) return false;
        const left = Math.floor(region.x * width);
        const right = Math.ceil((region.x + region.width) * width);
        const top = Math.floor(region.y * height);
        const bottom = Math.ceil((region.y + region.height) * height);
        return (
          regionInkRatio(pixels, width, left, top, right, bottom) > 0.0015 &&
          !containsNestedSlides(region, width, height, pixels)
        );
      });
      if (plausibleCells) candidates.push(grid);
    }
  }
  return candidates.sort(
    (left, right) => right.regions.length - left.regions.length,
  )[0];
}

export function detectSlideGrid(
  canvas: HTMLCanvasElement,
): SlideGrid | undefined {
  if (canvas.width < 1 || canvas.height < 1) return undefined;
  const scale = Math.min(1, 240 / Math.max(canvas.width, canvas.height));
  const width = Math.max(32, Math.round(canvas.width * scale));
  const height = Math.max(32, Math.round(canvas.height * scale));
  const sample = document.createElement("canvas");
  sample.width = width;
  sample.height = height;
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(canvas, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  const luminance = new Uint8Array(width * height);
  for (let index = 0; index < luminance.length; index++) {
    const offset = index * 4;
    luminance[index] = Math.round(
      (rgba[offset] * 3 + rgba[offset + 1] * 6 + rgba[offset + 2]) / 10,
    );
  }
  sample.width = 0;
  sample.height = 0;
  const detected = detectSlideGridFromLuminance(width, height, luminance);
  if (!detected) return undefined;
  const edgeInset = 0.005;
  const inset = {
    ...detected,
    regions: detected.regions.map((region) => {
      const xInset = region.x <= 0.001 ? edgeInset : 0;
      const yInset = region.y <= 0.001 ? edgeInset : 0;
      const rightInset = region.x + region.width >= 0.999 ? edgeInset : 0;
      const bottomInset = region.y + region.height >= 0.999 ? edgeInset : 0;
      return {
        x: region.x + xInset,
        y: region.y + yInset,
        width: region.width - xInset - rightInset,
        height: region.height - yInset - bottomInset,
      };
    }),
  };
  return trimSlideGridFromLuminance(width, height, luminance, inset);
}

export function trimSlideGrid(
  canvas: HTMLCanvasElement,
  grid: SlideGrid,
): SlideGrid {
  if (canvas.width < 1 || canvas.height < 1) return grid;
  const scale = Math.min(1, 480 / Math.max(canvas.width, canvas.height));
  const width = Math.max(32, Math.round(canvas.width * scale));
  const height = Math.max(32, Math.round(canvas.height * scale));
  const sample = document.createElement("canvas");
  sample.width = width;
  sample.height = height;
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) return grid;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(canvas, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  const luminance = new Uint8Array(width * height);
  for (let index = 0; index < luminance.length; index++) {
    const offset = index * 4;
    luminance[index] = Math.round(
      (rgba[offset] * 3 + rgba[offset + 1] * 6 + rgba[offset + 2]) / 10,
    );
  }
  sample.width = 0;
  sample.height = 0;
  return trimSlideGridFromLuminance(width, height, luminance, grid);
}
