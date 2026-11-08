import { $ } from './dom.js';

let hideTimer;

export function notify(message) {
  const element = $('#toast');
  element.textContent = message;
  element.dataset.show = 'true';
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    element.dataset.show = 'false';
  }, 2600);
}
