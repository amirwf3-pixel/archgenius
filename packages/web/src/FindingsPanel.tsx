/**
 * Results & validation UX.
 *
 * - ResultStatusCard: one glance answer to "what happened / is the result
 *   valid?" — empty, success-verdict and infeasible states. The infeasible
 *   state keeps a concise, actionable Persian explanation up front and moves
 *   the full deterministic engine diagnostics behind «جزئیات فنی».
 * - FindingsPanel: compact severity summary first, then collapsible groups
 *   (critical → warnings → advisory). Every finding keeps its Persian title,
 *   full Persian message, and the machine code/ruleId/entity ids verbatim
 *   (LTR mono) — engineering semantics are preserved, never rewritten.
 * - EditFindingsList: same presentation for findings produced by an edit.
 */
import React, { useState } from 'react';
import type { Finding, ValidationResult } from '@archgenius/core';
import { t, tf, faNum, findingCodeTitle, findingMessageFa, STRATEGY_FA, SEVERITY_FA } from './i18n';
import { Collapsible, SeverityBadge, RuleStatusBadge, StatusNote, IconCube, IconCheckCircle, IconAlert, IconXCircle, IconInfo } from './components';

const INITIAL_VISIBLE = 8;

function TechLine({ f }: { f: Finding }) {
  const parts = [...new Set([f.code ?? f.ruleId ?? '', f.ruleId && f.code ? f.ruleId : ''].filter(Boolean))];
  return (
    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
      <div className="finding-tech ltr" dir="ltr" title={t('technicalDetails')}>
        {parts.join(' · ')}
        {f.entityIds && f.entityIds.length > 0 && ` · ${t('findingEntities')}: ${f.entityIds.join(', ')}`}
      </div>
      {/* Phase 4: rule-verification status beside the ruleId. Only rendered when
          the engine actually attached a status — never invented here. */}
      <RuleStatusBadge status={f.status} />
    </div>
  );
}

function FindingRow({ f }: { f: Finding }) {
  return (
    <li className="finding">
      <SeverityBadge severity={f.severity} className="mt-0.5" />
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="finding-title">{findingCodeTitle(f.code ?? f.ruleId ?? '')}</div>
        <div className="finding-msg">{findingMessageFa(f)}</div>
        <TechLine f={f} />
      </div>
    </li>
  );
}

function FindingsGroup({
  severity, title, items, defaultOpen,
}: { severity: 'hard' | 'soft' | 'advisory'; title: string; items: Finding[]; defaultOpen: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-ink-400">
        <IconCheckCircle className="w-3.5 h-3.5 text-ok/70" />
        <span>{title}</span>
        <span className="ms-auto">{t('findingsNone')}</span>
      </div>
    );
  }
  const visible = expanded ? items : items.slice(0, INITIAL_VISIBLE);
  return (
    <Collapsible
      title={title}
      defaultOpen={defaultOpen}
      className={`rounded-md border ${severity === 'hard' ? 'border-bad/30' : severity === 'soft' ? 'border-warn/25' : 'border-ink-700'} bg-ink-800/40`}
    >
      <div className="flex items-center gap-2 -mt-1 mb-1">
        <span className={severity === 'hard' ? 'chip-hard' : severity === 'soft' ? 'chip-soft' : 'chip-adv'}>
          {tf(severity === 'hard' ? 'badgeHard' : severity === 'soft' ? 'badgeSoft' : 'badgeAdv', { count: faNum(items.length) })}
        </span>
      </div>
      <ul className="space-y-1.5">
        {visible.map((f, i) => <FindingRow key={`${f.code}-${i}`} f={f} />)}
      </ul>
      {items.length > INITIAL_VISIBLE && (
        <button type="button" className="btn-tertiary w-full text-xs" onClick={() => setExpanded(v => !v)}>
          {expanded ? t('findingsShowLess') : tf('findingsShowMore', { count: faNum(items.length - INITIAL_VISIBLE) })}
        </button>
      )}
    </Collapsible>
  );
}

/** Grouped findings for the current (possibly edited) candidate. */
export function FindingsPanel({ vr }: { vr: ValidationResult }) {
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap gap-1.5" aria-label={t('sectionValidation')}>
        <span className="chip-hard">{SEVERITY_FA.hard}: {faNum(vr.hard.length)}</span>
        <span className="chip-soft">{SEVERITY_FA.soft}: {faNum(vr.soft.length)}</span>
        <span className="chip-adv">{SEVERITY_FA.advisory}: {faNum(vr.advisory.length)}</span>
      </div>
      <FindingsGroup severity="hard" title={t('findingsGroupHard')} items={vr.hard} defaultOpen />
      <FindingsGroup severity="soft" title={t('findingsGroupSoft')} items={vr.soft} defaultOpen />
      <FindingsGroup severity="advisory" title={t('findingsGroupAdv')} items={vr.advisory} defaultOpen={false} />
    </div>
  );
}

