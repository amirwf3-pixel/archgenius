/**
 * ArchGenius design-system primitives + inline icon set.
 *
 * Zero dependencies: every icon is an inline SVG sized from the current text
 * color, so state is never communicated by color alone. All form controls
 * here associate <label htmlFor> with the control id (accessibility), and
 * the CSS layer (index.css) provides default/hover/focus/active/disabled
 * states for every component.
 */
import React from 'react';
import { SEVERITY_FA, RULE_STATUS_FA, faNum } from './i18n';

// ---------------------------------------------------------------------------
// Icons (inline SVG, stroke = currentColor)
// ---------------------------------------------------------------------------

type IconProps = { className?: string };
const svg = (path: React.ReactNode, opts: IconProps = {}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={opts.className ?? 'w-4 h-4 shrink-0'}
  >
    {path}
  </svg>
);

export const IconChevron = (p: IconProps) => svg(<><path d="M6 9l6 6 6-6" /></>, p);
export const IconDownload = (p: IconProps) => svg(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></>, p);
export const IconLock = (p: IconProps) => svg(<><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>, p);
export const IconUnlock = (p: IconProps) => svg(<><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></>, p);
export const IconPlus = (p: IconProps) => svg(<><path d="M12 5v14" /><path d="M5 12h14" /></>, p);
export const IconMinus = (p: IconProps) => svg(<><path d="M5 12h14" /></>, p);
export const IconFit = (p: IconProps) => svg(<><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></>, p);
export const IconAlert = (p: IconProps) => svg(<><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>, p);
export const IconXCircle = (p: IconProps) => svg(<><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6" /><path d="M9 9l6 6" /></>, p);
export const IconCheckCircle = (p: IconProps) => svg(<><circle cx="12" cy="12" r="10" /><path d="M8 12l3 3 5-6" /></>, p);
export const IconInfo = (p: IconProps) => svg(<><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>, p);
export const IconCube = (p: IconProps) => svg(<><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></>, p);

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

/** Titled panel section with optional numbered step (main user flow). */
export function Section({
  id, title, step, children, actions,
}: { id?: string; title: string; step?: number; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section id={id} className="panel" aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="panel-header">
        {step !== undefined && (
          <span className="w-5 h-5 rounded-full bg-accent-500/20 text-accent-300 border border-accent-400/40 text-[10px] font-bold flex items-center justify-center shrink-0" aria-hidden="true">
            {faNum(step)}
          </span>
        )}
        <h2 id={id ? `${id}-title` : undefined} className="panel-header-title truncate">{title}</h2>
        {actions && <div className="ms-auto flex items-center gap-1 shrink-0">{actions}</div>}
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </section>
  );
}

/** Labelled form field wrapper — associates label/control/hint via ids. */
export function Field({
  id, label, hint, error, children, className,
}: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error
        ? <p id={`${id}-msg`} className="field-error">{error}</p>
        : hint
          ? <p id={`${id}-hint`} className="field-hint">{hint}</p>
          : null}
    </div>
  );
}

export function NumField({
  id, label, value, onChange, min, max, step = 1, disabled, hint, error, dir,
}: {
  id: string; label: string; value: number;
  onChange: (v: number) => void; min?: number; max?: number; step?: number;
  disabled?: boolean; hint?: string; error?: string; dir?: 'ltr' | 'rtl';
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <input
        id={id} type="number" dir={dir} inputMode="decimal"
        min={min} max={max} step={step} value={value} disabled={disabled}
        aria-describedby={error ? `${id}-msg` : hint ? `${id}-hint` : undefined}
        onChange={e => onChange(e.target.value === '' ? 0 : +e.target.value)}
      />
    </Field>
  );
}

