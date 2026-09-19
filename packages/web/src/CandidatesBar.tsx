/**
 * Candidate review strip.
 *
 * Renders the engine's deterministic best-first ranking as comparable cards:
 * rank, strategy, validity, severity counts and the usable-area ratio all
 * come from existing candidate data — no new scoring is invented here and
 * the ranking order is never altered. The first card (best rank) is clearly
 * marked; the selected card is unmistakable (ring + accent).
 */
import React from 'react';
import type { LayoutCandidate, ValidationResult } from '@archgenius/core';
import { t, tf, faNum, STRATEGY_FA } from './i18n';
import { IconXCircle, IconAlert, IconInfo, IconCheckCircle } from './components';

export function CandidatesBar({
  candidates, validations, selectedIdx, onSelect,
}: {
  candidates: LayoutCandidate[];
  validations: ValidationResult[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
}) {
  return (
    <div
      className="border-b border-ink-700 px-3 py-2 min-w-0"
      role="group"
      aria-label={t('candidatesTitle')}
    >
      <div className="flex gap-2 overflow-x-auto pb-1">
        {candidates.map((c, i) => {
          const vr = validations[i];
          const selected = i === selectedIdx;
          const ok = vr ? vr.ok : c.valid;
          const hard = vr ? vr.hard.length : c.findings.filter(f => f.severity === 'hard').length;
          const soft = vr ? vr.soft.length : c.findings.filter(f => f.severity === 'soft').length;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(i)}
              aria-pressed={selected}
              className={`text-start rounded-lg border p-2 min-w-[150px] max-w-[190px] shrink-0 transition-colors ${
                selected
                  ? 'border-accent-400 bg-accent-500/15 ring-1 ring-accent-400/60'
                  : 'border-ink-700 bg-ink-800 hover:bg-ink-700/60'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`text-[11px] font-bold ${selected ? 'text-accent-300' : 'text-ink-400'}`}>
                  {tf('candidateRank', { index: faNum(i + 1) })}
                </span>
                {i === 0 && <span className="badge-ok !text-[9px] !px-1 !py-0">{t('candidateBestBadge')}</span>}
              </div>
              <div className="text-xs font-semibold text-slate-200 truncate">
                {STRATEGY_FA[c.metadata.strategy] ?? c.metadata.strategy}
              </div>
              <div className={`text-[10px] font-semibold flex items-center gap-1 ${ok ? 'text-ok' : 'text-bad'}`}>
                {ok
                  ? <><IconCheckCircle className="w-3 h-3" />{t('candidateValidLabel')}</>
                  : <><IconXCircle className="w-3 h-3" />{t('candidateInvalidLabel')}</>}
              </div>
              <div className="text-[10px] text-ink-400 flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                <span className="inline-flex items-center gap-0.5"><IconXCircle className="w-2.5 h-2.5 text-bad" />{faNum(hard)}</span>
                <span className="inline-flex items-center gap-0.5"><IconAlert className="w-2.5 h-2.5 text-warn" />{faNum(soft)}</span>
                <span className="inline-flex items-center gap-0.5"><IconInfo className="w-2.5 h-2.5 text-ink-400" />{faNum(vr ? vr.advisory.length : 0)}</span>
                <span className="ltr" dir="ltr">{(c.metrics.usableAreaRatio * 100).toFixed(0)}%</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
