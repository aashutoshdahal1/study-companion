import { pdfjs } from "react-pdf";

// Use the worker from CDN or fallback to local
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
