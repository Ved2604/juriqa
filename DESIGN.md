# Juriqa: Design Notes

A web app for analysing legal contracts. The user uploads a PDF or DOCX, asks
questions in a chat, and gets answers backed by verified quotes from the
document. Clicking a quote opens and highlights that passage.

## Decisions at a glance

| Area | Decision |
|---|---|
| Framework | Next.js |
| AI provider | Gemini (API key, base URL and model name from env vars, never committed) |
| Deployment | Vercel |
| Database | Postgres (Neon, via Vercel); files in Vercel Blob |
| Deadline | Under 36 hours |
| Part C | Option 2: agentic document research |
| Retrieval | Tool-based search (RAG without a vector DB at the core) |
| Quotes | Cite by chunk ID, so the AI never retypes a quote |
| Out-of-scope questions | Refused, including general legal knowledge |
| Scanned PDFs | Rejected (no OCR) |
| Comparison UI | Minimal list, no git-style diff view |

---

## 1. Retrieval: RAG without a vector DB

RAG means *retrieve relevant text, put it in the prompt, generate an answer*.
A vector database is only one way to retrieve. We use **tool-based search**:
the AI calls tools (keyword search, read neighbouring chunks, get a section) and
our code returns real document text.

Why not pure vector top-k: it only ever reads part of the document, and it is
weakest at the questions legal work cares about most: absence ("Is there a
non-compete?"), exhaustive lists, and exact numbers. Embeddings may be added
later as one more tool (optional extra).

## 2. Request flow (one question)

1. **Router (separate LLM call).** It classifies the question as `document`,
   `off_topic`, `general_knowledge` or `chitchat`.
   - It receives recent chat history, so follow-ups like "what about clause 5?"
     work.
   - Bias: refuse only when clearly unrelated; if unsure, treat it as `document`.
   - **Fail open:** if the router errors, treat the question as `document`.
   - `off_topic` / `general_knowledge` get a polite refusal and a suggestion of
     how to rephrase it as a document question. `chitchat` gets a short reply.
   - Gray zone ("What does indemnity mean?") is **refused**. Narrow and reliable
     beats broad and imprecise.
2. **Agent loop (Part C).** The AI calls search tools over several rounds, reads
   results and cites chunk IDs. There is a hard cap on rounds, and malformed
   tool calls are handled without crashing.
3. **If found:** answer with cited chunks.
4. **If nothing found:** an **automatic full scan** reads the whole document in
   batches (~20 pages each) with live progress. Only then may the app say
   "not in the document."

## 3. Coverage

Our code, not the AI, records which chunks were actually sent to the model.

- A positive answer is proven by its cited chunks.
- A negative answer ("not present") requires **full coverage**. This is why the
  automatic full scan exists.
- If a batch fails, or pages are scanned images, coverage is incomplete and the
  answer must name the unread pages.
- Each answer shows a badge: Full document reviewed / Targeted search
  (N sections) / Incomplete (pages X–Y not read).
- For multiple documents, coverage is tracked per document.

## 4. Chunking and cite-by-ID

- Documents are split along **natural boundaries** (paragraphs and clauses),
  roughly 50–150 words each, never mid-sentence. Tiny pieces such as headings
  are merged with what follows. Over-long paragraphs are split at sentence ends.
- DOCX: paragraphs come from the file structure. PDF: paragraphs are inferred
  from line gaps, numbering (`12.`, `12.1`, `(a)`, `(iii)`) and capitalised
  headings.
- Each chunk gets an ID such as `D1-C87` (document 1, chunk 87).
- **The AI cites IDs, and our code displays the real chunk text.** The AI cannot
  fabricate or misquote evidence.
- The AI may add a short excerpt to pinpoint the key sentence. The excerpt is
  verified **only within that chunk**, with whitespace and character
  normalisation (spaces, line breaks, hyphenation, ligatures, curly quotes,
  dashes). Words and numbers are never altered.
- Excerpt matching is **case-insensitive**. The search is limited to one chunk,
  so a case difference cannot match the wrong text.
- Checks: a cited ID must exist and must have been retrieved during this answer.
- Tool: `get_context(id, before, after)` lets the AI read neighbouring chunks.
- A bad split only affects tidiness, never correctness: chunk text is always
  real document text.

## 5. Large documents

- Normal questions only touch the chunks returned by tools, so document size
  barely matters.
- "Not found" and whole-document questions ("summarise") use **map-reduce**:
  process batches of pages, then combine the results.
- Note: Gemini Flash could fit ~150 pages in one request, but the assignment
  asks for a deliberate splitting strategy, and we don't rely on that.

## 6. Citation highlighting

- **Layout:** chat on the left, document viewer on the right (side by side).
- **PDF:** during extraction (pdf.js) we store each chunk's page and line boxes.
  Highlighting draws those boxes on the rendered page.
  - Multi-line quotes: several boxes.
  - Page-crossing quotes: boxes on both pages.
  - Repeated text: no ambiguity, because the ID points to one location.
- **DOCX:** rendered as HTML with each chunk wrapped in a tagged element; scroll
  to it and highlight it.

## 7. Multi-document questions

- IDs carry the document (`D1-…`, `D2-…`), so attribution and per-document
  verification are automatic.
- Search tools cover all selected documents, or one document via a `doc`
  argument.
- The prompt asks for a **comparative** answer; **tables are allowed** when
  they help.
- Clicking a quote opens that quote's document in the viewer.

## 8. Document comparison (minimal)

1. Split both versions into clauses (reusing chunking).
2. Match clauses by number or heading, then by text similarity, so renumbering
   is handled. Results are unchanged / modified / added / removed (a moved
   clause counts as removed + added).
3. The AI writes a plain-language summary and a significance level for each
   change: **High / Medium / Low / Cosmetic**.
4. **Code safety check:** if numbers, amounts, dates or percentages differ, the
   change is forced to **High**.

UI: a single filterable and sortable list. Each item shows the clause, its
significance, the summary, and the old and new text. No git-style diff view.

## 9. Upload and extraction

- Accept PDF and DOCX, checked by file content as well as extension; reject
  everything else with a clear message.
- Live status: Uploading → Extracting text → Splitting into clauses → Ready.
- **Scanned PDF (no text layer):** rejected with a clear message.
- **Partly scanned PDF:** accepted with a warning; those pages count as unread
  for coverage.
- Library: list, open and delete documents.

## 10. Screens

1. **Library:** upload, statuses, open/delete, select several documents to chat
   with or to compare.
2. **Chat workspace:** streaming answers, live agent status, Stop button,
   verified quotes, coverage badge, and the document viewer on the right.
3. **Compare:** the filterable list of changes.

Every screen has designed empty, loading, error and partial states.

## 11. API

**Documents**
- `POST /api/documents`: upload
- `GET /api/documents`: library list with statuses
- `GET /api/documents/:id`: status and metadata (polled during processing)
- `DELETE /api/documents/:id`: delete
- `GET /api/documents/:id/file`: original file for the viewer
- `GET /api/documents/:id/chunks`: chunk positions for highlighting

**Chats**
- `POST /api/chats`: start a chat with one or more documents
- `GET /api/chats?document=:id`: chat history for a document
- `GET /api/chats/:id`: reopen a chat
- `POST /api/chats/:id/messages`: ask a question (**streaming**)
  - Event stream: router result → agent status ("Searching for…") → answer
    text → quotes → coverage → done.
  - Stop: the client aborts the stream and the server saves the partial answer.
    No separate endpoint.

**Compare**
- `POST /api/compare`: compare two documents

## 12. Build plan

| # | Phase | Done when |
|---|---|---|
| 0 | Setup: Next.js, Postgres (Neon), Vercel Blob, Gemini, env vars, git | App runs and Gemini replies |
| 1 | Upload and extraction, chunking, library | A 150-page contract yields clean chunks |
| 2 | Chat core: router, agent loop, cite-by-ID, streaming, stop, history | Streamed answer with real quotes |
| 3 | Coverage and automatic full scan | Honest answer to "Is there a non-compete?" |
| 4 | Viewer and highlighting | Multi-line and page-crossing quotes highlight correctly |
| 5 | Multi-document | One question across 2–3 contracts |
| 6 | Comparison | AED 100,000 → 1,000,000 is flagged High |
| 7 | Polish: empty, loading and error states | Feels finished |
| 8 | Ship: deploy, README, screenshots, note, demo video | Live link works |

## Vercel constraints

- No persistent disk, so SQLite is out: we use Postgres (Neon) and Vercel Blob
  from day one, for local development too.
- Function time limits: long streams (agent loop plus full scan) must stay
  within the plan's maximum duration. Set `maxDuration` on the chat route and
  keep the full scan's batches parallel.

## Open items

- Test documents: deferred; build first, test later.
