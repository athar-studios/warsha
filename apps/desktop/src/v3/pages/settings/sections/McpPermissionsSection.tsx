// apps/desktop/src/v3/pages/settings/sections/McpPermissionsSection.tsx — the MCP permission
// table (R-BRIDGE-B3b). A row-list in the `DevicesSection.tsx` pattern, not a `<table>`: the
// design system has no table primitive, and a row keeps its action beside the row it acts on.
import type { McpPermission, McpPermissionRow, McpPermissionsReply } from '@warsha/client';
/* eslint-disable import/no-unresolved */
import { useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  EmptyState,
  IconKey,
  SettingsSection,
  Skeleton,
  StatusPill,
} from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React, { useCallback, useEffect, useState } from 'react';

import { useAction } from '../../../actions';
import { useClient } from '../../../app/ClientContext';
import { useDataReady } from '../../../app/DataReadyContext';

/** The pill state and the catalog key for one stored permission. */
const PERMISSION_VIEW: Record<
  McpPermission,
  { status: 'done' | 'waiting' | 'failed'; labelKey: string }
> = {
  allow: { status: 'done', labelKey: 'settings.mcp.permission.allow' },
  ask: { status: 'waiting', labelKey: 'settings.mcp.permission.ask' },
  deny: { status: 'failed', labelKey: 'settings.mcp.permission.deny' },
};

function rowKey(row: McpPermissionRow): string {
  return `${row.server}::${row.tool}::${row.role}`;
}

export function McpPermissionsSection(): React.ReactElement {
  const t = useT();
  const client = useClient();
  const { setReady } = useDataReady();

  const [reply, setReply] = useState<McpPermissionsReply | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [revokingKey, setRevokingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) {
      setReply(null);
      setStatus('ready');
      return;
    }
    setStatus('loading');
    try {
      const next = await client.mcpPermissionsList();
      setReply(next);
      setErrorMessage(null);
      setStatus('ready');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setStatus('error');
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setReady(status !== 'loading');
  }, [status, setReady]);

  /**
   * Revoking a grant writes the fail-closed default from the daemon's own reply — today `ask` —
   * rather than a value this screen guesses. The table is re-read afterwards, so a row the daemon
   * kept looks the same as one it dropped.
   */
  const revokeAction = useAction('settings.mcp.revoke', async (row?: McpPermissionRow) => {
    if (!client || !row || !reply) return;
    const key = rowKey(row);
    setRevokingKey(key);
    try {
      await client.mcpPermissionsSet(row.server, row.tool, row.role, reply.defaultPermission);
      setStatusMessage(t('settings.mcp.revoke_done'));
      await load();
    } finally {
      setRevokingKey(null);
    }
  });

  const rows = reply?.rows ?? [];
  const defaultNote = reply
    ? t('settings.mcp.default_note', {
        permission: t(PERMISSION_VIEW[reply.defaultPermission].labelKey),
        role: reply.agentRole,
      })
    : '';

  return (
    <div data-testid="settings-section-mcp">
      <SettingsSection
        title={t('settings.section.mcp')}
        description={t('settings.section.mcp.desc')}
        scope={<span className="v3-settings-scope">{t('settings.scope.daemon')}</span>}
      >
        {status === 'loading' && (
          <div
            style={{
              padding: 'var(--w-space-4)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--w-space-3)',
            }}
          >
            <Skeleton variant="text" />
            <Skeleton variant="text" />
          </div>
        )}

        {status === 'error' && (
          <div style={{ padding: 'var(--w-space-4)' }}>
            <Banner variant="danger">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--w-space-3)',
                  flexWrap: 'wrap',
                }}
              >
                <span>{errorMessage ?? t('common.error')}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  data-action="settings.error.retry"
                  onClick={() => {
                    void load();
                  }}
                >
                  {t('common.retry')}
                </Button>
              </div>
            </Banner>
          </div>
        )}

        {status === 'ready' && reply && (
          <>
            <div style={{ padding: 'var(--w-space-4)', paddingBlockEnd: 0 }}>
              <Banner variant="info">{defaultNote}</Banner>
            </div>

            {statusMessage && (
              <div style={{ padding: 'var(--w-space-4)', paddingBlockEnd: 0 }}>
                <Banner variant="success">{statusMessage}</Banner>
              </div>
            )}

            {rows.length === 0 ? (
              <EmptyState
                icon={<IconKey size={20} />}
                title={t('settings.mcp.empty.title')}
                description={t('settings.mcp.empty.desc')}
              />
            ) : (
              <div>
                {rows.map((row) => {
                  const key = rowKey(row);
                  const view = PERMISSION_VIEW[row.permission];
                  return (
                    <div
                      key={key}
                      className="v3-settings-row"
                      data-testid={`mcp-permission-row-${key}`}
                    >
                      <span className="v3-settings-row-icon" aria-hidden="true">
                        <IconKey size={18} />
                      </span>
                      <div className="v3-settings-row-main">
                        <div className="v3-settings-row-title">
                          <bdi dir="ltr">
                            {row.server} · {row.tool}
                          </bdi>
                        </div>
                        <div className="v3-settings-row-subtitle">
                          {t('settings.mcp.role_label')}: <bdi dir="ltr">{row.role}</bdi>
                        </div>
                      </div>
                      <div className="v3-settings-row-meta">
                        <StatusPill status={view.status} label={t(view.labelKey)} />
                      </div>
                      <div className="v3-settings-row-actions">
                        {row.permission !== reply.defaultPermission && (
                          <Button
                            size="sm"
                            variant="ghost"
                            data-action="settings.mcp.revoke"
                            loading={revokingKey === key}
                            onClick={() => {
                              void revokeAction.run(row);
                            }}
                          >
                            {t('settings.mcp.revoke')}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </SettingsSection>
    </div>
  );
}
