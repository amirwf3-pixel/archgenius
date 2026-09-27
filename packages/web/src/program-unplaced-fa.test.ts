/**
 * Task 156 — ARCH_PROGRAM_UNPLACED shows the Persian space name.
 *
 * The core message quotes the program SpaceType id ('yard', 'master-bedroom', …).
 * The UI maps that id through the existing SPACE_TYPE_FA table; unknown ids stay
 * verbatim (never guessed). The core message itself (English) is untouched.
 */
import { describe, it, expect } from 'vitest';
import { createProject, generate, validateCandidate } from '@archgenius/core';
import type { LayoutCandidate } from '@archgenius/core';
import { DEFAULT_STATE, buildProjectInput } from './App';
import { findingMessageFa, findingCodeTitle, SPACE_TYPE_FA } from './i18n';

const msg = (type: string, level = 0, req = 1, got = 0) =>
  `Floor ${level}: requested program room '${type}' not placed (required x${req}, placed x${got}) — requested rooms are never silently dropped`;
const fa = (type: string, level = 0, req = 1, got = 0) => findingMessageFa({ code: 'ARCH_PROGRAM_UNPLACED', message: msg(type, level, req, got) });
const expected = (name: string, level = 0, req = 1, got = 0) =>
  `طبقهٔ ${level}: فضای درخواستی «${name}» جایدهی نشد (تعداد خواسته ${req}، جایدهی‌شده ${got}) — فضاهای درخواستی هرگز به‌صورت خاموش حذف نمی‌شوند`;

describe('Task 156: ARCH_PROGRAM_UNPLACED Persian space names', () => {
  it('yard → «حیاط», balcony → «بالکن», bedroom → existing «اتاق خواب»', () => {
    expect(fa('yard')).toBe(expected('حیاط'));
    expect(fa('balcony')).toBe(expected('بالکن'));
    expect(fa('bedroom')).toBe(expected(SPACE_TYPE_FA.bedroom));
    expect(SPACE_TYPE_FA.bedroom).toBe('اتاق خواب');
  });

  it('every core SpaceType resolves to its existing Persian label', () => {
    const types = ['entrance', 'foyer', 'living', 'dining', 'kitchen', 'guest-wc', 'bedroom', 'master-bedroom', 'bathroom',
      'master-bathroom', 'corridor', 'stair-hall', 'elevator-hall', 'storage', 'balcony', 'yard', 'parking', 'utility',
      'family-room', 'guest-room'];
    for (const t of types) {
      expect(SPACE_TYPE_FA[t]).toBeTruthy();
      expect(fa(t)).toBe(expected(SPACE_TYPE_FA[t]));
    }
  });

  it('unknown / internal ids do not crash and stay verbatim (never guessed)', () => {
    for (const t of ['sauna', 'yard-0-000', 'Yard', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(fa(t)).toBe(expected(t));
    }
  });

  it('numbers, floor and counts are preserved exactly', () => {
    expect(fa('bedroom', 1, 3, 2)).toBe(expected('اتاق خواب', 1, 3, 2));
    expect(fa('master-bedroom', 2, 12, 0)).toBe(expected('اتاق خواب مستر', 2, 12, 0));
  });

  it('title unchanged; non-matching messages fall back unchanged', () => {
    expect(findingCodeTitle('ARCH_PROGRAM_UNPLACED')).toBe('جایدهی‌نشدن فضای برنامه');
    const other = 'Floor 0: something else entirely';
    expect(findingMessageFa({ code: 'ARCH_PROGRAM_UNPLACED', message: other })).toBe(other);
  });

  it('a real engine finding (yard ON, yard removed) translates; the English core message is untouched', () => {
    const best = generate(createProject(buildProjectInput({ ...DEFAULT_STATE, hasYard: true })), { allStrategies: true }).bestCandidate!;
    const c = structuredClone(best) as LayoutCandidate;
    c.floors[0].spaces = c.floors[0].spaces.filter(s => s.type !== 'yard');
    const f = validateCandidate(c).findings.find(x => x.code === 'ARCH_PROGRAM_UNPLACED')!;
    expect(f).toBeDefined();
    expect(f.message).toBe(msg('yard', 0, 1, 0));
    expect(findingMessageFa(f)).toBe(expected('حیاط', 0, 1, 0));
  });
});
