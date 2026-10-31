// Colour conversions for the colour picker. hue 0..360, saturation and value 0..1.

export function hsvToHex(h, s, v) {
    const f = n => {
        const k = (n + h / 60) % 6;
        const channel = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
        return Math.round(channel * 255).toString(16).padStart(2, '0');
    };
    return `#${f(5)}${f(3)}${f(1)}`;
}

/** Grey has no hue of its own, so `hue` is kept for it: the picker's hue must not jump. */
export function hexToHsv(hex, hue = 0) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    let h = hue;
    if (delta) {
        if (max === r) h = 60 * (((g - b) / delta + 6) % 6);
        else if (max === g) h = 60 * ((b - r) / delta + 2);
        else h = 60 * ((r - g) / delta + 4);
    }
    return { h, s: max ? delta / max : 0, v: max };
}

/** '#abc', 'abc' or 'AABBCC' to '#aabbcc', or null if it isn't a colour. */
export function parseHex(text) {
    const value = text.trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{6}$/.test(value)) return `#${value}`;
    if (/^[0-9a-f]{3}$/.test(value)) return `#${[...value].map(c => c + c).join('')}`;
    return null;
}
