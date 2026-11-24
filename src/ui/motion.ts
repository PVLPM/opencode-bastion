/**
 * OpenCode Desktop exposes its own "reduce motion" setting as
 * `data-motion="reduce"` on the document, and the OS preference as a media
 * query. Either one turns off the ticker slide, the activity scan and beams.
 */
export function reduceMotion(): boolean {
  if (document.documentElement.dataset.motion === "reduce") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Web Animations are missing in some test DOMs; motion is optional, so skip it there. */
export function canAnimate(): boolean {
  return "animate" in Element.prototype;
}
