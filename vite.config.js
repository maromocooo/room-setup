import { defineConfig, loadEnv } from 'vite';

// The browser only ever talks to its own origin; Vite forwards API calls to
// the gateway, so the gateway can stay bound to localhost and needs no CORS.
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const target = env.API_URL || `http://127.0.0.1:${env.API_PORT || 8001}`;
    // Keep the browser's Host header: the gateway checks Origin against it.
    const route = { target, changeOrigin: false };
    const proxy = { '/api': route, '/generated': route };
    return {
        server: { host: env.HOST || '127.0.0.1', port: Number(env.PORT || 5173), proxy },
        preview: { host: env.HOST || '127.0.0.1', port: Number(env.PORT || 4173), proxy },
        // three.js alone is ~700 kB minified; one chunk is fine for a local app.
        build: { chunkSizeWarningLimit: 1500 },
    };
});
