import express from 'express';
import cors from 'cors';

export function createRecordingApp() {
    const app = express();
    app.use(cors({
        origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'],
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        credentials: true,
    }));
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', service: 'qsvc-recording', recordingEnabled: false });
    });
    // Fail closed before reading uploads or contacting storage. No environment flag bypasses this.
    app.use('/api', (_req, res) => {
        res.status(403).json({
            code: 'RECORDING_DISABLED',
            error: 'Recording is disabled for this demo.',
        });
    });
    return app;
}
