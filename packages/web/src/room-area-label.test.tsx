/**
 * Room area label on the plan canvas — RTL ordering regression (Task 147).
 *
 * The canvas inherits the RTL page direction; the technical value
 * "<area> m² <vertices>v" must be drawn in an explicit LTR run so it does not
 * render as "m² 4v 56.1". Persian room names keep the inherited RTL direction.
 */
import { describe, it, expect } from 'vitest';
import { roomAreaLabel, fillLtrText } from './PlanCanvas';
import { spaceLabel, isPersianText } from './i18n';

const rect4 = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const l6 = [...rect4, { x: 2, y: 2 }, { x: 3, y: 3 }];

/** Minimal recording context: remembers the direction active at each fillText. */
const recorder = (initial: CanvasDirection = 'inherit') => {
  const log: Array<{ text: string; direction: CanvasDirection }> = [];
  const ctx = {
    direction: initial,
    fillText(text: string) { log.push({ text, direction: this.direction }); },
  } as Pick<CanvasRenderingContext2D, 'direction' | 'fillText'>;
  return { ctx, log };
};

describe('roomAreaLabel — value order', () => {
  it('is number → m² → vertex suffix, with the existing canvas formatting', () => {
    expect(roomAreaLabel({ area: 56.1, polygon: rect4 })).toBe('56.1 m² 4v');
    expect(roomAreaLabel({ area: 13.44, polygon: rect4 })).toBe('13.4 m² 4v');
    expect(roomAreaLabel({ area: 21.999, polygon: l6 })).toBe('22.0 m² 6v');
    expect(roomAreaLabel({ area: 56.1, polygon: rect4 })).toMatch(/^\d+\.\d m² \d+v$/);
  });

  it('is deterministic', () => {
    const s = { area: 31.1, polygon: rect4 };
    const first = roomAreaLabel(s);
    for (let i = 0; i < 5; i++) expect(roomAreaLabel(s)).toBe(first);
  });
});

describe('fillLtrText — explicit LTR run for technical values', () => {
  it('draws the area label with direction ltr', () => {
    const { ctx, log } = recorder('inherit');
    fillLtrText(ctx, roomAreaLabel({ area: 56.1, polygon: rect4 }), 10, 20);
    expect(log).toEqual([{ text: '56.1 m² 4v', direction: 'ltr' }]);
  });

  it('restores the previous direction, so the Persian room name stays RTL', () => {
    for (const initial of ['inherit', 'rtl'] as CanvasDirection[]) {
      const { ctx, log } = recorder(initial);
      const name = spaceLabel('Living Room');
      ctx.fillText(name, 0, 0);                                        // room name (unchanged path)
      fillLtrText(ctx, roomAreaLabel({ area: 56.1, polygon: rect4 }), 0, 12);
      ctx.fillText(spaceLabel('Kitchen'), 0, 30);                      // next room's name
      expect(ctx.direction).toBe(initial);
      expect(log.map(l => l.direction)).toEqual([initial, 'ltr', initial]);
      expect(isPersianText(log[0].text)).toBe(true);
      expect(isPersianText(log[2].text)).toBe(true);
      expect(log[0].text).toBe('نشیمن');
    }
  });
});
