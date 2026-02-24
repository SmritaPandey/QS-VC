import * as mediasoup from 'mediasoup';
import { types as msTypes } from 'mediasoup';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * WorkerManager: manages a pool of mediasoup Workers.
 * Allocates Workers round-robin for new Rooms (Routers).
 */
export class WorkerManager {
    private workers: msTypes.Worker[] = [];
    private nextWorkerIdx = 0;

    async init(): Promise<void> {
        const numWorkers = config.numWorkers;
        logger.info(`Creating ${numWorkers} mediasoup Workers...`);

        for (let i = 0; i < numWorkers; i++) {
            const worker = await mediasoup.createWorker({
                logLevel: config.worker.logLevel,
                logTags: config.worker.logTags,
                rtcMinPort: config.worker.rtcMinPort,
                rtcMaxPort: config.worker.rtcMaxPort,
            });

            worker.on('died', (error: Error) => {
                logger.error({ err: error }, `mediasoup Worker died [pid:${worker.pid}]`);
                // In production: restart worker, alert ops
                setTimeout(() => process.exit(1), 2000);
            });

            this.workers.push(worker);
            logger.info(`Worker ${i} created [pid:${worker.pid}]`);
        }
    }

    /**
     * Get the next Worker using round-robin allocation.
     */
    getNextWorker(): msTypes.Worker {
        if (this.workers.length === 0) {
            throw new Error('No mediasoup Workers available');
        }

        const worker = this.workers[this.nextWorkerIdx];
        this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length;
        return worker;
    }

    /**
     * Create a new Router on the least-loaded Worker.
     */
    async createRouter(): Promise<msTypes.Router> {
        const worker = this.getNextWorker();
        const router = await worker.createRouter({
            mediaCodecs: config.router.mediaCodecs,
        });

        logger.info(`Router created [id:${router.id}] on Worker [pid:${worker.pid}]`);
        return router;
    }

    /**
     * Get stats for all Workers.
     */
    async getStats(): Promise<Array<{ pid: number; usage: msTypes.WorkerResourceUsage }>> {
        const stats = await Promise.all(
            this.workers.map(async (worker) => ({
                pid: worker.pid,
                usage: await worker.getResourceUsage(),
            }))
        );
        return stats;
    }

    /**
     * Close all Workers gracefully.
     */
    async close(): Promise<void> {
        for (const worker of this.workers) {
            worker.close();
        }
        this.workers = [];
        logger.info('All mediasoup Workers closed');
    }
}
