import mammoth from "mammoth";
import { type HTMLElement, parse } from "node-html-parser";
import { type Block, ProcessingError } from "./types";
import { isHeadingText } from "./text";

const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI"]);

export type DocxExtraction = {
  blocks: Block[];
  /** Root of the rendered HTML; the chunker's results are written back into it. */
  root: HTMLElement;
  elements: HTMLElement[];
};

export async function extractDocx(data: Uint8Array): Promise<DocxExtraction> {
  let html: string;
  try {
    ({ value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(data) }));
  } catch {
    throw new ProcessingError("This Word file could not be opened. The file may be damaged.");
  }

  const root = parse(`<div class="docx">${html}</div>`);
  // Leaf block elements only: an <li> containing <p>s contributes its <p>s.
  const elements = root
    .querySelectorAll("p, h1, h2, h3, h4, h5, h6, li")
    .filter((el) => !el.querySelectorAll("*").some((c) => BLOCK_TAGS.has(c.tagName)));

  const blocks: Block[] = [];
  elements.forEach((el, i) => {
    const text = el.text.replace(/\s+/g, " ").trim();
    if (!text) return;
    const heading = /^H\d$/.test(el.tagName) || isHeadingText(text);
    blocks.push({ text, heading, lines: [], elementIndex: i });
  });

  if (!blocks.length) {
    throw new ProcessingError("This Word file has no readable text.");
  }
  return { blocks, root, elements };
}
