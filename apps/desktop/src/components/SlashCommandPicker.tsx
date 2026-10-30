// Agent workflow — slash command picker (PLAN.md M18).
//
// Skills exposed as slash commands in the composer: the dropdown lists what the
// project has, filtered by what was typed after the `/`, and a click hands the
// command name back to the caller. Nothing is executed here — the registry that
// owns the commands lives in `crates/warsha-pipeline/src/agent_workflow.rs`.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';

/** One command the composer can offer. */
export interface SlashCommandItem {
  /** The command as typed, with the leading `/`. */
  name: string;
  /** One line shown under the name. */
  description: string;
}

const titleLabel: Record<Locale, string> = {
  ar: 'أوامر جاهزة',
  en: 'Slash commands',
};

const emptyLabel: Record<Locale, string> = {
  ar: 'لا يوجد أمر مطابق',
  en: 'No matching command',
};

/**
 * Translate a key, falling back to the local label when the catalog has no
 * entry yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
}

function bareName(name: string): string {
  return name.trim().replace(/^\//, '');
}

/**
 * The commands that match what was typed after the `/`, sorted by name.
 *
 * Prefix matching mirrors the Rust `SlashCommandRegistry::matching`, so the
 * dropdown and the daemon cannot disagree about what `re` offers; the leading
 * `/` is optional and the comparison is case-insensitive. Sorting is by the bare
 * name — the slash is a prefix, not part of the word — which keeps the order
 * stable between keystrokes instead of following the props order.
 */
export function filterSlashCommands(
  commands: readonly SlashCommandItem[],
  query: string
): SlashCommandItem[] {
  const wanted = bareName(query).toLowerCase();
  return commands
    .filter((command) => bareName(command.name).toLowerCase().startsWith(wanted))
    .slice()
    .sort((left, right) =>
      bareName(left.name).toLowerCase().localeCompare(bareName(right.name).toLowerCase())
    );
}

export interface SlashCommandPickerProps {
  /** Every command the project knows about. */
  commands: readonly SlashCommandItem[];
  /** Called with the command's name, with its leading `/`. */
  onSelect: (name: string) => void;
  /** What the owner typed after the `/`. */
  query?: string;
}

export function SlashCommandPicker({ commands, onSelect, query = '' }: SlashCommandPickerProps) {
  const dir = useDirection();
  const locale = useLocale();

  const title = localized('agent_workflow.slash.title', titleLabel[locale], locale);
  const empty = localized('agent_workflow.slash.empty', emptyLabel[locale], locale);
  const options = filterSlashCommands(commands, query);

  return (
    <div
      dir={dir}
      role="group"
      aria-label={title}
      data-testid="slash-command-picker"
      data-query={query}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        minWidth: '15rem',
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
          data-testid="slash-command-picker-empty"
          style={{ margin: 0, paddingInline: '8px', paddingBlock: '4px', color: '#6b7280' }}
        >
          {empty}
        </p>
      ) : (
        options.map((command) => (
          <button
            key={command.name}
            type="button"
            data-command={command.name}
            title={command.description}
            onClick={() => onSelect(command.name)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: '1px',
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
                fontWeight: 600,
                unicodeBidi: 'isolate',
              }}
            >
              {command.name}
            </span>
            <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>{command.description}</span>
          </button>
        ))
      )}
    </div>
  );
}
