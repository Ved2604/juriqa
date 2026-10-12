/** [4, 5, 6, 9] -> "Pages 4–6, 9". */
export function formatPages(pages: number[]): string {
  const ranges: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    ranges.push(i === j ? `${pages[i]}` : `${pages[i]}–${pages[j]}`);
    i = j;
  }
  return `${pages.length === 1 ? "Page" : "Pages"} ${ranges.join(", ")}`;
}
