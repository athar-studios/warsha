// Roles settings — the routing table, as a ledger with an inline editor (PLAN.md M10, redrawn for Bench &
// Signal in B3-secondary).
//
// REDESIGN §5 gives the roles screen "roles routing table as ledger rows (provider/model/weight), edit
// inline". What it had was a column of cards, three invented provider names, and a save that wrote to no
// daemon at all.
//
// What the direction asks of this file:
//
//   * one ruled row per role, the role's word in the catalog's plain language (§3's first rung) and the
//     routing targets as machine data: `provider/model` in mono, isolated, tabular weights (§11);
//   * no lamp at all: a role that is not configured is not waiting on the owner's hand in the way a gate
//     is — it is a piece of configuration, and the `غير مهيأ` word plus the `تهيئة` button say it (§1);
//   * the editor is a plate under the row it edits, not a modal, and it writes through
//     `roles.set-config` for real, reporting what the daemon said (§7);
//   * every word comes from `@warsha/i18n`: the `ROLE_LABELS` table and the thirty-odd
//     `locale === 'ar' ? … : …` branches AUDIT-1 §3.3 counted here are gone.
import { type ProviderConfig, type Role, type RoleRoutingConfig, type WarshaClient } from '@warsha/client';
import { t, useDirection, useLocale, type MessageValues } from '@warsha/i18n';
import {
  Banner,
  Box,
  Button,
  Chip,
  Field,
  Ledger,
  Panel,
  Skeleton,
  Stamp,
  Text,
  fieldControl,
} from '@warsha/ui';
import React, { useCallback, useEffect, useState } from 'react';

interface RolesSettingsProps {
  client: WarshaClient;
  onBack: () => void;
}

/** The roles the pipeline can route, in the order the owner reads them. */
const ROLES: readonly Role[] = [
  'intake',
  'researcher',
  'pm',
  'designer',
  'architect',
  'coder',
  'reviewer',
  'qa',
  'security',
  'release',
  'marketer',
  'feedback',
];

/** One target as the editor holds it — the wire shape is `RoutingTargetConfig`. */
interface TargetDraft {
  provider: string;
  model: string;
  weight: number;
}

