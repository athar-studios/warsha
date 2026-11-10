import {
  ALL_ROLES,
  type CustomModelRecord,
  type Role,
  type RoleRouting,
  type WarshaEvent,
} from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
// eslint-disable-next-line import/no-unresolved
import { IconButton, IconCheck, RoleMark, Select, StatusPill, type StatusPillState } from '@warsha/ui/v3';
import React, { useState } from 'react';

import {
  aggregateRoleMetrics,
  formatCentsAsUsd,
  getStatusLabelKey,
  mapRoleToMark,
} from '../helpers';

export interface TeamTabProps {
  roles: RoleRouting[];
  models: CustomModelRecord[];
  events: WarshaEvent[];
  onSetRoleModel: (role: Role, providerId: string, modelId: string) => Promise<void> | void;
}

export const TeamTab: React.FC<TeamTabProps> = ({
  roles,
  models,
  events,
  onSetRoleModel,
}) => {
  const t = useT();
  const metrics = aggregateRoleMetrics(events);
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>({});

  // Build available model options strictly from daemon-reported models and active routings
  const modelOptionsMap = new Map<string, { value: string; label: string; providerId: string; modelId: string }>();
  for (const m of models) {
    const key = `${m.provider}::${m.modelId}`;
    modelOptionsMap.set(key, {
      value: key,
      label: m.displayName ? `${m.displayName} (${m.modelId})` : `${m.provider}/${m.modelId}`,
      providerId: m.provider,
      modelId: m.modelId,
    });
  }
  for (const r of roles) {
    for (const tgt of r.targets) {
      const key = `${tgt.provider_id}::${tgt.model_id}`;
      if (!modelOptionsMap.has(key)) {
        modelOptionsMap.set(key, {
          value: key,
          label: `${tgt.provider_id}/${tgt.model_id}`,
          providerId: tgt.provider_id,
          modelId: tgt.model_id,
        });
      }
    }
  }

  const allOptions = [
    { value: '', label: t('bench.team.unrouted') },
    ...Array.from(modelOptionsMap.values()).map((o) => ({ value: o.value, label: o.label })),
  ];

  const handleApplyModel = (role: Role, overrideKey?: string) => {
    const routing = roles.find((r) => r.role === role);
    const primaryTarget = routing?.targets[0];
    const defaultKey = primaryTarget ? `${primaryTarget.provider_id}::${primaryTarget.model_id}` : '';
    const key = overrideKey ?? selectedModels[role] ?? defaultKey;
    const opt = modelOptionsMap.get(key);
    if (opt) {
      void onSetRoleModel(role, opt.providerId, opt.modelId);
    }
  };

  return (
    <div
      role="tabpanel"
      id="bench-panel-team"
      aria-labelledby="bench-tab-team"
      data-testid="bench-tabpanel-team"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w-space-3)',
      }}
    >
      <div
        style={{
          width: '100%',
          overflowX: 'auto',
          border: 'var(--w-border-width) solid var(--w-line)',
          borderRadius: 'var(--w-radius-md)',
          backgroundColor: 'var(--w-surface)',
          boxSizing: 'border-box',
        }}
      >
        <table
          aria-label={t('bench.team.title')}
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: 'var(--w-font-sans)',
            fontSize: 'var(--w-table-text-size)',
            lineHeight: 'var(--w-table-line-height)',
            textAlign: 'start',
          }}
        >
          <thead>
            <tr
              style={{
                backgroundColor: 'var(--w-sunken)',
                borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
              }}
            >
              <th
                scope="col"
                style={{
                  paddingBlock: 'var(--w-space-2)',
                  paddingInline: 'var(--w-space-3)',
                  color: 'var(--w-text-muted)',
                  fontWeight: 'var(--w-font-weight-semibold)',
                  textAlign: 'start',
                }}
              >
                {t('bench.team.th_role')}
              </th>
              <th
                scope="col"
                style={{
                  paddingBlock: 'var(--w-space-2)',
                  paddingInline: 'var(--w-space-3)',
                  color: 'var(--w-text-muted)',
                  fontWeight: 'var(--w-font-weight-semibold)',
                  textAlign: 'start',
                }}
              >
                {t('bench.team.th_status')}
              </th>
              <th
                scope="col"
                style={{
                  paddingBlock: 'var(--w-space-2)',
                  paddingInline: 'var(--w-space-3)',
                  color: 'var(--w-text-muted)',
                  fontWeight: 'var(--w-font-weight-semibold)',
                  textAlign: 'start',
                }}
              >
                {t('bench.team.th_model')}
              </th>
              <th
                scope="col"
                style={{
                  paddingBlock: 'var(--w-space-2)',
                  paddingInline: 'var(--w-space-3)',
                  color: 'var(--w-text-muted)',
                  fontWeight: 'var(--w-font-weight-semibold)',
                  textAlign: 'start',
                }}
              >
                {t('bench.team.th_tokens')}
              </th>
              <th
                scope="col"
                style={{
                  paddingBlock: 'var(--w-space-2)',
                  paddingInline: 'var(--w-space-3)',
                  color: 'var(--w-text-muted)',
                  fontWeight: 'var(--w-font-weight-semibold)',
                  textAlign: 'start',
                }}
              >
                {t('bench.team.th_cost')}
              </th>
            </tr>
          </thead>

          <tbody>
            {ALL_ROLES.map((role) => {
              const routing = roles.find((r) => r.role === role);
              const primaryTarget = routing?.targets[0];
              const defaultKey = primaryTarget
                ? `${primaryTarget.provider_id}::${primaryTarget.model_id}`
                : '';
              const currentValue = selectedModels[role] ?? defaultKey;

              const m = metrics[role];
              let statusState: StatusPillState = 'idle';
              let statusRaw = 'idle';
              if (m?.latestKind === 'error') {
                statusState = 'failed';
                statusRaw = 'failed';
              } else if (m?.latestKind === 'tool_call' || m?.latestKind === 'agent_step') {
                statusState = 'running';
                statusRaw = 'running';
              } else if (m?.latestKind === 'tool_result') {
                statusState = 'done';
                statusRaw = 'done';
              }

              return (
                <tr
                  key={role}
                  data-role-row={role}
                  style={{
                    borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
                  }}
                >
                  <td
                    style={{
                      paddingBlock: 'var(--w-space-2)',
                      paddingInline: 'var(--w-space-3)',
                    }}
                  >
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--w-space-2)' }}>
                      <RoleMark role={mapRoleToMark(role)} showLabel={false} size="sm" />
                      <span>{t(`bench.role.${role}`)}</span>
                    </div>
                  </td>

                  <td
                    style={{
                      paddingBlock: 'var(--w-space-2)',
                      paddingInline: 'var(--w-space-3)',
                    }}
                  >
                    <StatusPill status={statusState} label={t(getStatusLabelKey(statusRaw))} />
                  </td>

                  <td
                    style={{
                      paddingBlock: 'var(--w-space-2)',
                      paddingInline: 'var(--w-space-3)',
                    }}
                  >
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--w-space-1)' }}>
                      <Select
                        label={t(`bench.role.${role}`)}
                        options={allOptions}
                        value={currentValue}
                        disabled={modelOptionsMap.size === 0}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedModels((prev) => ({ ...prev, [role]: val }));
                          handleApplyModel(role, val);
                        }}
                        data-testid={`team-model-select-${role}`}
                      />
                      <IconButton
                        icon={<IconCheck size={14} />}
                        label={t('bench.action.team_model_set')}
                        variant="ghost"
                        size="sm"
                        disabled={modelOptionsMap.size === 0}
                        onClick={() => handleApplyModel(role)}
                        data-action="bench.team.model.set"
                        data-testid={`team-model-apply-btn-${role}`}
                      />
                    </div>
                  </td>

                  <td
                    dir="ltr"
                    style={{
                      paddingBlock: 'var(--w-space-2)',
                      paddingInline: 'var(--w-space-3)',
                      fontFamily: 'var(--w-font-mono)',
                      fontSize: 'var(--w-font-size-xs)',
                    }}
                  >
                    <bdi>{(m?.tokens ?? 0).toLocaleString('en-US')}</bdi>
                  </td>

                  <td
                    dir="ltr"
                    style={{
                      paddingBlock: 'var(--w-space-2)',
                      paddingInline: 'var(--w-space-3)',
                      fontFamily: 'var(--w-font-mono)',
                      fontSize: 'var(--w-font-size-xs)',
                    }}
                  >
                    <bdi>{formatCentsAsUsd(m?.costCents ?? 0)}</bdi>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

TeamTab.displayName = 'TeamTab';
