// Settings → Skills (PLAN.md Wave 2): the bundled instruction packs, wired to `skills.*`.
//
// The twelve open-source skills this build ships (eight from obra/superpowers, four from
// anthropics/skills) are read from the daemon through `skills.list`; a daemon that does not
// answer still shows the owner the bundled catalogue with the failure said in words (§7).
//
// The screen keeps the bench's rules:
//
//   * skill names, sources, licenses, tags and prompt bodies are machine data (§11): rendered
//     as the daemon wrote them, in mono or LTR where that reads true;
//   * the only words the catalog owns are the UI labels (`skills.*`), never a row's content;
//   * toggles land on the daemon (`skills.toggle`), and the row adopts the daemon's answer,
//     not an optimistic guess;
//   * imports assemble a SKILL.md front matter + body and land on `skills.import`, never in
//     browser storage; the import hint says URLs are not fetched so nothing is promised.
import { type ProjectSummary, type SkillDefinition, type WarshaClient } from '@warsha/client';
import { t, useDirection, useLocale, type MessageValues } from '@warsha/i18n';
import {
  Banner,
  Box,
  Button,
  Chip,
  EmptyState,
  Field,
  Lamp,
  Ledger,
  Panel,
  Skeleton,
  Stamp,
  Text,
  fieldControl,
  SettingsScopeSentence,
} from '@warsha/ui';
import React, { useCallback, useEffect, useState } from 'react';

interface SkillsSettingsProps {
  client: WarshaClient;
  project?: ProjectSummary | null;
}

/** The bundled catalogue this build ships, sources and licenses intact — the fallback reading. */
const BUNDLED_SKILLS: readonly {
  id: string;
  name: string;
  source: 'superpowers' | 'anthropic';
}[] = [
  { id: 'brainstorming', name: 'Brainstorming', source: 'superpowers' },
  { id: 'writing-plans', name: 'Writing Plans', source: 'superpowers' },
  { id: 'test-driven-development', name: 'Test-Driven Development', source: 'superpowers' },
  { id: 'systematic-debugging', name: 'Systematic Debugging', source: 'superpowers' },
  { id: 'verification-before-completion', name: 'Verification Before Completion', source: 'superpowers' },
  { id: 'using-git-worktrees', name: 'Using Git Worktrees', source: 'superpowers' },
  { id: 'requesting-code-review', name: 'Requesting Code Review', source: 'superpowers' },
  { id: 'dispatching-parallel-agents', name: 'Dispatching Parallel Agents', source: 'superpowers' },
  { id: 'webapp-testing', name: 'Webapp Testing', source: 'anthropic' },
  { id: 'mcp-builder', name: 'MCP Builder', source: 'anthropic' },
  { id: 'skill-creator', name: 'Skill Creator', source: 'anthropic' },
  { id: 'frontend-design', name: 'Frontend Design', source: 'anthropic' },
];

const SUPERPOWERS_SOURCE = 'github.com/obra/superpowers';
const ANTHROPIC_SOURCE = 'github.com/anthropics/skills';

function bundledSkills(): SkillDefinition[] {
  return BUNDLED_SKILLS.map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: '',
    source: entry.source === 'superpowers' ? SUPERPOWERS_SOURCE : ANTHROPIC_SOURCE,
    license: entry.source === 'superpowers' ? 'MIT' : 'Apache-2.0',
    content: '',
    enabled: true,
    tags: [],
  }));
}

