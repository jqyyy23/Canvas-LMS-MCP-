/**
 * Generates `icon.png`, the 512x512 tile Claude Desktop shows for the extension.
 *
 * Drawn in code rather than committed as an opaque binary, so it can be reviewed,
 * recoloured, and regenerated. There is no image dependency here: the shapes are
 * simple enough to rasterize by hand and PNG's minimal form is a few chunks of
 * zlib-compressed scanlines.
 *
 *   node scripts/make-icon.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SIZE = 512;
const SS = 3; // supersampling factor; the whole icon is curves, so edges need it

/** UBC blue, and the paper the calendar is drawn on. */
const NAVY = [10, 45, 92];
const BLUE = [21, 101, 192];
const PAPER = [255, 255, 255];
const INK = [21, 101, 192];

/** Rounded-square coverage test, in the supersampled coordinate space. */
function inRoundedRect(x, y, left, top, w, h, r) {
    const right = left + w;
    const bottom = top + h;
    if (x < left || x > right || y < top || y > bottom) return false;
    const cx = Math.min(Math.max(x, left + r), right - r);
    const cy = Math.min(Math.max(y, top + r), bottom - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/**
 * Colour of one supersample. Painted back to front: tile, calendar body, header
 * band, hanging rings, then the three task rows with the top one checked off.
 */
function sample(x, y) {
    const s = (v) => v * SS;

    if (!inRoundedRect(x, y, s(26), s(26), s(460), s(460), s(104))) return null;

    // Vertical wash across the tile, so a flat fill does not read as dead space.
    const t = (y / (SIZE * SS)) ** 0.85;
    const tile = NAVY.map((c, i) => Math.round(c + (BLUE[i] - c) * t));

    // Calendar body.
    if (!inRoundedRect(x, y, s(112), s(126), s(288), s(272), s(30))) return tile;

    // Two rings straddling the band. Tested before the band paints over them.
    for (const cx of [s(180), s(332)]) {
        const d2 = (x - cx) ** 2 + (y - s(158)) ** 2;
        if (d2 <= s(19) ** 2 && d2 >= s(10) ** 2) return PAPER;
    }

    // Header band: same rounded top, square bottom.
    if (y < s(126 + 72)) return INK;

    // Three task rows. The first is struck through and preceded by a tick.
    const rows = [s(238), s(300), s(362)];
    for (const [i, cy] of rows.entries()) {
        const barLeft = s(196);
        const barWidth = i === 2 ? s(120) : s(168);
        if (inRoundedRect(x, y, barLeft, cy - s(11), barWidth, s(22), s(11))) {
            return i === 0 ? [175, 196, 222] : INK;
        }

        // Checkbox: filled with a tick on the done row, hollow otherwise.
        const boxLeft = s(146);
        const boxTop = cy - s(21);
        const outer = inRoundedRect(x, y, boxLeft, boxTop, s(42), s(42), s(12));
        if (!outer) continue;
        const inner = inRoundedRect(x, y, boxLeft + s(7), boxTop + s(7), s(28), s(28), s(6));
        if (i !== 0) return inner ? PAPER : INK;

        if (!inner) return INK;
        // Tick, as two thick segments in the box's local space.
        const lx = (x - boxLeft) / SS;
        const ly = (y - boxTop) / SS;
        const onStroke = (x1, y1, x2, y2, half) => {
            const dx = x2 - x1;
            const dy = y2 - y1;
            const u = Math.min(
                Math.max(((lx - x1) * dx + (ly - y1) * dy) / (dx * dx + dy * dy), 0),
                1,
            );
            return (lx - (x1 + u * dx)) ** 2 + (ly - (y1 + u * dy)) ** 2 <= half * half;
        };
        return onStroke(12, 21, 19, 28, 3.6) || onStroke(19, 28, 31, 14, 3.6) ? PAPER : INK;
    }

    return PAPER;
}

/** Renders to straight RGBA, averaging each pixel's SS x SS supersamples. */
function render() {
    const pixels = Buffer.alloc(SIZE * SIZE * 4);
    for (let py = 0; py < SIZE; py++) {
        for (let px = 0; px < SIZE; px++) {
            let r = 0;
            let g = 0;
            let b = 0;
            let hits = 0;
            for (let sy = 0; sy < SS; sy++) {
                for (let sx = 0; sx < SS; sx++) {
                    const c = sample(px * SS + sx, py * SS + sy);
                    if (!c) continue;
                    r += c[0];
                    g += c[1];
                    b += c[2];
                    hits++;
                }
            }
            const total = SS * SS;
            const o = (py * SIZE + px) * 4;
            if (hits === 0) continue; // transparent outside the tile
            pixels[o] = Math.round(r / hits);
            pixels[o + 1] = Math.round(g / hits);
            pixels[o + 2] = Math.round(b / hits);
            pixels[o + 3] = Math.round((hits / total) * 255);
        }
    }
    return pixels;
}

/** Minimal PNG writer: signature, IHDR, IDAT, IEND. */
function encodePng(pixels) {
    const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
    for (let y = 0; y < SIZE; y++) {
        raw[y * (SIZE * 4 + 1)] = 0; // filter type 0 (None)
        pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
    }

    const table = Array.from({ length: 256 }, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
    });
    const crc32 = (buf) => {
        let c = 0xffffffff;
        for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(body));
        return Buffer.concat([len, body, crc]);
    };

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(SIZE, 0);
    ihdr.writeUInt32BE(SIZE, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // colour type: RGBA
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

const out = fileURLToPath(new URL('../icon.png', import.meta.url));
writeFileSync(out, encodePng(render()));
console.log(`Wrote ${out}`);
