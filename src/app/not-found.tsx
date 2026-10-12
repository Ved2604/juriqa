import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm text-muted">This page doesn’t exist. It may have been deleted.</p>
      <Link href="/" className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-2">
        Back to documents
      </Link>
    </div>
  );
}