export function SkillsSettings({ client, project }: SkillsSettingsProps) {
  const dir = useDirection();
  const locale = useLocale();

  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [showImport, setShowImport] = useState(false);
  const [draft, setDraft] = useState({ name: '', description: '', prompt: '', content: '' });
  const [importing, setImporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  const [openContent, setOpenContent] = useState<Record<string, boolean>>({});

  const label = useCallback((key: string, values?: MessageValues) => t(key, values ?? {}, locale), [locale]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      let answer: SkillDefinition[] | null = null;
      try {
        answer = await client.listSkills();
      } catch {
        answer = null;
      }
      if (cancelled) return;
      if (answer === null) {
        // §7: the failure is said, and the bundled catalogue is what the owner still gets to read.
        setFailed(true);
        setSkills(bundledSkills());
      } else {
        setFailed(false);
        setSkills(answer);
      }
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [client, reload]);

  const toggle = async (skill: SkillDefinition) => {
    setActionError(null);
    try {
      const updated = await client.toggleSkill(skill.id, !skill.enabled);
      setSkills((previous) => previous.map((row) => (row.id === updated.id ? updated : row)));
    } catch {
      // the row keeps the daemon's last known state; the failure is said once, plainly (§7).
      setActionError(label('skills.failed'));
    }
  };

  const importSkill = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.name.trim() === '' || draft.content.trim() === '') return;
    setImporting(true);
    setActionError(null);
    const frontMatter =
      `---\nname: ${draft.name.trim()}\n` +
      (draft.description.trim() === '' ? '' : `description: ${draft.description.trim()}\n`) +
      '---\n\n';
    const promptSection =
      draft.prompt.trim() === '' ? '' : `## Prompt template\n\n${draft.prompt.trim()}\n\n`;
    try {
      const created = await client.importSkill(frontMatter + promptSection + draft.content, draft.name.trim());
      setSkills((previous) => [...previous, created]);
      setImported(created.name);
      setShowImport(false);
      setDraft({ name: '', description: '', prompt: '', content: '' });
    } catch (error) {
      setActionError(
        error instanceof Error && error.message.length > 0 ? error.message : label('skills.import_failed')
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <Box
      dir={dir}
      className="skills-settings"
      data-testid="settings-skills"
      style={{
        paddingInline: 'var(--warsha-space-4)',
        paddingBlock: 'var(--warsha-space-4)',
        maxInlineSize: '900px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-4)',
        minInlineSize: 0,
      }}
    >
      <header dir={dir} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--warsha-space-4)', flexWrap: 'wrap' }}>
        <Box dir={dir} style={{ flex: '1', minInlineSize: 0 }}>
          <h1
            dir={dir}
            style={{
              margin: 0,
              fontSize: 'var(--warsha-font-size-xl)',
              fontWeight: 'var(--warsha-font-weight-bold)',
              color: 'var(--warsha-color-text)',
            }}
          >
            {label('skills.title')}
          </h1>
          <Text size="sm" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
            {label('skills.desc')}
          </Text>
        </Box>
        <Button
          variant={showImport ? 'secondary' : 'primary'}
          dir={dir}
          aria-expanded={showImport}
          data-testid="skills-import-open"
          onClick={() => {
            setShowImport((open) => !open);
            setActionError(null);
          }}
        >
          {label('skills.import')}
        </Button>
      </header>

      {/* Settings scope sentence (t3code pattern): shows whether these settings apply globally or to a specific project */}
      <Box dir={dir} style={{ paddingInline: 'var(--warsha-space-4)', paddingBlock: 'var(--warsha-space-2)' }}>
        <SettingsScopeSentence project={project} dir={dir} />
      </Box>

      {failed && (
        <Banner
          tone="error"
          action={
            <Button variant="secondary" size="sm" dir={dir} onClick={() => setReload((n) => n + 1)}>
              {label('common.retry')}
            </Button>
          }
        >
          {label('skills.failed')}
        </Banner>
      )}

      {imported && (
        <Box dir={dir}>
          <Stamp tone="ok">{label('skills.import_done', { name: imported })}</Stamp>
        </Box>
      )}

      {showImport && (
        <Panel title={label('skills.import_title')} label={label('skills.import_title')}>
          <form onSubmit={importSkill} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
            <Field id="skills-import-name" label={label('skills.import_name')} required>
              <input
                {...fieldControl('skills-import-name')}
                dir="ltr"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                style={{ fontFamily: 'var(--warsha-font-mono)' }}
              />
            </Field>

            <Field id="skills-import-description" label={label('skills.import_description')}>
              <input
                {...fieldControl('skills-import-description')}
                dir="ltr"
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </Field>

            <Field id="skills-import-prompt" label={label('skills.import_prompt')}>
              <textarea
                {...fieldControl('skills-import-prompt')}
                dir="ltr"
                rows={3}
                spellCheck={false}
                value={draft.prompt}
                onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
                style={{ fontFamily: 'var(--warsha-font-mono)', minInlineSize: 0 }}
              />
            </Field>

            <Field id="skills-import-content" label={label('skills.import_content')} hint={label('skills.import_hint')} required>
              <textarea
                {...fieldControl('skills-import-content', { hint: true })}
                dir="ltr"
                rows={6}
                spellCheck={false}
                value={draft.content}
                onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                style={{ fontFamily: 'var(--warsha-font-mono)', minInlineSize: 0 }}
              />
            </Field>

            {actionError && <Banner tone="error">{actionError}</Banner>}

            <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button type="button" variant="secondary" dir={dir} onClick={() => setShowImport(false)}>
                {label('common.cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                dir={dir}
                disabled={importing || draft.name.trim() === '' || draft.content.trim() === ''}
              >
                {label('skills.import_submit')}
              </Button>
            </Box>
          </form>
        </Panel>
      )}

      {loading ? (
        <Box dir={dir} p={4}>
          <Skeleton label={label('skills.loading')} variant="row" lines={6} />
        </Box>
      ) : skills.length === 0 ? (
        <EmptyState
          title={label('skills.empty')}
          action={
            <Button variant="primary" dir={dir} onClick={() => setShowImport(true)}>
              {label('skills.import')}
            </Button>
          }
        />
      ) : (
        <Ledger label={label('skills.bundled')} recessed>
          {skills.map((skill) => {
            const contentOpen = openContent[skill.id] === true;
            return (
              <Ledger.Row
                key={skill.id}
                selected={skill.enabled}
                meta={
                  <Chip label={label(skill.enabled ? 'skills.enabled' : 'skills.disabled')}>
                    {label(skill.enabled ? 'skills.enabled' : 'skills.disabled')}
                  </Chip>
                }
                actions={
                  <Button
                    variant={skill.enabled ? 'ghost' : 'secondary'}
                    size="sm"
                    dir={dir}
                    aria-label={`${label('skills.toggle')} — ${skill.name}`}
                    data-testid={`skill-toggle-${skill.id}`}
                    onClick={() => void toggle(skill)}
                  >
                    {label('skills.toggle')}
                  </Button>
                }
              >
                <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)', minInlineSize: 0 }}>
                  <Box dir={dir} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
                    <Text size="sm" weight="medium" dir={dir}>
                      {skill.name}
                    </Text>
                    <span dir="ltr" translate="no" style={{ fontFamily: 'var(--warsha-font-mono)', fontSize: 'var(--warsha-font-size-xs)' }}>
                      {skill.id}
                    </span>
                    {skill.enabled ? (
                      <Lamp state="ok" size="xs">
                        {label('skills.enabled')}
                      </Lamp>
                    ) : null}
                  </Box>

                  {skill.description.length > 0 && (
                    <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
                      {skill.description}
                    </Text>
                  )}

                  {/* provenance (§11): the machine writes these, the screen only labels them. */}
                  <Box dir={dir} style={{ display: 'inline-flex', gap: 'var(--warsha-space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
                    <Text size="xs" dir="ltr" style={{ fontFamily: 'var(--warsha-font-mono)' }}>
                      {`${label('skills.source')}: ${skill.source}`}
                    </Text>
                    <Text size="xs" dir="ltr" style={{ fontFamily: 'var(--warsha-font-mono)' }}>
                      {`${label('skills.license')}: ${skill.license}`}
                    </Text>
                  </Box>

                  {skill.tags.length > 0 && (
                    <Box dir={dir} style={{ display: 'inline-flex', gap: 'var(--warsha-space-1)', flexWrap: 'wrap', alignItems: 'center' }}>
                      <Text size="xs" dir={dir}>
                        {label('skills.tags')}:
                      </Text>
                      {skill.tags.map((tag) => (
                        <Chip key={tag} label={tag}>
                          <span dir="ltr" translate="no">
                            {tag}
                          </span>
                        </Chip>
                      ))}
                    </Box>
                  )}

                  {skill.content.length > 0 && (
                    <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-1)', minInlineSize: 0 }}>
                      <Button
                        variant="ghost"
                        size="sm"
                        dir={dir}
                        aria-expanded={contentOpen}
                        aria-controls={`skill-prompt-${skill.id}`}
                        data-testid={`skill-content-${skill.id}`}
                        onClick={() =>
                          setOpenContent((previous) => ({ ...previous, [skill.id]: !(previous[skill.id] === true) }))
                        }
                      >
                        {label(contentOpen ? 'skills.content_hide' : 'skills.content_show')}
                      </Button>
                      {contentOpen && (
                        <pre
                          id={`skill-prompt-${skill.id}`}
                          dir="ltr"
                          translate="no"
                          data-testid={`skill-prompt-${skill.id}`}
                          style={{
                            margin: 0,
                            fontFamily: 'var(--warsha-font-mono)',
                            fontSize: 'var(--warsha-font-size-xs)',
                            whiteSpace: 'pre-wrap',
                            padding: 'var(--warsha-space-2)',
                            background: 'var(--warsha-color-surface-raised)',
                            borderRadius: 'var(--warsha-radius-sm)',
                            overflowX: 'auto',
                          }}
                        >
                          {skill.content}
                        </pre>
                      )}
                    </Box>
                  )}
                </Box>
              </Ledger.Row>
            );
          })}
        </Ledger>
      )}
    </Box>
  );
}
