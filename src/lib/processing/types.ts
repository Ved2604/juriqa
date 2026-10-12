/** A line of PDF text with its rectangle and its character range in the block text. */
export type BlockLine = {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  start: number;
  end: number;
};

/**
 * A paragraph-like unit produced by an extractor, before chunking.
 * PDF blocks carry line rectangles; DOCX blocks carry the index of their
 * HTML element so chunk IDs can be written back into the HTML.
 */
export type Block = {
  text: string;
  heading: boolean;
  lines: BlockLine[];
  elementIndex?: number;
};

export class ProcessingError extends Error {
  /** Message safe to show the user. */
  constructor(public userMessage: string) {
    super(userMessage);
  }
}

export type ProgressFn = (step: string) => Promise<void> | void;
