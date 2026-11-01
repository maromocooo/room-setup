// Minimal stroke icon set (24×24, currentColor). Use <i data-icon="name"></i>
// in markup; hydrateIcons() swaps the placeholders for inline SVG.

const PATHS = {
    logo: '<path d="M3 10.5 12 4l9 6.5V20H3z"/><path d="M9 20v-6h6v6"/>',
    plan: '<rect x="3.5" y="3.5" width="17" height="17" rx="1"/><path d="M3.5 11h7M14 11h6.5M10.5 3.5v4"/>',
    cube: '<path d="M12 2.8 3.5 7.5v9L12 21.2l8.5-4.7v-9z"/><path d="m3.5 7.5 8.5 4.7 8.5-4.7M12 12.2v9"/>',
    wall: '<path d="M6 18 18 6"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/>',
    select: '<path d="M5.5 3.5 18 11l-5.6 1.7L10 18.5z"/>',
    erase: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.9 12.5h9.2L17.5 7M9.5 7V4.5h5V7"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
    open: '<path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    save: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    chevronDown: '<path d="M7 10l5 5 5-5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-5-5-8.5 8.5"/>',
    sparkles: '<path d="m12 3 1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"/><path d="m18.5 15 .8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    'eye-off': '<path d="M4 4l16 16M10.6 6.1A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.6 7.1C3.9 8.8 2.5 12 2.5 12s3.5 6.5 9.5 6.5a8.7 8.7 0 0 0 4.3-1.1"/>',
    solid: '<rect x="4.5" y="4.5" width="15" height="15" rx="1.5" fill="currentColor" fill-opacity=".25"/>',
    ghost: '<rect x="4.5" y="4.5" width="15" height="15" rx="1.5" stroke-dasharray="3 2.4"/>',
    orbit: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v4.5H8"/>',
    top: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx=".5"/>',
    walk: '<circle cx="13" cy="4.5" r="2"/><path d="m9 21 2.5-6.5L14 16v5"/><path d="m7.5 12 2.5-4h4l2.5 4.5"/><path d="M11.5 14.5 12 8"/>',
    person: '<circle cx="12" cy="5.5" r="2.2"/><path d="M8 21v-6.5l-1.5-1V10a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v3.5l-1.5 1V21"/>',
    move: '<path d="M12 3v18M3 12h18M9 5.5 12 3l3 2.5M9 18.5l3 2.5 3-2.5M5.5 9 3 12l2.5 3M18.5 9 21 12l-2.5 3"/>',
    rotate: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    floor: '<path d="M3 15.5 9 9h12l-6 6.5z"/><path d="M7 11.2h12M5 13.4h12"/>',
    brightness: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1 1M17.4 17.4l1 1M5.6 18.4l1-1M17.4 6.6l1-1"/>',
    chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3"/>',
    ruler: '<path d="m3.5 16.5 13-13 4 4-13 13z"/><path d="m7.5 12.5 2 2M10.5 9.5l2 2M13.5 6.5l2 2"/>',
};

export function icon(name, className = 'icon') {
    const body = PATHS[name];
    if (!body) return '';
    return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function hydrateIcons(root = document) {
    for (const placeholder of root.querySelectorAll('i[data-icon]')) {
        placeholder.outerHTML = icon(placeholder.dataset.icon);
    }
}
