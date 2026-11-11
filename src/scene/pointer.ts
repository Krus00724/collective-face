import type { FigureId } from '../data/figures';

/**
 * Where the visitor's hand is. A mouse is always somewhere; a finger only exists while it
 * touches. The busts watch this: they turn to it, follow it with their eyes, give under it.
 */
export const hand = {
  /** -1 to 1 across the page, y up. */
  x: 0,
  y: 0,
  mouse: false,
  down: false,
  /** Seconds since it last moved. */
  still: 99,
  /** The bust under it. */
  over: null as FigureId | null,
  /** The bust being pressed. */
  pressing: null as FigureId | null,
  /** True while the hand is somewhere the busts can see. */
  get present() { return (this.mouse || this.down) && this.still < 5; },
};

let watching = false;
export function watchHand() {
  if (watching) return;
  watching = true;
  const place = (e: PointerEvent) => {
    hand.x = (e.clientX / innerWidth) * 2 - 1;
    hand.y = -((e.clientY / innerHeight) * 2 - 1);
    hand.mouse = e.pointerType === 'mouse';
    hand.still = 0;
  };
  addEventListener('pointermove', place, { passive: true });
  addEventListener('pointerdown', (e) => { place(e); hand.down = true; }, { passive: true });
  const up = (e: PointerEvent) => {
    hand.down = false;
    hand.pressing = null;
    if (e.pointerType !== 'mouse') hand.over = null;
  };
  addEventListener('pointerup', up, { passive: true });
  addEventListener('pointercancel', up, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { hand.still = 99; hand.over = null; });
}
