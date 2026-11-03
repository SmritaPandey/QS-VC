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

// Recording stays disabled until server-side authorization and retention are implemented.
const app = createRecordingApp();
const PORT = parseInt(process.env.RECORDING_PORT || '4004', 10);
const server = app.listen(PORT, () => {
    logger.info(`QS-VC Recording Service running on port ${PORT}; recording disabled for demo`);
});

function shutdown() {
    server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
