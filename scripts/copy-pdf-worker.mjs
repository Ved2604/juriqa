// Copies the pdf.js worker into public/ so the browser can load it at /pdf.worker.min.mjs.
// Runs on every install, so the worker always matches the installed pdfjs-dist version.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const src = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
mkdirSync("public", { recursive: true });
copyFileSync(src, "public/pdf.worker.min.mjs");
console.log("Copied pdf.js worker to public/pdf.worker.min.mjs");
