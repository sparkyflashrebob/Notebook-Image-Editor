import React, { useRef, useState, useEffect } from 'react';
import { ZoomIn, ZoomOut, Trash2, Brush, Square, Check, X, RefreshCw, Pipette } from 'lucide-react';

export default function CanvasEditor({
    originalPageImage,
    boxes = [],
    setBoxes,
    brushStrokes = [],
    setBrushStrokes,
    activeTool,
    brushSize,
    colorMode,
    customColor,
    setCustomColor,
    scale,
    setScale,
}) {
    const canvasRef = useRef(null);
    const containerRef = useRef(null);

    // View States
    const [pageImage, setPageImage] = useState(null);

    // Drawing mouse states
    const [isDrawing, setIsDrawing] = useState(false);
    const [startPos, setStartPos] = useState({ x: 0, y: 0 });
    const [currentPos, setCurrentPos] = useState({ x: 0, y: 0 });

    const [activeBoxId, setActiveBoxId] = useState(null);
    const [isDraggingBox, setIsDraggingBox] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    // Load the page image
    useEffect(() => {
        if (!originalPageImage) return;

        const img = new Image();
        img.src = originalPageImage;
        img.onload = () => {
            setPageImage(img);
            // Auto-fit to container width
            if (containerRef.current) {
                const containerWidth = containerRef.current.clientWidth - 32;
                const fitScale = containerWidth / img.width;
                setScale(Math.min(1.5, Math.max(0.5, fitScale)));
            }
        };
    }, [originalPageImage]);

    // Handle Ctrl + MouseWheel zoom behavior
    useEffect(() => {
        const handleWheel = (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                setScale(prev => {
                    const nextScale = e.deltaY < 0 ? prev + 0.15 : prev - 0.15;
                    return Math.min(3, Math.max(0.4, nextScale));
                });
            }
        };

        const container = containerRef.current;
        if (container) {
            container.addEventListener('wheel', handleWheel, { passive: false });
        }
        return () => {
            if (container) {
                container.removeEventListener('wheel', handleWheel);
            }
        };
    }, []);

    // Main canvas render loop
    useEffect(() => {
        if (!canvasRef.current || !pageImage) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        // Set size based on scale
        canvas.width = pageImage.width;
        canvas.height = pageImage.height;

        // Draw original image
        ctx.drawImage(pageImage, 0, 0);

        // Apply smart-fills for boxes
        boxes.forEach(box => {
            let fillColor = box.color;
            if (!fillColor) {
                // If box color is not stored, sample it from borders
                fillColor = getDominantBorderColor(ctx, box.x, box.y, box.w, box.h);
                box.color = fillColor; // Cache it
            }
            ctx.fillStyle = fillColor;
            ctx.fillRect(box.x, box.y, box.w, box.h);
        });

        // Draw manual brush strokes
        brushStrokes.forEach(stroke => {
            if (stroke.points.length < 2) return;
            ctx.beginPath();
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = stroke.size;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
            for (let i = 1; i < stroke.points.length; i++) {
                ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
            }
            ctx.stroke();
        });

        // Draw active drawing overlays (e.g. temporary box)
        if (isDrawing && activeTool === 'box') {
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 3;
            ctx.setLineDash([6, 6]);

            const x = Math.min(startPos.x, currentPos.x);
            const y = Math.min(startPos.y, currentPos.y);
            const w = Math.abs(startPos.x - currentPos.x);
            const h = Math.abs(startPos.y - currentPos.y);

            ctx.strokeRect(x, y, w, h);
            ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
            ctx.fillRect(x, y, w, h);
            ctx.setLineDash([]);
        }

        // Draw temporary brush stroke in progress
        if (isDrawing && activeTool === 'brush' && currentPos.points) {
            const stroke = currentPos;
            if (stroke.points.length >= 2) {
                ctx.beginPath();
                ctx.strokeStyle = stroke.color;
                ctx.lineWidth = stroke.size;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
                for (let i = 1; i < stroke.points.length; i++) {
                    ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
                }
                ctx.stroke();
            }
        }
    }, [pageImage, boxes, brushStrokes, isDrawing, startPos, currentPos, activeTool, colorMode, customColor, brushSize]);

    // Helper: Sample pixels around a rectangle to get dominant/average color
    const getDominantBorderColor = (ctx, x, y, w, h) => {
        const canvasWidth = ctx.canvas.width;
        const canvasHeight = ctx.canvas.height;
        const borderOffset = 8; // px outside boundary to stay clear of anti-aliasing
        const samplePoints = [];

        // Safe boundaries
        const startX = Math.max(0, x - borderOffset);
        const endX = Math.min(canvasWidth - 1, x + w + borderOffset);
        const startY = Math.max(0, y - borderOffset);
        const endY = Math.min(canvasHeight - 1, y + h + borderOffset);

        // Left and Right columns
        for (let sy = startY; sy <= endY; sy += Math.max(1, Math.round(h / 15))) {
            samplePoints.push({ x: startX, y: sy });
            samplePoints.push({ x: endX, y: sy });
        }
        // Top and Bottom rows
        for (let sx = startX; sx <= endX; sx += Math.max(1, Math.round(w / 15))) {
            samplePoints.push({ x: sx, y: startY });
            samplePoints.push({ x: sx, y: endY });
        }

        if (samplePoints.length === 0) return '#ffffff';

        const pValues = [];
        samplePoints.forEach(p => {
            try {
                const px = ctx.getImageData(p.x, p.y, 1, 1).data;
                // Skip transparent
                if (px[3] > 0) {
                    const r = px[0];
                    const g = px[1];
                    const b = px[2];
                    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                    pValues.push({ r, g, b, lum });
                }
            } catch (e) {
                // Guard against security / off-canvas coordinates
            }
        });

        if (pValues.length === 0) return '#ffffff';

        // Sort by luminance
        pValues.sort((a, b) => a.lum - b.lum);

        // Find average luminance to decide if page/region is light or dark
        const avgLum = pValues.reduce((sum, pv) => sum + pv.lum, 0) / pValues.length;

        // For light backgrounds (avg > 128), we use the 75th percentile to discard dark text/line outlines.
        // For dark backgrounds (avg <= 128), we use the 25th percentile to discard bright text/line outlines.
        const targetIndex = avgLum > 128
            ? Math.floor(pValues.length * 0.75)
            : Math.floor(pValues.length * 0.25);

        const bestColor = pValues[targetIndex];
        return `rgb(${bestColor.r}, ${bestColor.g}, ${bestColor.b})`;
    };

    // Convert mouse event coordinates to Canvas coordinates
    const getCanvasCoords = (e) => {
        if (!canvasRef.current) return { x: 0, y: 0 };
        const rect = canvasRef.current.getBoundingClientRect();

        // Calculate click coordinates in terms of client bounding rect
        const clientX = e.clientX - rect.left;
        const clientY = e.clientY - rect.top;

        // Scale up to render resolution of the canvas
        const x = (clientX / rect.width) * canvasRef.current.width;
        const y = (clientY / rect.height) * canvasRef.current.height;

        return { x: Math.round(x), y: Math.round(y) };
    };

    const handleMouseDown = (e) => {
        if (!pageImage) return;

        const coords = getCanvasCoords(e);

        if (activeTool === 'box') {
            // Check if clicking inside an existing box (for dragging/deleting)
            const clickedBox = [...boxes].reverse().find(box =>
                coords.x >= box.x && coords.x <= box.x + box.w &&
                coords.y >= box.y && coords.y <= box.y + box.h
            );

            if (clickedBox && !isDrawing) {
                setActiveBoxId(clickedBox.id);
                setIsDraggingBox(true);
                setDragOffset({
                    x: coords.x - clickedBox.x,
                    y: coords.y - clickedBox.y
                });
                return;
            }

            // Otherwise, start drawing a new box
            setIsDrawing(true);
            setStartPos(coords);
            setCurrentPos(coords);
            setActiveBoxId(null);
        } else if (activeTool === 'brush') {
            setIsDrawing(true);

            // Smart Sampler Color Logic:
            let strokeColor = customColor;
            if (colorMode === 'auto') {
                const canvas = canvasRef.current;
                const ctx = canvas.getContext('2d');
                try {
                    // Sample the pixel exactly under click coordinate
                    const px = ctx.getImageData(coords.x, coords.y, 1, 1).data;
                    strokeColor = `rgb(${px[0]}, ${px[1]}, ${px[2]})`;
                } catch (err) {
                    strokeColor = '#ffffff';
                }
            }

            setCurrentPos({
                color: strokeColor,
                size: brushSize,
                points: [coords]
            });
        }
    };

    const handleMouseMove = (e) => {
        if (!isDrawing && !isDraggingBox) return;

        const coords = getCanvasCoords(e);

        if (isDraggingBox && activeBoxId) {
            setBoxes(prev => prev.map(box => {
                if (box.id === activeBoxId) {
                    // Clamp dragging to canvas boundaries
                    const newX = Math.max(0, Math.min(canvasRef.current.width - box.w, coords.x - dragOffset.x));
                    const newY = Math.max(0, Math.min(canvasRef.current.height - box.h, coords.y - dragOffset.y));
                    return { ...box, x: newX, y: newY, color: null }; // Color will recalculate on redraw
                }
                return box;
            }));
        } else if (isDrawing) {
            if (activeTool === 'box') {
                setCurrentPos(coords);
            } else if (activeTool === 'brush') {
                setCurrentPos(prev => {
                    const updatedPoints = [...prev.points, coords];
                    return {
                        ...prev,
                        points: updatedPoints
                    };
                });
            }
        }
    };

    const handleMouseUp = () => {
        if (isDraggingBox) {
            setIsDraggingBox(false);
            return;
        }

        if (!isDrawing) return;
        setIsDrawing(false);

        if (activeTool === 'box') {
            const x = Math.min(startPos.x, currentPos.x);
            const y = Math.min(startPos.y, currentPos.y);
            const w = Math.abs(startPos.x - currentPos.x);
            const h = Math.abs(startPos.y - currentPos.y);

            // Only add non-trivial boxes
            if (w > 5 && h > 5) {
                const newBox = {
                    id: Date.now().toString(),
                    x,
                    y,
                    w,
                    h,
                    color: null // Automatically sampled
                };
                setBoxes(prev => [...prev, newBox]);
            }
        } else if (activeTool === 'brush' && currentPos.points?.length > 1) {
            setBrushStrokes(prev => [...prev, currentPos]);
        }
    };

    const deleteBox = (id) => {
        setBoxes(prev => prev.filter(b => b.id !== id));
        if (activeBoxId === id) setActiveBoxId(null);
    };

    return (
        <div className="flex flex-col h-full select-none">

            {/* Editor Canvas Main Container */}
            <div
                ref={containerRef}
                className="flex-1 bg-zinc-950/70 border border-zinc-800 rounded-xl overflow-auto flex items-center justify-center p-4 min-h-[480px] max-h-[70vh] relative"
                style={{ cursor: activeTool === 'box' ? 'crosshair' : 'default' }}
            >
                {!originalPageImage ? (
                    <div className="text-zinc-500 text-sm flex flex-col items-center gap-2">
                        <Square size={28} className="text-zinc-600 animate-pulse" />
                        No page loaded. Please upload a document or image.
                    </div>
                ) : (
                    <div
                        className="relative shadow-2xl transition-all"
                        style={{
                            width: pageImage ? `${pageImage.width * scale}px` : 'auto',
                            height: pageImage ? `${pageImage.height * scale}px` : 'auto',
                            transition: 'width 0.1s ease-out, height 0.1s ease-out',
                            margin: 'auto'
                        }}
                    >
                        <canvas
                            ref={canvasRef}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            style={{
                                width: '100%',
                                height: '100%',
                            }}
                            className="block rounded bg-white shadow-lg overflow-hidden border border-zinc-800"
                        />

                        {/* DOM overlays for bounding boxes to delete/interact them */}
                        {activeTool === 'box' && boxes.map(box => {
                            if (!canvasRef.current) return null;

                            const cWidth = canvasRef.current.width;
                            const cHeight = canvasRef.current.height;

                            const leftPercent = (box.x / cWidth) * 100;
                            const topPercent = (box.y / cHeight) * 100;
                            const widthPercent = (box.w / cWidth) * 100;
                            const heightPercent = (box.h / cHeight) * 100;

                            const isActive = activeBoxId === box.id;

                            return (
                                <div
                                    key={box.id}
                                    className={`absolute group pointer-events-auto border transition ${isActive ? 'border-blue-500 bg-blue-500/10' : 'border-zinc-500/40 bg-zinc-500/5 hover:border-blue-400 hover:bg-blue-400/5'
                                        }`}
                                    style={{
                                        left: `${leftPercent}%`,
                                        top: `${topPercent}%`,
                                        width: `${widthPercent}%`,
                                        height: `${heightPercent}%`,
                                        cursor: 'move',
                                    }}
                                    onMouseDown={(e) => {
                                        e.stopPropagation();
                                        const coords = getCanvasCoords(e);
                                        setActiveBoxId(box.id);
                                        setIsDraggingBox(true);
                                        setDragOffset({
                                            x: coords.x - box.x,
                                            y: coords.y - box.y
                                        });
                                    }}
                                >
                                    {/* Delete button on top right of the box */}
                                    <button
                                        className="absolute -top-3.5 -right-3.5 hidden group-hover:flex items-center justify-center p-1 bg-red-600 hover:bg-red-500 text-white rounded-full shadow-lg border border-red-500 transition pointer-events-auto"
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            deleteBox(box.id);
                                        }}
                                        title="Remove Logo Box"
                                    >
                                        <X size={10} strokeWidth={3} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
