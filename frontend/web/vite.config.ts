import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        host: '0.0.0.0',
        allowedHosts: true,
        proxy: {
            '/api/auth': { target: 'http://localhost:4002', changeOrigin: true },
            '/api/meetings': { target: 'http://localhost:4003', changeOrigin: true },
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
    },
});
