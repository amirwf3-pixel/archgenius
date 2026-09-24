/**
 * Phase 4 roadmap — Regulation Explorer (read-only).
 *
 * Surfaces the regulation packs the engine actually composes for the current
 * project, together with each rule's verification status and its source
 * references. This is a pure presentation layer over data the core already
 * exposes via `composePacks`: it adds no rule, changes no threshold, and never
 * re-derives a status.
 *
 * Trust posture (deliberate):
 *   - Only VERIFIED means a Tier-1 primary source backs the rule; it is the
 *     only status rendered in the "ok" colour.
 *   - REQUIRES_SOURCE_VERIFICATION / NOT_IMPLEMENTED / DEPRECATED are visually
 *     distinct and never styled as compliance.
 *   - A rule with no status renders no badge at all — an unknown status is
 *     never dressed up as a verified one.
 *   - Every rule of every composed pack is listed; nothing is filtered out, so
 *     the panel cannot silently under-report what the engine loaded.
 *
 * All optional fields (reference, edition, sources, clause, page, sourceTier)
 * are rendered defensively — a missing field degrades to an explicit
 * "not recorded" note rather than an empty or crashing cell.
 */
import React from 'react';
import { composePacks } from '@archgenius/core';
import type { ProjectInput } from '@archgenius/core';
import { t, tf, faNum } from './i18n';
import { Collapsible, RuleStatusBadge, StatusNote } from './components';

type Pack = ReturnType<typeof composePacks>[number];
type Rule = Pack['rules'][number];
type SourceRef = NonNullable<Rule['sources']>[number];

/** LTR island for machine text (ids, clauses, references) inside the RTL layout. */
function Ltr({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span className="ltr font-mono text-[10px] text-ink-400" dir="ltr" title={title}>
      {children}
    </span>
  );
}

function SourceLine({ src }: { src?: SourceRef }) {
  if (!src) {
    return <div className="text-[10px] text-ink-400">{t('regSourceNone')}</div>;
  }
  const bits: React.ReactNode[] = [];
  if (src.clause) bits.push(<Ltr key="c" title={t('regClause')}>{src.clause}</Ltr>);
  if (typeof src.page === 'number' && Number.isFinite(src.page)) {
    bits.push(<span key="p" className="text-[10px] text-ink-400">{t('regPage')} <Ltr>{faNum(src.page)}</Ltr></span>);
  }
  if (bits.length === 0) bits.push(<span key="n" className="text-[10px] text-ink-400">{t('regSourceNone')}</span>);
  return <div className="flex items-center gap-1.5 flex-wrap min-w-0">{bits}</div>;
}

function RuleRow({ rule }: { rule: Rule }) {
  const tier = typeof rule.sourceTier === 'number' ? rule.sourceTier : null;
  return (
    <li className="px-2 py-1.5 border-b border-ink-800 last:border-b-0" data-rule-id={rule.ruleId}>
      <div className="flex items-start gap-2 min-w-0">
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <Ltr title={rule.ruleId}>{rule.ruleId}</Ltr>
            <RuleStatusBadge status={rule.status} />
            {tier !== null && (
              <span className="badge-neutral" title={t('regSourceTier')}>
                {t('regSourceTier')} <Ltr>{`T${faNum(tier)}`}</Ltr>
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-300 leading-5">{rule.title || rule.ruleId}</div>
          {rule.reference
            ? <div className="flex items-center gap-1 min-w-0"><span className="text-[10px] text-ink-400">{t('regReference')}</span><Ltr>{rule.reference}</Ltr></div>
            : <div className="text-[10px] text-ink-400">{t('regNoReference')}</div>}
          <SourceLine src={rule.sources?.[0]} />
        </div>
      </div>
    </li>
  );
}

function PackBlock({ pack }: { pack: Pack }) {
  const verified = pack.rules.filter(r => r.status === 'VERIFIED').length;
  return (
    <Collapsible
      title={pack.jurisdiction || pack.id}
      subtitle={`${pack.id}${pack.edition ? ` · ${pack.edition}` : ''} · ${tf('regPackCount', { count: faNum(pack.rules.length) })} · ✓${faNum(verified)}`}
      defaultOpen={false}
      className="reg-pack"
    >
      {pack.rules.length === 0
        ? <div className="px-2 py-1.5 text-[11px] text-ink-400">{tf('regPackCount', { count: faNum(0) })}</div>
        : <ul className="min-w-0">{pack.rules.map(r => <RuleRow key={r.ruleId} rule={r} />)}</ul>}
    </Collapsible>
  );
}

/**
 * Read-only browser of the composed regulation packs.
 * `input` is the project the packs are composed for; when absent (nothing
 * generated yet) the panel explains itself instead of guessing a project.
 */
export function RegulationExplorer({ input }: { input?: ProjectInput | null }) {
  if (!input) {
    return <StatusNote tone="info">{t('regExplorerEmpty')}</StatusNote>;
  }
  const packs = composePacks(input);
  return (
    <div className="space-y-2 min-w-0" aria-label={t('regExplorerTitle')}>
      <StatusNote tone="info">{t('regExplorerHint')}</StatusNote>
      {packs.length === 0
        ? <StatusNote tone="info">{t('regExplorerEmpty')}</StatusNote>
        : packs.map(p => <PackBlock key={p.id} pack={p} />)}
      <StatusNote tone="bad">{t('regComplianceNote')}</StatusNote>
    </div>
  );
}
