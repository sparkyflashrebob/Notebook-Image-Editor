import { PDFDocument } from 'pdf-lib';

// Helper to safely get the browser global pdfjsLib
function getPdfjsLib() {
  const lib = window.pdfjsLib;
  if (!lib) {
    throw new Error('PDF.js library is not loaded. Please check that script tags in index.html are correct and loaded.');
  }
  return lib;
}

/**
 * Loads a PDF document from an ArrayBuffer
 * @param {ArrayBuffer} arrayBuffer 
 * @returns {Promise<any>}
 */
export async function loadPdfDoc(arrayBuffer) {
  try {
    const pdfjsLib = getPdfjsLib();
    // Ensure worker is configured correctly
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    // Slice the ArrayBuffer to copy it so the original remains intact (doesn't get detached by worker transfer)
    const bufferCopy = arrayBuffer.slice(0);
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bufferCopy) });
    return await loadingTask.promise;
  } catch (error) {
    console.error('Error loading PDF document:', error);
    throw error;
  }
}

/**
 * Renders a PDF page to a canvas context
 * @param {any} pdfDoc 
 * @param {number} pageNumber 1-based page number
 * @param {HTMLCanvasElement} canvas 
 * @param {number} scale Zoom scale (default: 1.5)
 * @returns {Promise<{width: number, height: number}>} Original page dimensions
 */
export async function renderPdfPageToCanvas(pdfDoc, pageNumber, canvas, scale = 1.5) {
  try {
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };

    await page.render(renderContext).promise;

    // Return original size so we can rebuild it with the same dimensions
    const originalViewport = page.getViewport({ scale: 1.0 });
    return {
      width: originalViewport.width,
      height: originalViewport.height
    };
  } catch (error) {
    console.error(`Error rendering page ${pageNumber}:`, error);
    throw error;
  }
}

/**
 * Rebuilds a PDF from the original PDF and edited canvas data URLs
 * @param {ArrayBuffer} originalArrayBuffer The original PDF buffer
 * @param {Object} editedPagesMap Key is 0-based page index, value is Data URL
 * @returns {Promise<Uint8Array>} The rebuilt PDF as bytes
 */
export async function rebuildPdf(originalArrayBuffer, editedPagesMap) {
  try {
    const originalDoc = await PDFDocument.load(originalArrayBuffer);
    const newDoc = await PDFDocument.create();

    const pages = originalDoc.getPages();
    for (let i = 0; i < pages.length; i++) {
      const originalPage = pages[i];
      const { width, height } = originalPage.getSize();

      if (editedPagesMap[i]) {
        // If the page was edited, insert the new blank page and render the rasterized image
        const newPage = newDoc.addPage([width, height]);
        const dataUrl = editedPagesMap[i];

        let imageBytes;
        if (dataUrl.startsWith('data:image/png')) {
          imageBytes = await fetch(dataUrl).then(res => res.arrayBuffer());
          const embeddedImage = await newDoc.embedPng(imageBytes);
          newPage.drawImage(embeddedImage, {
            x: 0,
            y: 0,
            width: width,
            height: height,
          });
        } else if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
          imageBytes = await fetch(dataUrl).then(res => res.arrayBuffer());
          const embeddedImage = await newDoc.embedJpg(imageBytes);
          newPage.drawImage(embeddedImage, {
            x: 0,
            y: 0,
            width: width,
            height: height,
          });
        } else {
          throw new Error('Unsupported image format for rebuilding page ' + (i + 1));
        }
      } else {
        // If the page was not edited, we can copy it from the original PDF to maintain vector quality
        const [copiedPage] = await newDoc.copyPages(originalDoc, [i]);
        newDoc.addPage(copiedPage);
      }
    }

    return await newDoc.save();
  } catch (error) {
    console.error('Error rebuilding PDF:', error);
    throw error;
  }
}
