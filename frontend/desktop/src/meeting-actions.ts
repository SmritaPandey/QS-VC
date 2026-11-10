/** Use the same authenticated host action as the web dashboard, without joining the room. */
export function changeHostedMeeting(options: {
    url: string; ticket: string; meetingCode: string; action: 'end' | 'cancel';
    signal: AbortSignal; isCurrent: () => boolean;
}): Promise<void> {
    return new Promise((resolve, reject) => {
        if (options.signal.aborted || !options.isCurrent()) { reject(new Error('Request expired')); return; }
        const socket = new WebSocket(options.url);
        let finished = false;
        let requested = false;
        const finish = (error?: Error) => {
            if (finished) return;
            finished = true;
            options.signal.removeEventListener('abort', aborted);
            socket.close();
            if (error) reject(error); else resolve();
        };
        const aborted = () => finish(new Error('Request timed out'));
        options.signal.addEventListener('abort', aborted, { once: true });
        socket.onopen = () => {
            if (finished) return;
            if (!options.isCurrent()) { finish(new Error('Session changed')); return; }
            try { socket.send(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'authenticate', params: { ticket: options.ticket } })); }
            catch { finish(new Error('Connection failed')); }
        };
        socket.onmessage = event => {
            if (finished) return;
            if (!options.isCurrent()) { finish(new Error('Session changed')); return; }
            try {
                const message = JSON.parse(String(event.data));
                if (message.id === 0) {
                    if (requested) return;
                    if (message.result?.authenticated !== true) { finish(new Error('Authentication failed')); return; }
                    requested = true;
                    socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'endHostedMeeting',
                        params: { meetingCode: options.meetingCode, action: options.action } }));
                } else if (message.id === 1) {
                    const acknowledged = options.action === 'end' ? message.result?.ended : message.result?.cancelled;
                    finish(requested && acknowledged === true && !message.error ? undefined : new Error('Meeting change was not confirmed'));
                }
            } catch { finish(new Error('Invalid meeting response')); }
        };
        socket.onerror = () => finish(new Error('Connection failed'));
        socket.onclose = () => finish(new Error('Connection closed before confirmation'));
    });
}
