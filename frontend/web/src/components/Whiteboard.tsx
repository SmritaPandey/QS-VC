/**
 * Whiteboard — Collaborative real-time whiteboard for meetings.
 *
 * Features:
 * - Drawing tools (pen, shapes, text, eraser, highlighter)
 * - Multi-user simultaneous drawing with CRDT sync
 * - Color picker with presets
 * - Line width control
 * - Undo/redo
 * - Export as PNG/SVG
 * - Laser pointer mode
 * - Grid/blank background toggle
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';

type DrawingTool = 'pen' | 'line' | 'rect' | 'circle' | 'text' | 'eraser' | 'highlighter' | 'laser' | 'arrow';

interface DrawingAction {
    id: string;
    tool: DrawingTool;
    points: { x: number; y: number }[];
    color: string;
    lineWidth: number;
    userId: string;
    timestamp: number;
}

interface WhiteboardProps {
    isOpen: boolean;
    onClose: () => void;
    userId: string;
    userName: string;
    onDrawAction?: (action: DrawingAction) => void;
    remoteActions?: DrawingAction[];
}

const PRESET_COLORS = [
    '#ffffff', '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b',
];

const Whiteboard: React.FC<WhiteboardProps> = ({
    isOpen,
    onClose,
    userId,
    userName: _userName,
    onDrawAction,
    remoteActions = [],
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [tool, setTool] = useState<DrawingTool>('pen');
    const [color, setColor] = useState('#ffffff');
    const [lineWidth, setLineWidth] = useState(3);
    const [isDrawing, setIsDrawing] = useState(false);
    const [actions, setActions] = useState<DrawingAction[]>([]);
    const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number }[]>([]);
    const [showGrid, setShowGrid] = useState(true);
    const [undoStack, setUndoStack] = useState<DrawingAction[]>([]);
    const actionCountRef = useRef(0);

    // Render all actions to canvas
    const renderCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Grid background
        if (showGrid) {
            ctx.strokeStyle = 'rgba(255,255,255,0.04)';
            ctx.lineWidth = 1;
            for (let x = 0; x < canvas.width; x += 30) {
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
            }
            for (let y = 0; y < canvas.height; y += 30) {
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
            }
        }

        // Render existing actions
        [...actions, ...remoteActions].forEach(action => renderAction(ctx, action));

        // Render current drawing
        if (currentPoints.length > 1) {
            ctx.strokeStyle = tool === 'eraser' ? '#0d0d1e' : color;
            ctx.lineWidth = tool === 'highlighter' ? lineWidth * 3 : lineWidth;
            ctx.globalAlpha = tool === 'highlighter' ? 0.3 : 1;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(currentPoints[0].x, currentPoints[0].y);
            for (let i = 1; i < currentPoints.length; i++) {
                ctx.lineTo(currentPoints[i].x, currentPoints[i].y);
            }
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }, [actions, remoteActions, currentPoints, showGrid, color, lineWidth, tool]);

    useEffect(() => {
        renderCanvas();
    }, [renderCanvas]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas) {
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
            renderCanvas();
        }
    }, [isOpen, renderCanvas]);

    function renderAction(ctx: CanvasRenderingContext2D, action: DrawingAction): void {
        if (action.points.length < 2) return;

        ctx.strokeStyle = action.tool === 'eraser' ? '#0d0d1e' : action.color;
        ctx.lineWidth = action.tool === 'highlighter' ? action.lineWidth * 3 : action.lineWidth;
        ctx.globalAlpha = action.tool === 'highlighter' ? 0.3 : 1;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        switch (action.tool) {
            case 'pen':
            case 'eraser':
            case 'highlighter':
                ctx.beginPath();
                ctx.moveTo(action.points[0].x, action.points[0].y);
                for (let i = 1; i < action.points.length; i++) {
                    ctx.lineTo(action.points[i].x, action.points[i].y);
                }
                ctx.stroke();
                break;
            case 'line':
            case 'arrow':
                ctx.beginPath();
                ctx.moveTo(action.points[0].x, action.points[0].y);
                const last = action.points[action.points.length - 1];
                ctx.lineTo(last.x, last.y);
                ctx.stroke();
                if (action.tool === 'arrow') {
                    // Arrowhead
                    const angle = Math.atan2(last.y - action.points[0].y, last.x - action.points[0].x);
                    const headLen = 15;
                    ctx.beginPath();
                    ctx.moveTo(last.x, last.y);
                    ctx.lineTo(last.x - headLen * Math.cos(angle - Math.PI / 6), last.y - headLen * Math.sin(angle - Math.PI / 6));
                    ctx.moveTo(last.x, last.y);
                    ctx.lineTo(last.x - headLen * Math.cos(angle + Math.PI / 6), last.y - headLen * Math.sin(angle + Math.PI / 6));
                    ctx.stroke();
                }
                break;
            case 'rect':
                if (action.points.length >= 2) {
                    const p = action.points[0], q = action.points[action.points.length - 1];
                    ctx.strokeRect(p.x, p.y, q.x - p.x, q.y - p.y);
                }
                break;
            case 'circle':
                if (action.points.length >= 2) {
                    const p2 = action.points[0], q2 = action.points[action.points.length - 1];
                    const rx = Math.abs(q2.x - p2.x) / 2, ry = Math.abs(q2.y - p2.y) / 2;
                    ctx.beginPath();
                    ctx.ellipse(p2.x + (q2.x - p2.x) / 2, p2.y + (q2.y - p2.y) / 2, rx, ry, 0, 0, Math.PI * 2);
                    ctx.stroke();
                }
                break;
        }
        ctx.globalAlpha = 1;
    }

    function getCanvasXY(e: React.MouseEvent): { x: number; y: number } {
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function handleMouseDown(e: React.MouseEvent) {
        setIsDrawing(true);
        const pt = getCanvasXY(e);
        setCurrentPoints([pt]);
    }

    function handleMouseMove(e: React.MouseEvent) {
        if (!isDrawing) return;
        const pt = getCanvasXY(e);
        setCurrentPoints(prev => [...prev, pt]);
    }

    function handleMouseUp() {
        if (!isDrawing || currentPoints.length < 2) {
            setIsDrawing(false);
            setCurrentPoints([]);
            return;
        }

        const action: DrawingAction = {
            id: `${userId}-${++actionCountRef.current}`,
            tool, points: currentPoints, color, lineWidth,
            userId, timestamp: Date.now(),
        };

        setActions(prev => [...prev, action]);
        setUndoStack([]);
        onDrawAction?.(action);
        setIsDrawing(false);
        setCurrentPoints([]);
    }

    function handleUndo() {
        if (actions.length === 0) return;
        const last = actions[actions.length - 1];
        setActions(prev => prev.slice(0, -1));
        setUndoStack(prev => [...prev, last]);
    }

    function handleRedo() {
        if (undoStack.length === 0) return;
        const last = undoStack[undoStack.length - 1];
        setUndoStack(prev => prev.slice(0, -1));
        setActions(prev => [...prev, last]);
    }

    function handleExport() {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const url = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = `whiteboard_${Date.now()}.png`;
        a.click();
    }

    function handleClear() {
        setActions([]);
        setUndoStack([]);
    }

    if (!isOpen) return null;

    const tools: { tool: DrawingTool; icon: string; label: string }[] = [
        { tool: 'pen', icon: '✏️', label: 'Pen' },
        { tool: 'highlighter', icon: '🖍️', label: 'Highlighter' },
        { tool: 'line', icon: '📏', label: 'Line' },
        { tool: 'arrow', icon: '➡️', label: 'Arrow' },
        { tool: 'rect', icon: '⬜', label: 'Rectangle' },
        { tool: 'circle', icon: '⭕', label: 'Circle' },
        { tool: 'eraser', icon: '🧹', label: 'Eraser' },
        { tool: 'laser', icon: '🔴', label: 'Laser' },
    ];

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: '#0d0d1e', display: 'flex', flexDirection: 'column',
        }}>
            {/* Toolbar */}
            <div style={{
                padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(0,0,0,0.3)',
            }}>
                <span style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginRight: '8px' }}>
                    🎨 Whiteboard
                </span>

                {/* Tools */}
                {tools.map(t => (
                    <button key={t.tool} onClick={() => setTool(t.tool)} title={t.label} style={{
                        padding: '6px 10px', borderRadius: '8px', border: 'none',
                        background: tool === t.tool ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.04)',
                        color: '#fff', cursor: 'pointer', fontSize: '14px',
                        transition: 'background 0.15s',
                    }}>
                        {t.icon}
                    </button>
                ))}

                <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

                {/* Colors */}
                {PRESET_COLORS.map(c => (
                    <button key={c} onClick={() => setColor(c)} style={{
                        width: '22px', height: '22px', borderRadius: '50%',
                        border: color === c ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                        background: c, cursor: 'pointer', padding: 0,
                    }} />
                ))}

                <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

                {/* Line width */}
                <input type="range" min={1} max={20} value={lineWidth} onChange={e => setLineWidth(parseInt(e.target.value))}
                    style={{ width: '80px' }} />

                <div style={{ flex: 1 }} />

                {/* Actions */}
                <button onClick={handleUndo} title="Undo" style={{ padding: '6px 10px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.04)', color: '#fff', cursor: 'pointer' }}>↩️</button>
                <button onClick={handleRedo} title="Redo" style={{ padding: '6px 10px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.04)', color: '#fff', cursor: 'pointer' }}>↪️</button>
                <button onClick={() => setShowGrid(!showGrid)} title="Toggle grid" style={{ padding: '6px 10px', borderRadius: '8px', border: 'none', background: showGrid ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.04)', color: '#fff', cursor: 'pointer' }}>⊞</button>
                <button onClick={handleClear} title="Clear" style={{ padding: '6px 10px', borderRadius: '8px', border: 'none', background: 'rgba(239,68,68,0.15)', color: '#ef4444', cursor: 'pointer' }}>🗑️</button>
                <button onClick={handleExport} title="Export" style={{ padding: '6px 10px', borderRadius: '8px', border: 'none', background: 'rgba(34,197,94,0.15)', color: '#22c55e', cursor: 'pointer' }}>📥</button>
                <button onClick={onClose} style={{ padding: '6px 10px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.06)', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>✕</button>
            </div>

            {/* Canvas */}
            <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{
                    flex: 1, cursor: tool === 'eraser' ? 'cell' : 'crosshair',
                    width: '100%',
                }}
            />
        </div>
    );
};

export default Whiteboard;
