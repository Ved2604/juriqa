/**
 * Smooth-scroll a container, falling back to an instant jump if the animation
 * never starts (browsers skip smooth scrolling in background or throttled tabs).
 */
export function scrollContainerTo(el: HTMLElement, top: number) {
  const start = el.scrollTop;
  const target = Math.max(0, top);
  el.scrollTo({ top: target, behavior: "smooth" });
  setTimeout(() => {
    if (el.scrollTop === start && Math.abs(start - target) > 2) el.scrollTop = target;
  }, 700);
}
