// Agent workflow — mention picker (PLAN.md M18).
//
// The dropdown the composer opens when the owner types `@`: one row per mention
// kind, filtered by what was typed after the `@`. Selecting a kind calls back
// with it; resolving the target and attaching the file contents is the caller's
// job (the Rust `MentionParser` reads the same kinds out of the finished text).
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';

/** Every mention kind, in the order the picker lists them. */
export const mentionKinds = ['file', 'folder', 'codebase', 'terminal', 'web', 'docs'] as const;

/** One mention kind. */
export type MentionKind = (typeof mentionKinds)[number];

const labels: Record<MentionKind, Record<Locale, string>> = {
  file: { ar: 'ملف', en: 'File' },
  folder: { ar: 'مجلد', en: 'Folder' },
  codebase: { ar: 'المشروع كله', en: 'Codebase' },
  terminal: { ar: 'الطرفية', en: 'Terminal' },
  web: { ar: 'صفحة ويب', en: 'Web page' },
  docs: { ar: 'التوثيق', en: 'Docs' },
};

const hints: Record<MentionKind, Record<Locale, string>> = {
  file: { ar: 'أرفق ملفًا واحدًا بمساره', en: 'Attach one file by path' },
  folder: { ar: 'أرفق مجلدًا كاملًا', en: 'Attach a whole folder' },
  codebase: { ar: 'أرفق ملخّص المشروع كله', en: 'Attach an overview of the whole project' },
  terminal: { ar: 'أرفق مخرجات الطرفية الأخيرة', en: 'Attach the recent terminal output' },
  web: { ar: 'أرفق صفحة ويب بعنوانها', en: 'Attach a web page by its address' },
  docs: { ar: 'أرفق فصلًا من التوثيق', en: 'Attach a documentation chapter' },
};

const titleLabel: Record<Locale, string> = {
  ar: 'إرفاق سياق',
  en: 'Attach context',
};

const emptyLabel: Record<Locale, string> = {
  ar: 'لا يوجد نوع مطابق',
  en: 'No matching mention',
};

/**
 * Translate a key, falling back to the local label when the catalog has no
 * entry yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
}

/**
 * The kinds that match what was typed after the `@`.
 *
 * A leading `@` is accepted so the caller can pass the raw fragment, and an
 * empty query lists every kind — which is what opening the picker on a bare `@`
 * should do. Prefix matching, not substring: `@fi` narrows to `file`, while `@i`
 * would otherwise match two unrelated kinds.
 */
export function filterMentionKinds(query: string): MentionKind[] {
  const wanted = query.trim().replace(/^@/, '').toLowerCase();
  return mentionKinds.filter((kind) => kind.startsWith(wanted));
}

export interface MentionPickerProps {
  /** Called with the picked kind — the caller inserts `@kind`. */
  onSelect: (kind: MentionKind) => void;
  /** What the owner typed after the `@`, e.g. `fi`. */
  query?: string;
}

export function MentionPicker({ onSelect, query = '' }: MentionPickerProps) {
  const dir = useDirection();
  const locale = useLocale();

  const title = localized('agent_workflow.mention.title', titleLabel[locale], locale);
  const empty = localized('agent_workflow.mention.empty', emptyLabel[locale], locale);
  const options = filterMentionKinds(query);

  return (
    <div
      dir={dir}
      role="group"
      aria-label={title}
      data-testid="mention-picker"
      data-query={query}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        minWidth: '13rem',
        paddingInline: '6px',
        paddingBlock: '6px',
        borderRadius: '10px',
        border: '1px solid #e5e7eb',
        backgroundColor: '#ffffff',
        boxShadow: '0 6px 20px rgba(14, 14, 14, 0.08)',
      }}
    >
      {options.length === 0 ? (
        <p
          data-testid="mention-picker-empty"
          style={{ margin: 0, paddingInline: '8px', paddingBlock: '4px', color: '#6b7280' }}
        >
          {empty}
        </p>
      ) : (
        options.map((kind) => {
          const label = localized(`agent_workflow.mention.${kind}`, labels[kind][locale], locale);
          const hint = localized(
            `agent_workflow.mention_hint.${kind}`,
            hints[kind][locale],
            locale
          );

          return (
            <button
              key={kind}
              type="button"
              data-kind={kind}
              title={hint}
              onClick={() => onSelect(kind)}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '8px',
                paddingInline: '8px',
                paddingBlock: '5px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: 'transparent',
                color: '#0E0E0E',
                textAlign: 'start',
                cursor: 'pointer',
                fontSize: '0.8125rem',
              }}
            >
              <span
                dir="ltr"
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  color: '#374151',
                  unicodeBidi: 'isolate',
                }}
              >
                @{kind}
              </span>
              <span style={{ color: '#4b5563' }}>{label}</span>
            </button>
          );
        })
      )}
    </div>
  );
}
