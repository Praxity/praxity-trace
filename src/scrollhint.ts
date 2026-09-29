import { inlineClient } from "./client.ts";
/**
 * Wide charts and tables scroll sideways. A faded edge and an arrow on the side with more to see
 * tell the reader it is there. Keyboard users already scroll the focusable region with the arrow
 * keys, so the buttons are for pointers and stay out of the tab order.
 */
export function scrollHintClient() {
  const update = (frame: HTMLElement, region: HTMLElement) => {
    const left = region.scrollLeft > 2;
    const right = region.scrollLeft + region.clientWidth < region.scrollWidth - 2;
    frame.classList.toggle('more-left', left);
    frame.classList.toggle('more-right', right);
  };
  const arrow = (side: "left" | "right", region: HTMLElement) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'scroll-arrow ' + side;
    button.tabIndex = -1;
    button.setAttribute('aria-hidden', 'true');
    // Tabler chevron: a text glyph sits on its baseline and never centres in the circle.
    button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + (side === 'left' ? 'M15 6l-6 6l6 6' : 'M9 6l6 6l-6 6') + '"/></svg>';
    button.addEventListener('click', () => region.scrollBy({ left: (side === 'left' ? -0.8 : 0.8) * region.clientWidth, behavior: 'smooth' }));
    return button;
  };
  document.querySelectorAll<HTMLElement>('.scroll, .table-wrap').forEach((region) => {
    const frame = document.createElement('div');
    frame.className = 'scroll-frame';
    region.parentNode?.insertBefore(frame, region);
    frame.append(arrow('left', region), region, arrow('right', region));
    region.addEventListener('scroll', () => update(frame, region), { passive: true });
    new ResizeObserver(() => update(frame, region)).observe(region);
    update(frame, region);
  });
}
export const SCROLL_HINT_SCRIPT = inlineClient(scrollHintClient);

export const SCROLL_HINT_STYLE = `
.scroll-frame{position:relative}
.scroll-frame::before,.scroll-frame::after{content:"";position:absolute;top:0;bottom:0;width:2.5rem;pointer-events:none;opacity:0;transition:opacity .15s;z-index:1}
.scroll-frame::before{left:0;background:linear-gradient(to right,var(--surface),transparent)}
.scroll-frame::after{right:0;background:linear-gradient(to left,var(--surface),transparent)}
.scroll-frame.more-left::before,.scroll-frame.more-right::after{opacity:1}
.scroll-arrow{position:absolute;top:50%;transform:translateY(-50%);z-index:2;display:none;width:2rem;height:2rem;border-radius:50%;border:1px solid var(--axis);background:var(--surface);color:var(--ink);padding:0;place-items:center;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.15)}
.scroll-arrow.left{left:.25rem}.scroll-arrow.right{right:.25rem}
.scroll-frame.more-left>.scroll-arrow.left,.scroll-frame.more-right>.scroll-arrow.right{display:grid}
.scroll-arrow:hover{border-color:var(--ink-2)}
@media (prefers-reduced-motion:reduce){.scroll-frame::before,.scroll-frame::after{transition:none}}
`;