export function RolesSettings({ client, onBack }: RolesSettingsProps) {
  const dir = useDirection();
  const locale = useLocale();

  const [routing, setRouting] = useState<Record<string, RoleRoutingConfig>>({});
  /**
   * The roles the ledger rules, in pipeline order.
   *
   * `roles.list` is the answer when the daemon gives one; the twelve this build knows are the fallback, so
   * an unresponsive daemon still shows the owner the whole table with its retry banner above it (§7).
   */
  const [roleList, setRoleList] = useState<readonly Role[]>(ROLES);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Role | null>(null);
  const [targets, setTargets] = useState<TargetDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const label = useCallback((key: string, values?: MessageValues) => t(key, values ?? {}, locale), [locale]);

  // The routing table and the provider list are read together: the editor offers the providers the daemon
  // actually knows, never a made-up shortlist (§7: no promise the bench cannot keep).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      let known: ProviderConfig[] = [];
      let table: [Role, RoleRoutingConfig | null][] | null = null;
      try {
        known = await client.listProviders();
      } catch {
        known = [];
      }
      try {
        const roles = await client.listRoles();
        const known = roles.length > 0 ? roles : [...ROLES];
        const settled = await Promise.all(
          known.map(async (role): Promise<[Role, RoleRoutingConfig | null]> => {
            try {
              return [role, await client.getRoleConfig(role)];
            } catch {
              return [role, null];
            }
          })
        );
        table = settled;
        setRoleList(known);
      } catch {
        table = null;
      }

      if (cancelled) return;
      if (table === null) {
        setFailed(true);
        setRouting({});
      } else {
        setFailed(false);
        setRouting(
          Object.fromEntries(table.filter((entry): entry is [Role, RoleRoutingConfig] => entry[1] !== null))
        );
      }
      setProviders(known);
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [client, reload]);

  const startEdit = (role: Role) => {
    const config = routing[role];
    setEditing(role);
    setSaved(null);
    setSaveError(null);
    setTargets(
      config
        ? config.targets.map((target) => ({ provider: target.provider_id, model: target.model_id, weight: target.weight }))
        : [{ provider: providers[0]?.name ?? '', model: '', weight: 100 }]
    );
  };

  const addTarget = () =>
    setTargets((previous) => [...previous, { provider: providers[0]?.name ?? '', model: '', weight: 100 }]);

  const removeTarget = (index: number) =>
    setTargets((previous) => previous.filter((_, position) => position !== index));

  const save = async () => {
    if (editing === null) return;
    setSaving(true);
    setSaveError(null);
    const previous = routing[editing];
    const config: RoleRoutingConfig = {
      role: editing,
      targets: targets.map((target) => ({ provider_id: target.provider, model_id: target.model, weight: target.weight })),
      fallback_enabled: previous?.fallback_enabled ?? true,
      budget_cents_per_run: previous?.budget_cents_per_run ?? 500,
    };
    try {
      await client.setRoleConfig(config);
      setRouting((current) => ({ ...current, [editing]: config }));
      setSaved(label(`role.${editing}`));
      setEditing(null);
    } catch {
      // The row stays, the error stays beside it, and the owner's words are not thrown away (§7).
      setSaveError(label('roles.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box
      dir={dir}
      className="roles-settings"
      style={{
        paddingInline: 'var(--warsha-space-6)',
        paddingBlock: 'var(--warsha-space-6)',
        minHeight: 'calc(100vh - 80px)',
        maxInlineSize: '1000px',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-4)',
        minInlineSize: 0,
      }}
    >
      <header dir={dir} style={{ minInlineSize: 0 }}>
        <Button variant="ghost" size="sm" dir={dir} onClick={onBack} style={{ paddingInlineStart: 0 }}>
          {label('common.back')}
        </Button>
        <h1
          dir={dir}
          style={{
            margin: 0,
            fontSize: 'var(--warsha-font-size-xl)',
            fontWeight: 'var(--warsha-font-weight-bold)',
            color: 'var(--warsha-color-text)',
          }}
        >
          {label('roles.title')}
        </h1>
        <Text size="sm" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
          {label('roles.desc')}
        </Text>
      </header>

      {failed && (
        <Banner
          tone="error"
          action={
            <Button variant="secondary" size="sm" dir={dir} onClick={() => setReload((n) => n + 1)}>
              {label('common.retry')}
            </Button>
          }
        >
          {label('roles.failed')}
        </Banner>
      )}

      {saved && (
        <Box dir={dir}>
          <Stamp tone="ok">{`${saved} — ${label('roles.saved')}`}</Stamp>
        </Box>
      )}

      {loading ? (
        <Box dir={dir} p={4}>
          <Skeleton label={label('roles.loading')} variant="row" lines={6} />
        </Box>
      ) : (
        <>
          {editing !== null && (
            <Panel title={`${label('roles.editing')} — ${label(`role.${editing}`)}`} label={label('roles.editing')}>
              <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-4)' }}>
                <Text size="sm" dir={dir}>
                  {label('roles.targets')}
                </Text>

                {targets.map((target, index) => (
                  <Box
                    key={`${editing}-${index}`}
                    dir={dir}
                    style={{
                      display: 'flex',
                      gap: 'var(--warsha-space-3)',
                      alignItems: 'flex-end',
                      flexWrap: 'wrap',
                      paddingBlockStart: 'var(--warsha-space-2)',
                      borderBlockStart: '1px solid var(--warsha-bench-rule)',
                      minInlineSize: 0,
                    }}
                  >
                    <Field
                      id={`role-target-provider-${index}`}
                      label={label('roles.provider')}
                      style={{ flex: '1 1 12rem', marginBlockEnd: 0 }}
                    >
                      <select
                        {...fieldControl(`role-target-provider-${index}`)}
                        dir={dir}
                        value={target.provider}
                        onChange={(event) =>
                          setTargets((previous) =>
                            previous.map((row, position) =>
                              position === index ? { ...row, provider: event.target.value } : row
                            )
                          )
                        }
                      >
                        {target.provider === '' && <option value="">{label('providers.select_type')}</option>}
                        {providers.map((provider) => (
                          <option key={provider.name} value={provider.name}>
                            {provider.name}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field
                      id={`role-target-model-${index}`}
                      label={label('roles.model')}
                      style={{ flex: '1 1 12rem', marginBlockEnd: 0 }}
                    >
                      <input
                        {...fieldControl(`role-target-model-${index}`)}
                        dir="ltr"
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={label('roles.model_placeholder')}
                        value={target.model}
                        onChange={(event) =>
                          setTargets((previous) =>
                            previous.map((row, position) =>
                              position === index ? { ...row, model: event.target.value } : row
                            )
                          )
                        }
                      />
                    </Field>

                    <Field
                      id={`role-target-weight-${index}`}
                      label={label('roles.weight')}
                      hint={label('roles.weight_hint')}
                      style={{ flex: '0 0 7rem', marginBlockEnd: 0 }}
                    >
                      <input
                        {...fieldControl(`role-target-weight-${index}`, { hint: true })}
                        dir="ltr"
                        type="number"
                        min="1"
                        max="100"
                        value={target.weight}
                        onChange={(event) =>
                          setTargets((previous) =>
                            previous.map((row, position) =>
                              position === index
                                ? { ...row, weight: Number(event.target.value) || 100 }
                                : row
                            )
                          )
                        }
                      />
                    </Field>

                    <Button
                      variant="ghost"
                      size="sm"
                      dir={dir}
                      disabled={targets.length === 1}
                      onClick={() => removeTarget(index)}
                    >
                      {label('roles.remove_target')}
                    </Button>
                  </Box>
                ))}

                <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', flexWrap: 'wrap' }}>
                  <Button variant="ghost" size="sm" dir={dir} onClick={addTarget}>
                    {label('roles.add_target')}
                  </Button>
                </Box>

                {saveError && <Banner tone="error">{saveError}</Banner>}

                <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <Button variant="secondary" dir={dir} onClick={() => setEditing(null)}>
                    {label('common.cancel')}
                  </Button>
                  <Button variant="primary" dir={dir} disabled={saving} onClick={() => void save()}>
                    {saving ? label('roles.saving') : label('roles.save')}
                  </Button>
                </Box>
              </Box>
            </Panel>
          )}

          <Ledger label={label('roles.title')} recessed>
            {roleList.map((role) => {
              const config = routing[role];
              const targets = config?.targets ?? [];
              return (
                <Ledger.Row
                  key={role}
                  meta={
                    targets.length > 0 ? (
                      <Chip label={label('roles.targets')}>
                        {label('roles.target_count', { count: targets.length })}
                      </Chip>
                    ) : null
                  }
                  actions={
                    // Secondary on every row: nine lit buttons would be decoration, and the lamp is the
                    // owner's queue alone (§1). The word `تهيئة` / `تعديل` is what says which is which.
                    <Button variant="secondary" size="sm" dir={dir} onClick={() => startEdit(role)}>
                      {label(config ? 'roles.edit' : 'roles.configure')}
                    </Button>
                  }
                >
                  <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-1)', minInlineSize: 0 }}>
                    <Text size="sm" weight="medium" dir={dir}>
                      {label(`role.${role}`)}
                    </Text>
                    {targets.length === 0 ? (
                      // Not configured is a word and a button, never a colour (§9).
                      <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
                        {label('roles.not_configured')}
                      </Text>
                    ) : (
                      <Box dir={dir} style={{ display: 'inline-flex', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
                        {targets.map((target) => (
                          <span
                            key={`${target.provider_id}-${target.model_id}`}
                            dir="ltr"
                            translate="no"
                            style={{
                              fontFamily: 'var(--warsha-font-mono)',
                              fontVariantNumeric: 'tabular-nums',
                              unicodeBidi: 'isolate',
                              fontSize: 'var(--warsha-font-size-xs)',
                              color: 'var(--warsha-color-text)',
                              border: '1px solid var(--warsha-bench-edge)',
                              borderRadius: 'var(--warsha-radius-sm)',
                              paddingInline: 'var(--warsha-space-2)',
                              paddingBlock: '2px',
                            }}
                          >
                            {`${target.provider_id}/${target.model_id} · ${target.weight}`}
                          </span>
                        ))}
                      </Box>
                    )}
                  </Box>
                </Ledger.Row>
              );
            })}
          </Ledger>
        </>
      )}
    </Box>
  );
}
