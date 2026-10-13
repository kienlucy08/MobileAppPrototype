import { h } from './util.js';

const P = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  upload: 'M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3',
  pulse: 'M3 12h4l3-8 4 16 3-8h4',
  code: 'M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14',
  back: 'M15 5l-7 7 7 7',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9.5h.01',
  pin: 'M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11zM12 12a2 2 0 100-4 2 2 0 000 4z',
  check: 'M5 13l4 4L19 7',
  alert: 'M12 3l10 18H2L12 3zM12 10v5M12 18h.01',
  info: 'M12 8h.01M11 12h1v5h1M12 21a9 9 0 100-18 9 9 0 000 18z',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4l13 8-13 8z',
  wifi: 'M2 9a15 15 0 0120 0M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 19.5h.01',
  refresh: 'M4 4v6h6M20 20v-6h-6M20 10a8 8 0 00-14-3M4 14a8 8 0 0014 3',
  download: 'M12 4v12m0 0l-4-4m4 4l4-4M4 20h16',
};

export const icon = (name, size = 18) =>
  h('span', { class: 'ico', html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name]}"/></svg>` });
