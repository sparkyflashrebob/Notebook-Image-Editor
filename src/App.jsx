import React, { useState, useEffect, useRef } from 'react';
import {
  FileText, Upload, Key, Eye, EyeOff, ShieldAlert, Sparkles,
  ChevronLeft, ChevronRight, Download, RefreshCw, Layers, X,
  FolderOpen, Settings, Square, Brush, ZoomIn, ZoomOut, Trash2
} from 'lucide-react';
import { loadPdfDoc, renderPdfPageToCanvas, rebuildPdf } from './utils/pdf';
import { detectLogosWithGemini } from './utils/gemini';
import CanvasEditor from './components/CanvasEditor';

export default function App() {
  // App States
  const [pdfFile, setPdfFile] = useState(null);
  const [originalBuffer, setOriginalBuffer] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1); // 1-based index
  const [exportFileName, setExportFileName] = useState('');

  // Page rendering caches
  // pageIndex (0-based) -> { dataUrl, width, height }
  const [renderedPages, setRenderedPages] = useState({});

  // Edits pageIndex (0-based) -> Array of boxes
  const [pageBoxes, setPageBoxes] = useState({});
  const [pageBrushStrokes, setPageBrushStrokes] = useState({});

  // API Key & Model
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-2.0-flash');

  // Loaders
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Hoisted Canvas Editor States
  const [scale, setScale] = useState(1);
  const [activeTool, setActiveTool] = useState('box'); // 'box' or 'brush'
  const [brushSize, setBrushSize] = useState(25);
  const [colorMode, setColorMode] = useState('auto'); // 'auto' or 'custom'
  const [customColor, setCustomColor] = useState('#ffffff');
  const [showSettings, setShowSettings] = useState(false); // Collapsible Gemini settings wheel

  const handleZoom = (direction) => {
    setScale(prev => {
      const nextScale = direction === 'in' ? prev + 0.15 : prev - 0.15;
      return Math.min(3, Math.max(0.4, nextScale));
    });
  };

  // Save API Key to localStorage when updated
  useEffect(() => {
    localStorage.setItem('gemini_api_key', apiKey);
  }, [apiKey]);

  // Handle file select
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileType = file.type;
    const isImage = fileType.startsWith('image/');
    const isPdf = fileType === 'application/pdf';

    if (!isImage && !isPdf) {
      setErrorMessage('Please select a valid PDF file or image (PNG, JPEG, WEBP).');
      return;
    }

    setIsLoadingPdf(true);
    setErrorMessage('');
    setStatusMessage(`Loading ${isImage ? 'image' : 'PDF document'}...`);
    setRenderedPages({});
    setPageBoxes({});
    setPageBrushStrokes({});

    if (isImage) {
      try {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const dataUrl = event.target.result;
          try {
            const img = await new Promise((resolve, reject) => {
              const i = new Image();
              i.src = dataUrl;
              i.onload = () => resolve(i);
              i.onerror = () => reject(new Error('Failed to load image file dimensions.'));
            });

            setPdfFile(file);
            setPdfDoc(null);
            setNumPages(1);
            setCurrentPage(1);
            setExportFileName(file.name.replace(/\.[^/.]+$/, "") + "_cleaned");
            setRenderedPages({
              0: {
                dataUrl: dataUrl,
                width: img.width,
                height: img.height
              }
            });
            setOriginalBuffer(dataUrl);
            setIsLoadingPdf(false);
            setStatusMessage('');
          } catch (err) {
            console.error(err);
            setErrorMessage(`Failed to parse image: ${err.message}`);
            setIsLoadingPdf(false);
          }
        };
        reader.readAsDataURL(file);
      } catch (err) {
        console.error(err);
        setErrorMessage('Error reading image file.');
        setIsLoadingPdf(false);
      }
    } else {
      // PDF Flow
      try {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const buffer = event.target.result;
          setOriginalBuffer(buffer);

          try {
            const doc = await loadPdfDoc(buffer);
            setPdfDoc(doc);
            setNumPages(doc.numPages);
            setCurrentPage(1);
            setPdfFile(file);
            setExportFileName(file.name.replace('.pdf', '_cleaned.pdf'));

            // Pre-render first page
            await renderPageImage(doc, 1);
            setIsLoadingPdf(false);
            setStatusMessage('');
          } catch (err) {
            console.error(err);
            setErrorMessage('Failed to parse PDF document. It might be corrupt or encrypted.');
            setIsLoadingPdf(false);
          }
        };
        reader.readAsArrayBuffer(file);
      } catch (err) {
        console.error(err);
        setErrorMessage('Error reading PDF file.');
        setIsLoadingPdf(false);
      }
    }
  };

  // Helper to render a page to a canvas and save the image data URL
  const renderPageImage = async (doc, pageNum) => {
    const pageIdx = pageNum - 1;
    if (renderedPages[pageIdx]) return renderedPages[pageIdx];

    setStatusMessage(`Rendering Page ${pageNum}...`);
    const tempCanvas = document.createElement('canvas');
    try {
      const size = await renderPdfPageToCanvas(doc, pageNum, tempCanvas, 1.5);
      const dataUrl = tempCanvas.toDataURL('image/png');

      const newPageData = { dataUrl, width: size.width, height: size.height };
      setRenderedPages(prev => ({
        ...prev,
        [pageIdx]: newPageData
      }));
      setStatusMessage('');
      return newPageData;
    } catch (err) {
      console.error(err);
      setErrorMessage(`Failed to render page ${pageNum}.`);
      throw err;
    }
  };

  // Render trigger on page change
  useEffect(() => {
    if (!pdfDoc) return;
    renderPageImage(pdfDoc, currentPage).catch(() => { });
  }, [currentPage, pdfDoc]);

  // Navigate pages
  const handlePrevPage = () => {
    if (currentPage > 1) setCurrentPage(p => p - 1);
  };

  const handleNextPage = () => {
    if (currentPage < numPages) setCurrentPage(p => p + 1);
  };

  // API Call: Auto Detect logos on current page
  const handleAutoDetect = async () => {
    const pageIdx = currentPage - 1;
    const pageData = renderedPages[pageIdx];
    if (!pageData) {
      setErrorMessage('Page image is not loaded yet.');
      return;
    }

    if (!apiKey) {
      setErrorMessage('Please enter your Gemini API key in the sidebar.');
      return;
    }

    setIsDetecting(true);
    setErrorMessage('');

    try {
      const detected = await detectLogosWithGemini(pageData.dataUrl, apiKey, selectedModel);

      if (!detected || detected.length === 0) {
        setStatusMessage('Gemini did not detect any logos on this page.');
        setTimeout(() => setStatusMessage(''), 4000);
        setIsDetecting(false);
        return;
      }

      // We need to map relative 0-1000 coordinates to actual page resolution width/height
      // box_2d coordinates are [ymin, xmin, ymax, xmax] relative to 0-1000
      const canvasWidth = pageData.width * 1.5; // match our rendering scale coefficient (1.5)
      const canvasHeight = pageData.height * 1.5;

      const newBoxes = detected.map((logo, index) => {
        const [ymin, xmin, ymax, xmax] = logo.box_2d;

        // Calculate canvas points
        const x = (xmin / 1000) * canvasWidth;
        const y = (ymin / 1000) * canvasHeight;
        const w = ((xmax - xmin) / 1000) * canvasWidth;
        const h = ((ymax - ymin) / 1000) * canvasHeight;

        return {
          id: `gemini-${Date.now()}-${index}`,
          x: Math.round(x),
          y: Math.round(y),
          w: Math.round(w),
          h: Math.round(h),
          color: null // will auto sample
        };
      });

      setPageBoxes(prev => ({
        ...prev,
        [pageIdx]: [...(prev[pageIdx] || []), ...newBoxes]
      }));

      setStatusMessage(`Gemini auto-detected ${detected.length} logo regions!`);
      setTimeout(() => setStatusMessage(''), 4000);
    } catch (err) {
      console.error(err);
      setErrorMessage(`Gemini detection failed: ${err.message || err}`);
    } finally {
      setIsDetecting(false);
    }
  };

  const triggerStandardDownload = (blob, fileName) => {
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
    setStatusMessage('Download started successfully!');
  };

  // Rebuild the final PDF or Image
  const handleExportPdf = async () => {
    if (!originalBuffer) return;

    setIsRebuilding(true);
    setErrorMessage('');
    setStatusMessage('Rebuilding output file...');

    try {
      const isImage = pdfFile.type.startsWith('image/');
      const editedDocMap = {};

      // Determine which pages need processing
      const pagesToProcess = isImage
        ? [0]
        : Object.keys(pageBoxes).filter(idx => (pageBoxes[idx] && pageBoxes[idx].length > 0) || (pageBrushStrokes[idx] && pageBrushStrokes[idx].length > 0));

      for (const idxStr of pagesToProcess) {
        const idx = parseInt(idxStr);
        const originalImageSrc = renderedPages[idx]?.dataUrl;
        const boxes = pageBoxes[idx] || [];
        const strokes = pageBrushStrokes[idx] || [];

        if (!originalImageSrc) continue;

        // Render everything onto a temporary canvas
        const img = await new Promise((resolve) => {
          const i = new Image();
          i.src = originalImageSrc;
          i.onload = () => resolve(i);
        });

        const tempCanvas = document.createElement('canvas');
        const ctx = tempCanvas.getContext('2d');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        // Apply box fills (smart background sampling)
        boxes.forEach(box => {
          let color = box.color;
          if (!color) {
            // Sample dominant background color
            const borderOffset = 8;
            const startX = Math.max(0, box.x - borderOffset);
            const endX = Math.min(tempCanvas.width - 1, box.x + box.w + borderOffset);
            const startY = Math.max(0, box.y - borderOffset);
            const endY = Math.min(tempCanvas.height - 1, box.y + box.h + borderOffset);

            const samplePoints = [];
            // Left and Right columns
            for (let sy = startY; sy <= endY; sy += Math.max(1, Math.round(box.h / 15))) {
              samplePoints.push({ x: startX, y: sy });
              samplePoints.push({ x: endX, y: sy });
            }
            // Top and Bottom rows
            for (let sx = startX; sx <= endX; sx += Math.max(1, Math.round(box.w / 15))) {
              samplePoints.push({ x: sx, y: startY });
              samplePoints.push({ x: sx, y: endY });
            }

            const pValues = [];
            samplePoints.forEach(p => {
              try {
                const px = ctx.getImageData(p.x, p.y, 1, 1).data;
                if (px[3] > 0) {
                  const r = px[0];
                  const g = px[1];
                  const b = px[2];
                  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                  pValues.push({ r, g, b, lum });
                }
              } catch (e) {
                // Guard
              }
            });

            if (pValues.length > 0) {
              pValues.sort((a, b) => a.lum - b.lum);
              const avgLum = pValues.reduce((sum, pv) => sum + pv.lum, 0) / pValues.length;
              const targetIndex = avgLum > 128
                ? Math.floor(pValues.length * 0.75)
                : Math.floor(pValues.length * 0.25);
              const bestColor = pValues[targetIndex];
              color = `rgb(${bestColor.r}, ${bestColor.g}, ${bestColor.b})`;
            } else {
              color = '#ffffff';
            }
          }
          ctx.fillStyle = color;
          ctx.fillRect(box.x, box.y, box.w, box.h);
        });

        // Apply brush strokes
        strokes.forEach(stroke => {
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

        editedDocMap[idx] = tempCanvas.toDataURL(isImage ? pdfFile.type : 'image/png');
      }

      let blob;
      let defaultExt = '.pdf';

      if (isImage) {
        const dataUrl = editedDocMap[0] || renderedPages[0].dataUrl;
        const res = await fetch(dataUrl);
        blob = await res.blob();
        defaultExt = pdfFile.type.includes('png') ? '.png' : '.jpg';
      } else {
        const rebuiltBytes = await rebuildPdf(originalBuffer, editedDocMap);
        blob = new Blob([rebuiltBytes], { type: 'application/pdf' });
      }

      const cleanFileName = exportFileName.trim() ? exportFileName : 'document_cleaned';
      const fileNameToUse = cleanFileName.toLowerCase().endsWith(defaultExt)
        ? cleanFileName
        : `${cleanFileName}${defaultExt}`;

      if (typeof window.showSaveFilePicker === 'function') {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: fileNameToUse,
            types: [{
              description: isImage ? 'Image File' : 'PDF Document',
              accept: { [isImage ? pdfFile.type : 'application/pdf']: [defaultExt] }
            }]
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          setStatusMessage('File saved successfully!');
        } catch (err) {
          if (err.name === 'AbortError') {
            setStatusMessage('Save cancelled.');
          } else {
            console.error('File System Access API failed, falling back:', err);
            triggerStandardDownload(blob, fileNameToUse);
          }
        }
      } else {
        triggerStandardDownload(blob, fileNameToUse);
      }
      setTimeout(() => setStatusMessage(''), 4000);
    } catch (err) {
      console.error(err);
      setErrorMessage(`Failed to export file: ${err.message || err}`);
    } finally {
      setIsRebuilding(false);
    }
  };

  const handleBoxesChange = (newBoxesOrFn) => {
    setPageBoxes(prev => {
      const currentBoxes = prev[currentPage - 1] || [];
      const updatedBoxes = typeof newBoxesOrFn === 'function'
        ? newBoxesOrFn(currentBoxes)
        : newBoxesOrFn;
      return {
        ...prev,
        [currentPage - 1]: updatedBoxes
      };
    });
  };

  const handleStrokesChange = (newStrokesOrFn) => {
    setPageBrushStrokes(prev => {
      const currentStrokes = prev[currentPage - 1] || [];
      const updatedStrokes = typeof newStrokesOrFn === 'function'
        ? newStrokesOrFn(currentStrokes)
        : newStrokesOrFn;
      return {
        ...prev,
        [currentPage - 1]: updatedStrokes
      };
    });
  };

  const currentPageData = renderedPages[currentPage - 1];
  const currentPageBoxes = pageBoxes[currentPage - 1] || [];
  const currentPageStrokes = pageBrushStrokes[currentPage - 1] || [];

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950 text-zinc-100">

      {/* Unified Toolbar Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-3 bg-zinc-950/80 border-b border-zinc-900 sticky top-0 z-50 backdrop-blur-md">
        {/* Left: Brand + File Operations */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 mr-2">
            <Layers className="text-blue-500 w-5 h-5 filter drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
            <span className="text-xs font-bold logo-title m-0 tracking-wider">Notebook Editor</span>
          </div>

          {/* File Inputs & Commands */}
          <div className="flex items-center gap-2">
            {/* File Open */}
            <label className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-905 border border-zinc-800 hover:bg-zinc-850 hover:border-zinc-700 rounded-lg text-xs font-semibold cursor-pointer text-zinc-200 transition">
              <FolderOpen size={14} className="text-blue-500" />
              <span>Open</span>
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </label>

            {/* File Close & Save (Only when file loaded) */}
            {pdfFile && (
              <>
                {/* Filename Input */}
                <input
                  type="text"
                  value={exportFileName}
                  onChange={(e) => setExportFileName(e.target.value)}
                  className="bg-zinc-900 border border-zinc-850 rounded-lg px-2.5 py-1 text-xs text-zinc-200 w-44 focus:outline-none focus:border-blue-500 transition"
                  placeholder="Filename..."
                  title="Output Filename"
                />

                {/* Page nav for PDFs */}
                {pdfDoc && numPages > 1 && (
                  <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800">
                    <button
                      onClick={handlePrevPage}
                      disabled={currentPage <= 1}
                      className="p-1 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-white disabled:opacity-30 transition"
                      title="Previous Page"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span className="text-[10px] font-bold text-zinc-400 px-1 text-center min-w-10">
                      {currentPage}/{numPages}
                    </span>
                    <button
                      onClick={handleNextPage}
                      disabled={currentPage >= numPages}
                      className="p-1 hover:bg-zinc-800 rounded-md text-zinc-405 hover:text-white disabled:opacity-30 transition"
                      title="Next Page"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                )}

                {/* Close button */}
                <button
                  onClick={() => {
                    setPdfFile(null);
                    setPdfDoc(null);
                    setOriginalBuffer(null);
                    setRenderedPages({});
                    setPageBoxes({});
                    setPageBrushStrokes({});
                  }}
                  className="flex items-center gap-1 px-2 py-1.5 bg-zinc-950 border border-zinc-850 hover:bg-zinc-900 hover:border-zinc-700/80 hover:text-red-400 text-xs font-semibold rounded-lg text-zinc-400 transition"
                  title="Close Document"
                >
                  <X size={14} />
                  <span>Close</span>
                </button>

                {/* Save/Export button */}
                <button
                  onClick={handleExportPdf}
                  disabled={isRebuilding}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition"
                  title="Save / Export File"
                >
                  {isRebuilding ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <Download size={14} />
                  )}
                  <span>Save</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Middle-Right: Tools, Zoom, Gemini and Reset (Shown only when file loaded) */}
        {pdfFile ? (
          <div className="flex items-center gap-4">
            {/* Tools choices: Box vs Brush */}
            <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800">
              <button
                onClick={() => setActiveTool('box')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition ${activeTool === 'box'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'hover:bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                title="Box Eraser Tool"
              >
                <Square size={13} strokeWidth={2.5} />
                <span>Box Eraser</span>
              </button>
              <button
                onClick={() => setActiveTool('brush')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition ${activeTool === 'brush'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'hover:bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                title="Healing Brush Tool"
              >
                <Brush size={13} />
                <span>Healing Brush</span>
              </button>
            </div>

            {/* Dynamic Brush Context control options */}
            {activeTool === 'brush' && (
              <div className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-850 px-2.5 py-1 rounded-lg">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-zinc-550 font-bold uppercase">Size:</span>
                  <input
                    type="range"
                    min="5"
                    max="80"
                    value={brushSize}
                    onChange={(e) => setBrushSize(parseInt(e.target.value))}
                    className="w-16 accent-blue-500 h-1 rounded bg-zinc-850"
                  />
                  <span className="text-[10px] text-zinc-300 font-semibold w-5">{brushSize}px</span>
                </div>

                <div className="h-3 w-px bg-zinc-850" />

                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-zinc-555 font-bold uppercase">Color:</span>
                  <button
                    onClick={() => setColorMode('auto')}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition ${colorMode === 'auto'
                      ? 'bg-blue-950/50 text-blue-400 border-blue-900/50'
                      : 'bg-zinc-800 text-zinc-400 border-zinc-800 hover:text-white'
                      }`}
                    title="Smart background color sampling"
                  >
                    Smart
                  </button>
                  <button
                    onClick={() => setColorMode('custom')}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition ${colorMode === 'custom'
                      ? 'bg-zinc-850 text-white border-zinc-700'
                      : 'bg-zinc-800 text-zinc-400 border-zinc-800 hover:text-white'
                      }`}
                  >
                    Custom
                  </button>
                  {colorMode === 'custom' && (
                    <input
                      type="color"
                      value={customColor}
                      onChange={(e) => setCustomColor(e.target.value)}
                      className="w-4 h-4 rounded border-0 bg-transparent cursor-pointer p-0 shrink-0"
                    />
                  )}
                </div>
              </div>
            )}

            {/* Zoom scale controls */}
            <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800">
              <button
                onClick={() => handleZoom('out')}
                className="p-1 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-white"
                title="Zoom Out (Ctrl + Wheel)"
              >
                <ZoomOut size={14} />
              </button>
              <span className="text-[10px] font-bold text-zinc-400 px-1.5 min-w-10 text-center">
                {Math.round(scale * 100)}%
              </span>
              <button
                onClick={() => handleZoom('in')}
                className="p-1 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-white"
                title="Zoom In (Ctrl + Wheel)"
              >
                <ZoomIn size={14} />
              </button>
            </div>

            {/* AI detection */}
            <button
              onClick={handleAutoDetect}
              disabled={isDetecting}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${isDetecting
                ? 'bg-blue-950/20 text-blue-400 border-blue-900/30 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500/80 shadow-md'
                }`}
            >
              <Sparkles size={13} className={isDetecting ? 'animate-spin' : ''} />
              <span>{isDetecting ? 'Detecting...' : 'Auto-Detect'}</span>
            </button>

            {/* Reset current page */}
            <button
              onClick={() => {
                const pageIdx = currentPage - 1;
                setPageBoxes((prev) => ({ ...prev, [pageIdx]: [] }));
                setPageBrushStrokes((prev) => ({ ...prev, [pageIdx]: [] }));
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-red-950/30 hover:text-red-400 text-xs font-semibold text-zinc-450 border border-transparent hover:border-red-900/30 rounded-lg transition"
              title="Clear page edits"
            >
              <Trash2 size={13} />
              <span>Reset Page</span>
            </button>

            {/* Gear settings button */}
            <div className="relative">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-1.5 rounded-lg border transition ${showSettings
                  ? 'bg-zinc-800 border-zinc-700 text-white'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700'
                  }`}
                title="Gemini API Configuration"
              >
                <Settings size={14} className={showSettings ? 'rotate-45 transition-transform' : ''} />
              </button>

              {showSettings && (
                <div className="absolute right-0 top-9 w-64 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-4 z-50 flex flex-col gap-3">
                  <h3 className="text-xs font-bold text-zinc-350 m-0 uppercase tracking-wider">Gemini API Settings</h3>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold text-zinc-500 uppercase">API Key</label>
                    <div className="relative">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 rounded-lg py-1 px-2.5 text-xs focus:outline-none focus:border-blue-500 text-zinc-205 transition"
                        placeholder="APIKey..."
                      />
                      <button
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-2 top-1 text-zinc-500 hover:text-zinc-300 transition"
                      >
                        {showApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold text-zinc-500 uppercase">Model</label>
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="w-full bg-zinc-955 border border-zinc-800 rounded-lg p-1 text-xs focus:outline-none focus:border-blue-500 text-zinc-200 transition"
                    >
                      <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                      <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-1.5 rounded-lg border transition flex items-center gap-1.5 text-xs font-semibold ${showSettings
                  ? 'bg-zinc-800 border-zinc-700 text-white'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                title="Gemini API Configuration"
              >
                <Settings size={14} />
                <span>Config API</span>
              </button>

              {showSettings && (
                <div className="absolute right-0 top-9 w-64 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-4 z-50 flex flex-col gap-3">
                  <h3 className="text-xs font-bold text-zinc-350 m-0 uppercase tracking-wider">Gemini API Settings</h3>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold text-zinc-500 uppercase">API Key</label>
                    <div className="relative">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-850 hover:border-zinc-700 rounded-lg py-1 px-2.5 text-xs focus:outline-none focus:border-blue-500 text-zinc-200 transition"
                        placeholder="APIKey..."
                      />
                      <button
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-2 top-1 text-zinc-500 hover:text-zinc-300 transition"
                      >
                        {showApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold text-zinc-500 uppercase">Model</label>
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-1 text-xs focus:outline-none focus:border-blue-500 text-zinc-200 transition"
                    >
                      <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                      <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Main Workspace Column */}
      <main className="flex-1 flex flex-col p-6 max-w-[1600px] w-full mx-auto justify-center">

        {!pdfFile ? (
          <div className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-700 hover:border-blue-500/50 rounded-2xl p-10 bg-zinc-900/10 hover:bg-zinc-900/30 cursor-pointer transition-all duration-300 w-full max-w-xl min-h-[360px] self-center mt-12 relative shadow-xl group">
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                opacity: 0,
                cursor: 'pointer',
                width: '100%',
                height: '100%',
              }}
              onChange={handleFileChange}
            />
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-blue-950/20 border border-blue-900/40 text-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.15)] group-hover:scale-110 transition duration-300">
              <Upload className="w-7 h-7 text-blue-400 group-hover:text-blue-300" />
            </div>
            <h2 className="text-base font-semibold text-zinc-200 mt-5 m-0 group-hover:text-white">Load PDF or Image</h2>
            <p className="text-xs text-zinc-400 mt-2 max-w-72 text-center leading-relaxed">
              Drag and drop your file here, or click to browse. Supports PDF, PNG, JPG, and WEBP.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400 font-bold uppercase">PDF</span>
              <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400 font-bold uppercase">PNG</span>
              <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400 font-bold uppercase">JPG</span>
              <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400 font-bold uppercase">WEBP</span>
            </div>
          </div>
        ) : (
          <div className="w-full flex flex-col min-w-0">
            <CanvasEditor
              originalPageImage={currentPageData?.dataUrl}
              boxes={currentPageBoxes}
              setBoxes={handleBoxesChange}
              brushStrokes={currentPageStrokes}
              setBrushStrokes={handleStrokesChange}
              activeTool={activeTool}
              brushSize={brushSize}
              colorMode={colorMode}
              customColor={customColor}
              setCustomColor={setCustomColor}
              scale={scale}
              setScale={setScale}
            />
          </div>
        )}

      </main>

      {/* Floating System Toasts */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {statusMessage && (
          <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-350 shadow-2xl animate-pulse pointer-events-auto">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            {statusMessage}
          </div>
        )}
        {errorMessage && (
          <div className="flex items-center gap-2 px-4 py-2 bg-red-950/80 border border-red-900/50 rounded-xl text-xs text-red-300 shadow-2xl pointer-events-auto">
            <ShieldAlert size={14} className="text-red-500 shrink-0" />
            <span>{errorMessage}</span>
            <button
              onClick={() => setErrorMessage('')}
              className="ml-1 hover:text-white transition"
            >
              <X size={10} strokeWidth={3} />
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
