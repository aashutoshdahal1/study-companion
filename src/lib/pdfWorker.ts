import { pdfjs } from "react-pdf";
// Use the worker bundled with pdfjs-dist via Vite ?url import.
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
