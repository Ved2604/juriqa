import { Suspense } from "react";
import { ComparisonView } from "@/components/compare/comparison-view";

export default function ComparePage() {
  return (
    <Suspense>
      <ComparisonView />
    </Suspense>
  );
}
