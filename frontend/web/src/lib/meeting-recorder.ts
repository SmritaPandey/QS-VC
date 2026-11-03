/**
 * Records the meeting itself — not a screen pick like screen sharing.
 *
 * Video: the meeting tiles as they appear on screen (camera, shared screen, or the
 * initials of people with their camera off), redrawn onto a 1280×720 canvas.
 * Audio: your microphone mixed with every participant's audio; people who join
 * while recording are added automatically.
 */

export interface MeetingComposite {
    stream: MediaStream;
    stop: () => void;
}

const W = 1280, H = 720, FPS = 25, GAP = 8, PAD = 12;

function layout(count: number) {
    const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
    const rows = Math.ceil(count / cols);
    const w = (W - PAD * 2 - GAP * (cols - 1)) / cols;
    const h = (H - PAD * 2 - GAP * (rows - 1)) / rows;
    return { cols, w, h };
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}

/** Draw a video into a box like CSS object-fit (cover for cameras, contain for shared screens). */
function drawVideo(g: CanvasRenderingContext2D, v: HTMLVideoElement, x: number, y: number, w: number, h: number, contain: boolean) {
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return false;
    const s = contain ? Math.min(w / vw, h / vh) : Math.max(w / vw, h / vh);
    const dw = vw * s, dh = vh * s;
    g.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    return true;
}

export function createMeetingComposite(
    tilesRoot: () => HTMLElement | null,
    audioTracks: () => MediaStreamTrack[],
    caption: string,
): MeetingComposite {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;

    const draw = () => {
        g.fillStyle = '#0b1420';
        g.fillRect(0, 0, W, H);
        const tiles = Array.from(tilesRoot()?.querySelectorAll<HTMLElement>('.video-tile') ?? []).filter(tile => tile.getClientRects().length > 0);
        const { cols, w, h } = layout(Math.max(1, tiles.length));
        tiles.forEach((tile, i) => {
            const x = PAD + (i % cols) * (w + GAP), y = PAD + Math.floor(i / cols) * (h + GAP);
            g.save();
            roundRect(g, x, y, w, h, 10);
            g.clip();
            g.fillStyle = '#162331';
            g.fillRect(x, y, w, h);
            const video = tile.querySelector<HTMLVideoElement>('video.tile-video');
            const showsVideo = !!video && !video.classList.contains('hidden') && !!video.srcObject;
            const drewVideo = showsVideo && drawVideo(g, video!, x, y, w, h, tile.classList.contains('is-sharing'));
            if (!drewVideo) {
                // Camera off: initials, as on screen.
                const initials = tile.querySelector('.avatar-glass-core')?.textContent?.trim() || '';
                const r = Math.min(w, h) * 0.16;
                g.fillStyle = '#203f4c';
                g.beginPath(); g.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2); g.fill();
                g.strokeStyle = 'rgba(67,217,194,.55)'; g.lineWidth = 2; g.stroke();
                g.fillStyle = '#edf5fa';
                g.font = `500 ${Math.round(r * 0.8)}px "IBM Plex Sans", Arial, sans-serif`;
                g.textAlign = 'center'; g.textBaseline = 'middle';
                g.fillText(initials, x + w / 2, y + h / 2);
            }
            // Name label
            const name = tile.querySelector('.tile-name')?.textContent?.trim() || '';
            if (name) {
                g.font = '13px "IBM Plex Sans", Arial, sans-serif';
                const tw = Math.min(g.measureText(name).width, w - 40);
                g.fillStyle = 'rgba(11,20,32,.85)';
                roundRect(g, x + 10, y + h - 34, tw + 20, 24, 6); g.fill();
                g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle';
                g.fillText(name, x + 20, y + h - 22, w - 40);
            }
            g.restore();
        });
        // Small identifying caption in the corner.
        g.font = '12px "IBM Plex Sans", Arial, sans-serif';
        g.fillStyle = 'rgba(237,245,250,.55)'; g.textAlign = 'right'; g.textBaseline = 'bottom';
        g.fillText(caption, W - PAD - 4, H - 2);
    };
    draw();
    const timer = window.setInterval(draw, 1000 / FPS);

    // Audio mix: everyone's audio into one track; re-checked every second for people joining.
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC();
    const dest = ac.createMediaStreamDestination();
    const connected = new Map<string, MediaStreamAudioSourceNode>();
    const syncAudio = () => {
        const live = audioTracks().filter((t) => t.readyState === 'live');
        for (const t of live) {
            if (connected.has(t.id)) continue;
            const node = ac.createMediaStreamSource(new MediaStream([t]));
            node.connect(dest);
            connected.set(t.id, node);
        }
        for (const [id, node] of connected) {
            if (!live.some((t) => t.id === id)) { node.disconnect(); connected.delete(id); }
        }
    };
    syncAudio();
    const audioTimer = window.setInterval(syncAudio, 1000);
    if (ac.state === 'suspended') ac.resume().catch(() => { });

    const videoTrack = canvas.captureStream(FPS).getVideoTracks()[0];
    const stream = new MediaStream([videoTrack, ...dest.stream.getAudioTracks()]);

    return {
        stream,
        stop: () => {
            window.clearInterval(timer);
            window.clearInterval(audioTimer);
            connected.forEach((n) => n.disconnect());
            connected.clear();
            videoTrack.stop();
            ac.close().catch(() => { });
        },
    };
}
