import { defineConfig, loadEnv, version } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
    plugins: [react()],
    // Keep optimized browser modules separate from other Vite versions in the monorepo.
    cacheDir: `node_modules/.vite-web-${version}`,
    resolve: {
        dedupe: ['react', 'react-dom'],
    },
    server: {
        port: 5173,
        strictPort: true,
        host: '0.0.0.0',
        allowedHosts: true,
        proxy: {
            '/api/auth': { target: 'http://localhost:4002', changeOrigin: true },
            '/api/notifications': { target: 'http://localhost:4003', changeOrigin: true },
            '/api/meetings': { target: 'http://localhost:4003', changeOrigin: true },
            '/api/live-streams': { target: 'http://localhost:4004', changeOrigin: true, ws: true },
            '/api/recordings': { target: 'http://localhost:4004', changeOrigin: true },
            '/ws': {
                target: 'ws://localhost:4001',
                ws: true,
            },
            '/api/mcu': {
                target: 'http://localhost:4005',
                changeOrigin: true,
            },
            '/api/gateway': {
                target: 'http://localhost:4005',
                changeOrigin: true,
            },
            '/api': {
                target: 'http://localhost:4001',
                changeOrigin: true,
            },
        },
    },
    define: {
        'process.env': {},
        ...(loadEnv(mode, process.cwd()).VITE_DEPLOYMENT === 'onprem' ? {
            'import.meta.env.VITE_API_URL': '""',
            'import.meta.env.VITE_AUTH_URL': '""',
            'import.meta.env.VITE_MEETING_URL': '""',
            'import.meta.env.VITE_RECORDING_URL': '""',
            'import.meta.env.VITE_SIGNALING_URL': '""',
        } : {}),
    },
}));
