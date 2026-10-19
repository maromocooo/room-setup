// Generation API client. Requests go to the page's own origin; Vite proxies
// /api and /generated to the gateway.

async function request(path, options = {}) {
    const response = await fetch(path, options);
    let body = null;
    try { body = await response.json(); } catch { /* empty or non-JSON body */ }
    if (!response.ok) {
        const error = new Error(body?.detail || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return body;
}

export const api = {
    engines: () => request('/api/engines'),
    loadEngine: id => request(`/api/engines/${encodeURIComponent(id)}/load`, { method: 'POST' }),

    createJob({ image, engine, texture, seed = 42 }) {
        const form = new FormData();
        form.append('file', image, image.name || 'furniture.png');
        form.append('engine', engine);
        form.append('texture', String(Boolean(texture)));
        form.append('seed', String(seed));
        return request('/api/jobs', { method: 'POST', body: form });
    },

    job: id => request(`/api/jobs/${encodeURIComponent(id)}`),

    deleteModel: id => request(`/api/models/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null),
};
