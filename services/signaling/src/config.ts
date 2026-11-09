import { serviceSecret } from '../../../shared/service-secrets.cjs';
import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });
for (const name of ['INTERNAL_AUTH_SECRET', 'MEETING_POLICY_SECRET', 'INVITATION_SECRET', 'TURN_ACCESS_SECRET'] as const) serviceSecret(name);

export const config = {
    port: parseInt(process.env.PORT || process.env.SIGNALING_PORT || '4001', 10),
    sfuUrl: process.env.SFU_INTERNAL_URL || 'http://localhost:4000',

    iceServers: [
        { urls: process.env.STUN_SERVERS?.split(',').filter(Boolean) || [] },
        ...(process.env.TURN_SERVERS && process.env.TURN_USERNAME && process.env.TURN_PASSWORD
            ? [{ urls: process.env.TURN_SERVERS.split(','), username: process.env.TURN_USERNAME, credential: process.env.TURN_PASSWORD }]
            : []),
    ],
    mcuEnabled: process.env.MCU_ENABLED === 'true',
    mcuUrl: process.env.MCU_INTERNAL_URL || 'http://localhost:4005',
    hybridMode: process.env.HYBRID_MODE === 'true',

    // Redis — supports REDIS_URL (Render) or individual env vars (local)
    redisUrl: process.env.REDIS_URL || undefined,
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
    },

};