export function SelectField({
  id, label, value, onChange, options, disabled, hint, dir, className,
}: {
  id: string; label: string; value: string; className?: string;
  onChange: (v: string) => void; options: Array<{ value: string; label: string }>;
  disabled?: boolean; hint?: string; dir?: 'ltr' | 'rtl';
}) {
  return (
    <Field id={id} label={label} hint={hint} className={className}>
      <select id={id} dir={dir} value={value} disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function CheckField({
  id, label, checked, onChange, disabled, title,
}: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string }) {
  return (
    <label
      htmlFor={id}
      title={title}
      className="flex items-center gap-2 text-sm text-slate-200 rounded-md px-1.5 py-1 hover:bg-ink-700/40 transition-colors cursor-pointer"
    >
      <input
        id={id} type="checkbox" checked={checked} disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 accent-blue-600 cursor-pointer disabled:cursor-not-allowed"
      />
      {label}
    </label>
  );
}

/** Collapsible (progressive disclosure). Content stays in the DOM (SSR/a11y). */
export function Collapsible({
  title, subtitle, defaultOpen = false, children, className,
}: { title: string; subtitle?: string; defaultOpen?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <details className={`disc ${className ?? ''}`} open={defaultOpen}>
      <summary>
        <IconChevron className="disc-chevron w-3.5 h-3.5" />
        <span className="truncate">{title}</span>
        {subtitle && <span className="ms-auto text-[10px] font-normal text-ink-400 truncate ltr" dir="ltr">{subtitle}</span>}
      </summary>
      <div className="disc-body">{children}</div>
    </details>
  );
}

/** Severity badge: icon + Persian term — never color alone. */
export function SeverityBadge({ severity, className }: { severity: string; className?: string }) {
  const cls = severity === 'hard' ? 'badge-hard' : severity === 'soft' ? 'badge-soft' : 'badge-adv';
  const icon = severity === 'hard'
    ? <IconXCircle className="w-3 h-3" />
    : severity === 'soft'
      ? <IconAlert className="w-3 h-3" />
      : <IconInfo className="w-3 h-3" />;
  return <span className={`${cls} ${className ?? ''}`}>{icon}{SEVERITY_FA[severity] ?? severity}</span>;
}

/**
 * Regulation rule-verification status badge (Phase 4 regulation explorer).
 *
 * Mirrors SeverityBadge's contract: icon + Persian term, never colour alone,
 * reusing the existing badge CSS classes so no new styling is introduced.
 * VERIFIED reads as source-backed; the other three are visually distinct and
 * deliberately not "ok"-coloured, so presence never implies compliance.
 *
 * Returns null when `status` is absent or empty — an unknown status must not
 * be dressed up as a verified one.
 */
export function RuleStatusBadge({ status, className }: { status?: string; className?: string }) {
  if (!status) return null;
  const cls = status === 'VERIFIED' ? 'badge-ok'
    : status === 'REQUIRES_SOURCE_VERIFICATION' ? 'badge-soft'
      : status === 'NOT_IMPLEMENTED' ? 'badge-adv'
        : 'badge-neutral';
  const icon = status === 'VERIFIED'
    ? <IconCheckCircle className="w-3 h-3" />
    : status === 'REQUIRES_SOURCE_VERIFICATION'
      ? <IconAlert className="w-3 h-3" />
      : status === 'NOT_IMPLEMENTED'
        ? <IconInfo className="w-3 h-3" />
        : <IconXCircle className="w-3 h-3" />;
  return (
    <span className={`${cls} ${className ?? ''}`} data-rule-status={status}>
      {icon}{RULE_STATUS_FA[status] ?? status}
    </span>
  );
}

/** Segmented control (e.g. floor picker). */
export function Segmented({
  ariaLabel, value, onChange, options, className,
}: {
  ariaLabel: string; value: number; onChange: (v: number) => void;
  options: Array<{ value: number; label: string }>; className?: string;
}) {
  return (
    <div className={`seg ${className ?? ''}`} role="group" aria-label={ariaLabel}>
      {options.map(o => (
        <button
          key={o.value} type="button" className="seg-item"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Metric cell (canvas footer). */
export function Metric({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="bg-ink-900 p-3 flex flex-col justify-center min-w-0">
      <div className="text-[10px] text-ink-400 truncate">{label}</div>
      <div className={`text-lg font-semibold truncate ${tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : 'text-slate-100'}`} dir="ltr">
        {value}
      </div>
    </div>
  );
}

/** Inline status line with icon + text. */
export function StatusNote({
  tone, children, className,
}: { tone: 'ok' | 'bad' | 'info' | 'busy'; children: React.ReactNode; className?: string }) {
  const icon = tone === 'ok'
    ? <IconCheckCircle className="w-3.5 h-3.5 text-ok" />
    : tone === 'bad'
      ? <IconAlert className="w-3.5 h-3.5 text-bad" />
      : tone === 'busy'
        ? <span className="spinner-accent" aria-hidden="true" />
        : <IconInfo className="w-3.5 h-3.5 text-ink-400" />;
  return (
    <p className={`flex items-start gap-1.5 text-xs leading-5 ${className ?? ''}`}>
      {icon}
      <span className="min-w-0">{children}</span>
    </p>
  );
}