/** Compact findings list after an edit operation (success or failure). */
export function EditFindingsList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold text-slate-200">{tf('validationAfterEdit', { count: faNum(findings.length) })}</div>
      <ul className="space-y-1 max-h-56 overflow-y-auto">
        {findings.slice(0, 30).map((f, i) => <FindingRow key={`${f.code}-${i}`} f={f} />)}
      </ul>
    </div>
  );
}

export type ResultState =
  | { kind: 'empty' }
  | { kind: 'ok'; vr: ValidationResult; candidateCount: number }
  | { kind: 'invalid'; vr: ValidationResult; candidateCount: number }
  | {
      kind: 'infeasible';
      explanation: string;
      attempts: Array<{ strategy: string; candidateId: string; reason: string }>;
    };

/** One-glance result status: what happened, is it valid, what next. */
export function ResultStatusCard({ state }: { state: ResultState }) {
  if (state.kind === 'empty') {
    return (
      <div className="card items-center text-center py-6">
        <IconCube className="w-8 h-8 text-ink-500 mx-auto" />
        <div className="text-sm font-semibold text-slate-200">{t('resultEmptyTitle')}</div>
        <p className="text-xs text-ink-400 leading-6">{t('resultEmptyHint')}</p>
        <p className="text-[10px] text-ink-400 leading-5 border-t border-ink-700 pt-2 w-full">{t('autoCheckNote')}</p>
      </div>
    );
  }

  if (state.kind === 'infeasible') {
    return (
      <div className="card border-bad/40 bg-bad/5">
        <div className="flex items-center gap-2">
          <IconAlert className="w-5 h-5 text-bad" />
          <span className="text-sm font-bold text-bad">{t('resultInfeasibleTitle')}</span>
        </div>
        <p className="text-xs text-slate-300 leading-6">{t('resultInfeasibleBody')}</p>
        <Collapsible title={t('technicalDetails')} className="bg-ink-900/60 border-ink-700">
          <div className="text-xs font-semibold text-slate-300">{t('infeasibleAttemptsTitle')}</div>
          <ul className="space-y-1">
            {state.attempts.map(a => (
              <li key={a.candidateId} className="text-[11px] text-ink-400 leading-5">
                <span className="text-slate-300">{STRATEGY_FA[a.strategy] ?? a.strategy}</span>
                {' — '}
                <span className="mono ltr" dir="ltr">{a.reason}</span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-ink-400 leading-5 whitespace-pre-wrap">{state.explanation}</p>
        </Collapsible>
      </div>
    );
  }

  const ok = state.kind === 'ok';
  return (
    <div className={`card ${ok ? 'border-ok/40 bg-ok/5' : 'border-bad/40 bg-bad/5'}`}>
      <div className="flex items-center gap-2">
        {ok
          ? <IconCheckCircle className="w-5 h-5 text-ok" />
          : <IconXCircle className="w-5 h-5 text-bad" />}
        <span className={`text-sm font-bold ${ok ? 'text-ok' : 'text-bad'}`}>
          {ok ? t('validTitle') : t('invalidTitle')}
        </span>
        <span className="ms-auto text-[10px] text-ink-400">{t('resultSuccess')}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className="chip-hard">{t('badgeHard').replace('{count}', '')}: {faNum(state.vr.hard.length)}</span>
        <span className="chip-soft">{t('badgeSoft').replace('{count}', '')}: {faNum(state.vr.soft.length)}</span>
        <span className="chip-adv">{t('badgeAdv').replace('{count}', '')}: {faNum(state.vr.advisory.length)}</span>
      </div>
      <StatusNote tone="info">
        {tf('resultCandidatesNote', { count: faNum(state.candidateCount) })}
      </StatusNote>
      <StatusNote tone="info">{t('autoCheckNote')}</StatusNote>
    </div>
  );
}

/** Legend for the plan canvas — colors mirror the canvas rendering exactly. */
export function PlanLegend() {
  const items: Array<{ label: string; swatch: React.ReactNode }> = [
    { label: t('legendBuildable'), swatch: <span className="legend-swatch border-accent-400" style={{ borderStyle: 'dashed' }} /> },
    { label: t('legendRooms'), swatch: <span className="w-3 h-3 rounded-sm bg-slate-400/25 border border-slate-500 shrink-0" /> },
    { label: t('legendParking'), swatch: <span className="w-3 h-3 rounded-sm bg-ink-500/25 border border-ink-500 shrink-0" /> },
    { label: t('legendStair'), swatch: <span className="legend-swatch border-purple-400" /> },
    { label: t('legendOpenings'), swatch: <span className="legend-swatch border-emerald-400" /> },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 border-t border-ink-700 text-[10px] text-ink-400 min-w-0" aria-label={t('legendTitle')}>
      {items.map(it => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          {it.swatch}
          {it.label}
        </span>
      ))}
    </div>
  );
}
