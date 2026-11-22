// apps/desktop/src/v3/pages/developers/SessionDetail.tsx
// E4 session detail: header, stats, now line, event timeline with per-step durations,
// files touched with open-in-viewer links, output tail, Stop session / Open in viewer.
// Hand off is omitted by design: the daemon has no per-session handoff RPC
// (handoff.create is run-level), recorded in docs/zadloop/packets/E4-report.md.
import type { ProjectId, RunId, Session, WarshaEvent } from '@warsha/client';
import { useT } from '@warsha/i18n/v3';
import { Banner, Button, Skeleton } from '@warsha/ui/v3';
import React, { useState } from 'react';

import { useAction } from '../../actions';
import { useClient } from '../../app/ClientContext';

import { formatMs } from './format';
import {
  contextUsage,
  elapsedMs,
  eventTimeline,
  filesTouched,
  hasTelemetry,
  sessionMetrics,
} from './metrics';

interface Props {
  session: Session;
  events: WarshaEvent[];
  projectId: ProjectId;
  runId: RunId;
}

const SessionDetail: React.FC<Props> = ({ session, events, projectId, runId }) => {
  const t = useT();
  const client = useClient();
  const [tail, setTail] = useState<string[] | null>(null);
  const [tailLoading, setTailLoading] = useState(false);
  const stopSession = useAction('developers.session.stop', async () => {
    if (!client) return;
    await client.stopSession(session.id);
  });
  const openViewer = useAction('developers.session.view', async () => {
    if (!client) return;
    window.location.hash = `#/p/${projectId}/code`;
    void runId;
  });

  const metrics = sessionMetrics(session, events);
  const telemetry = hasTelemetry(session, events);
  const usage = contextUsage(events);
  const timeline = eventTimeline(session, events);
  const files = filesTouched(session, events);

  const loadTail = async (): Promise<void> => {
    if (!client || tailLoading) return;
    setTailLoading(true);
    try {
      setTail(await client.getSessionTail(session.id));
    } catch {
      setTail(null);
    } finally {
      setTailLoading(false);
    }
  };

  return (
    <section className="developers-detail" data-testid="developers-detail">
      <header className="developers-detail-header">
        <h2>{t('developers.detail')}</h2>
        <p className="developers-detail-sub">
          {session.role} · {session.model === '' || session.model === 'default' ? t('developers.not_routed_yet') : session.model} · {session.provider === '' || session.provider === 'routed' ? t('developers.not_routed_yet') : session.provider} · {session.backend}
        </p>
        <p className="developers-detail-now">
          {t('developers.detail.now', {
            elapsed: formatMs(elapsedMs(session)),
            status: session.status,
          })}
        </p>
      </header>

      <dl className="developers-detail-stats" data-testid="developers-detail-stats">
        <div>
          <dt>{t('developers.table.cost')}</dt>
          <dd data-testid="developers-detail-cost">
            {session.provider === '' || session.provider === 'routed'
              ? t('developers.not_routed_yet')
              : metrics.costCents === null
                ? t('developers.unknown')
                : `${metrics.costCents} ¢`}
          </dd>
        </div>
        <div>
          <dt>{t('developers.table.tokens')}</dt>
          <dd data-testid="developers-detail-tokens">
            {metrics.tokens === null
              ? t('developers.unknown')
              : `${metrics.tokens.total} (${metrics.tokens.input}+${metrics.tokens.output})`}
          </dd>
        </div>
        <div>
          <dt>{t('developers.table.tps')}</dt>
          <dd data-testid="developers-detail-tps">
            {metrics.tokensPerSecond === null
              ? t('developers.unknown')
              : `${metrics.tokensPerSecond} ${t('developers.estimated')}`}
          </dd>
        </div>
      </dl>

      {!telemetry && (
        <Banner variant="info" data-testid="developers-detail-no-telemetry">
          {t('developers.detail.no_telemetry')}
        </Banner>
      )}

      {usage !== null && (
        <div className="developers-detail-context" data-testid="developers-detail-context">
          <span>
            {t('developers.detail.context', {
              used: usage.used,
              total: usage.total,
              percent: Math.round((usage.used / usage.total) * 100),
            })}
          </span>
          <progress max={usage.total} value={usage.used} />
        </div>
      )}

      <h3>{t('developers.detail.timeline')}</h3>
      {telemetry ? (
        <ol className="developers-detail-timeline" data-testid="developers-detail-timeline">
          {timeline.map(({ event, durationMs }) => (
            <li key={event.id}>
              <span className="developers-detail-step-kind">{event.kind}</span>
              {durationMs !== null && (
                <span className="developers-detail-step-duration">
                  {t('developers.detail.step_duration', { duration: formatMs(durationMs) })}
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p>{t('developers.detail.no_telemetry')}</p>
      )}

      <h3>{t('developers.detail.files')}</h3>
      {files.length === 0 ? (
        <p>{t('developers.unknown')}</p>
      ) : (
        <ul className="developers-detail-files" data-testid="developers-detail-files">
          {files.map((file) => (
            <li key={file}>
              <Button
                size="sm"
                variant="ghost"
                data-action="developers.session.view"
                onClick={() => {
                  window.location.hash = `#/p/${projectId}/code`;
                }}
              >
                {file}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <h3>{t('developers.detail.output')}</h3>
      {tail === null ? (
        <Button data-testid="developers-detail-tail-trigger" data-action="developers.list.refresh" onClick={() => void loadTail()}>
          {tailLoading ? <Skeleton /> : t('developers.detail.load_tail')}
        </Button>
      ) : (
        <pre className="developers-detail-tail" data-testid="developers-detail-tail">
          {tail.join('\n')}
        </pre>
      )}

      <footer className="developers-detail-actions">
        <Button
          variant="danger"
          data-action="developers.session.stop"
          onClick={() => void stopSession.run()}
          disabled={stopSession.pending}
        >
          {t('developers.detail.stop')}
        </Button>
        <Button
          variant="ghost"
          data-action="developers.session.view"
          onClick={() => void openViewer.run()}
        >
          {t('developers.detail.view')}
        </Button>
      </footer>
    </section>
  );
};

export default SessionDetail;
