/**
 * The dot on the tray icon and the taskbar's overlay when sessions need you, painted into raw pixels. Chromium's
 * bitmaps are BGRA with premultiplied alpha on every platform Electron runs on (all little-endian). Pure functions.
 */

/** Pi Pocket's red for "needs you" (Tokyo Night's red, #f7768e). */
export const DOT_COLOR = { r: 0xf7, g: 0x76, b: 0x8e } as const;

/** Paint a filled circle into a BGRA bitmap, in place, smoothed at its edge. */
export function paintDot(
    bitmap: Buffer,
    width: number,
    height: number,
    circle: { cx: number; cy: number; radius: number },
    color: { r: number; g: number; b: number } = DOT_COLOR,
): void {
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const distance = Math.hypot(x + 0.5 - circle.cx, y + 0.5 - circle.cy);
            const cover = Math.min(1, Math.max(0, circle.radius - distance + 0.5));

            if (cover === 0) {
                continue;
            }

            const at = (y * width + x) * 4;
            const keep = 1 - cover;

            bitmap[at] = Math.round(color.b * cover + (bitmap[at] ?? 0) * keep);
            bitmap[at + 1] = Math.round(color.g * cover + (bitmap[at + 1] ?? 0) * keep);
            bitmap[at + 2] = Math.round(color.r * cover + (bitmap[at + 2] ?? 0) * keep);
            bitmap[at + 3] = Math.round(255 * cover + (bitmap[at + 3] ?? 0) * keep);
        }
    }
}

/** A dot in the icon's lower right corner, a little under half its size, as badges sit. */
export function cornerDot(width: number, height: number): { cx: number; cy: number; radius: number } {
    const radius = Math.min(width, height) * 0.22;

    return { cx: width - radius - 0.5, cy: height - radius - 0.5, radius };
}

/** A transparent square with one dot filling it: Windows' taskbar overlay. */
export function dotBitmap(size: number): Buffer {
    const bitmap = Buffer.alloc(size * size * 4);

    paintDot(bitmap, size, size, { cx: size / 2, cy: size / 2, radius: size / 2 - 0.5 });

    return bitmap;
}
