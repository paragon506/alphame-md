export const $ = (selector, root = document) => root.querySelector(selector);

export function show(element, visible, display = 'block') {
  element.classList.toggle('hidden', !visible);
  if (display !== 'block') element.classList.toggle(display, visible);
}
