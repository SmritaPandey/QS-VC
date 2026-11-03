import { createRecordingApp } from './app.js';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config({ path: '../../.env' });

const logger = pino({
    transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    level: process.env.LOG_LEVEL || 'info',
    name: 'qsvc-recording',
});

// Cloud recording is available only when private storage is configured.
const app = createRecordingApp();
const PORT = parseInt(process.env.RECORDING_PORT || '4004', 10);
const server = app.listen(PORT, () => {
    logger.info(`QS-VC Recording Service running on port ${PORT}; cloud storage ${process.env.RECORDING_BUCKET ? 'configured' : 'not configured'}`);
});

function shutdown() {
    server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
