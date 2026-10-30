// Run view — Live event stream, diffs, costs
import { WarshaClient, type RunSummary, type WarshaEvent } from '@warsha/client';
import { useDirection, useLocale } from '@warsha/i18n';
import { Box, Text, Button, Card } from '@warsha/ui';
import React, { useState, useEffect, useRef } from 'react';

import { EcoModeToggle } from '../components/EcoModeToggle';
import { HandoffDialog, type HandoffPhase } from '../components/HandoffDialog';
import { LivePreview, type PreviewStatus } from '../components/LivePreview';
import { LocalCloudBadge, type TargetKind } from '../components/LocalCloudBadge';
import { ReviewApplyPanel, type HandoffChangedFile } from '../components/ReviewApplyPanel';

const STAGE_LABELS: Record<string, string> = {
  'idea': 'Idea',
  'gate_a': 'Gate A',
  'research': 'Research',
  'prd_spec': 'PRD Spec',
  'gate_b': 'Gate B',
  'design': 'Design',
  'plan_tasks': 'Plan Tasks',
  'code': 'Code',
  'review_qa_security': 'Review/QA/Sec',
  'gate_c': 'Gate C',
  'release': 'Release',
  'gate_d': 'Gate D',
  'launch_drafts': 'Launch Drafts',
  'feedback': 'Feedback',
};

interface RunViewProps {
  client: WarshaClient;
  run: RunSummary;
  onBack: () => void;
}

/** Which pane the run view shows. */
type RunTab = 'stream' | 'preview' | 'handoff' | 'router';

const RUN_TABS: RunTab[] = ['stream', 'preview', 'handoff', 'router'];

const TAB_LABELS: Record<RunTab, { ar: string; en: string }> = {
  stream: { ar: 'السجل والمصنوعات', en: 'Stream & artifacts' },
  preview: { ar: 'المعاينة المباشرة', en: 'Live preview' },
  handoff: { ar: 'المتابعة على الخادم', en: 'Continue on server' },
  router: { ar: 'التوجيه والتكلفة', en: 'Router & cost' },
};

/** One router target as the router/cost view shows it (mirrors `RouterTarget` in Rust). */
export interface RouterTargetView {
  name: string;
  kind: TargetKind;
  model: string;
}

export function RunView({ run, onBack }: RunViewProps) {
  const dir = useDirection();
  const locale = useLocale();
  const [events, setEvents] = useState<WarshaEvent[]>([]);
  const [, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [artifacts, setArtifacts] = useState<Record<string, string>>({});
  const subscriptionRef = useRef<{ close: () => void } | null>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<RunTab>('stream');
  // Live preview (M5b): the dev server is started and supervised by the daemon, so the
  // URL stays null until one is reported; `onRun`/`onStop` are the seams.
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('idle');
  const [previewUrl] = useState<string | null>(null);
  // Continue on server (M6a): the dialog reports intent, the phase and the remote URL
  // are what the daemon tells the caller, and the changed files are what it brings back.
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffPhase] = useState<HandoffPhase>('idle');
  const [handoffRemoteUrl] = useState('');
  const [handoffFiles] = useState<HandoffChangedFile[]>([]);
  // Router & cost (M14b): Eco mode and one local/cloud badge per target. The battery,
  // the network and the target list are caller-supplied until a router RPC exists.
  const [ecoEnabled, setEcoEnabled] = useState(false);
  const [onBattery] = useState(false);
  const [batteryPct] = useState(100);
  const [networkOk] = useState(true);
  const [routerTargets] = useState<RouterTargetView[]>([]);

  // The loaders are declared below as function expressions and are guarded by `run.id` only, so
  // listing them here would re-run this effect on every render. Behaviour is unchanged.
  useEffect(() => {
    loadEvents();
    loadArtifacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loaders are re-created per render; keyed by run.id
  }, [run.id]);

  useEffect(() => {
    if (following) {
      // In real app, connect to WebSocket
      // subscriptionRef.current = subscribeEvents({
      //   url: 'ws://localhost:8766',
      //   token: 'token',
      //   onEvent: (event) => setEvents(prev => [...prev, event]),
      //   onError: (error) => console.error('Event stream error:', error),
      // });
    }
    return () => {
      subscriptionRef.current?.close();
    };
  }, [following]);

  const loadEvents = async () => {
    try {
      // In real app: const eventsData = await client.getRunLogs(run.id);
      // For now, mock some events
      setEvents([
        { id: '1', runId: run.id, stage: 'idea', role: 'intake', kind: 'StageStarted', payload: { action: 'start_run' }, costCents: null, createdAt: run.startedAt, deviceId: null },
        { id: '2', runId: run.id, stage: 'research', role: 'researcher', kind: 'AgentStep', payload: { action: 'research' }, costCents: 150, createdAt: new Date().toISOString(), deviceId: null },
      ]);
    } catch (error) {
      console.error('Failed to load events:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadArtifacts = async () => {
    // Mock artifacts
    setArtifacts({
      idea: '# Project Idea\n\nBuild a todo app with React and TypeScript.',
      research: '# Research Report\n\n## Competitors\n- Todoist\n- Microsoft To Do\n\n## Tech Stack\n- React 18\n- TypeScript\n- Vite',
    });
  };

  const scrollToBottom = () => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (following) {
      scrollToBottom();
    }
  }, [events, following]);

  const formatEventTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getEventIcon = (kind: string) => {
    switch (kind) {
      case 'StageStarted': return '▶';
      case 'AgentStep': return '🤖';
      case 'ArtifactCreated': return '📄';
      case 'CostRecorded': return '💰';
      case 'GateDecision': return '⚖';
      default: return '•';
    }
  };

  // Live preview (M5b): the daemon starts and stops the dev server, so these only move
  // the status the panel renders. The URL arrives with the server, which is why it is null.
  const handlePreviewRun = () => {
    // TODO(M20 wiring): call the daemon's dev-server start RPC once it exists.
    setPreviewStatus('running');
  };

  const handlePreviewStop = () => {
    // TODO(M20 wiring): call the daemon's dev-server stop RPC once it exists.
    setPreviewStatus('stopped');
  };

  const handleElementClick = (_selector: string) => {
    // TODO(M20 wiring): hand `elementMention(selector)` to the composer once RunView has one.
  };

  // Continue on server (M6a): the handoff and the apply both need a daemon RPC, so the
  // dialog and the review panel report intent and nothing is written from here.
  const handleHandOff = (_url: string) => {
    // TODO(M20 wiring): call the daemon's handoff RPC once it exists.
  };

  const handleApplyChanges = (_paths: string[]) => {
    // TODO(M20 wiring): apply through the daemon after it writes the backup bundle.
  };

  return (
    <Box dir={dir} className="run-view" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)' }}>
      {/* Header */}
      <Box dir={dir} style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '16px', 
        padding: '16px 24px', 
        borderBottom: '1px solid #e5e7eb',
        backgroundColor: 'white',
      }}>
        <Button variant="ghost" size="sm" onClick={onBack} dir={dir}>
          ← {locale === 'ar' ? 'رجوع' : 'Back'}
        </Button>
        <Box dir={dir} style={{ flex: 1 }}>
          <Text size="lg" weight="bold" dir={dir}>{run.projectId}</Text>
          <Box dir={dir} style={{ display: 'flex', gap: '12px', marginTop: '4px', flexWrap: 'wrap' }}>
            <span style={{
              padding: '4px 10px',
              backgroundColor: '#dbeafe',
              color: '#1d4ed8',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 500,
            }}>
              {STAGE_LABELS[run.stage] || run.stage}
            </span>
            <span style={{
              padding: '4px 10px',
              backgroundColor: run.status === 'running' ? '#d1fae5' : '#fef3c7',
              color: run.status === 'running' ? '#065f46' : '#92400e',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 500,
            }}>
              {run.status}
            </span>
          </Box>
        </Box>
        <Box dir={dir} style={{ display: 'flex', gap: '8px' }}>
          <Button 
            variant={following ? 'primary' : 'secondary'} 
            onClick={() => setFollowing(!following)} 
            dir={dir}
            size="sm"
          >
            {following 
              ? (locale === 'ar' ? 'إيقاف المتابعة' : 'Stop Following')
              : (locale === 'ar' ? 'متابعة مباشرة' : 'Follow Live')}
          </Button>
          <Button variant="primary" size="sm" dir={dir} onClick={() => alert('Advance stage...')}>
            {locale === 'ar' ? 'تقدم' : 'Advance'}
          </Button>
          {/* Continue on server (M6a): opens the handoff dialog. */}
          <Button
            variant="secondary"
            size="sm"
            dir={dir}
            data-testid="handoff-open"
            onClick={() => setHandoffOpen(true)}
          >
            {locale === 'ar' ? 'المتابعة على الخادم' : 'Hand off'}
          </Button>
        </Box>
      </Box>

      {/* Tabs: the event stream, the live preview, the handoff, and the router/cost view */}
      <div
        dir={dir}
        role="tablist"
        data-testid="run-view-tabs"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          paddingInline: '24px',
          paddingBlock: '8px',
          backgroundColor: 'white',
          borderBottom: '1px solid #e5e7eb',
          flexWrap: 'wrap',
        }}
      >
        {RUN_TABS.map((candidate) => (
          <Button
            key={candidate}
            role="tab"
            aria-selected={tab === candidate}
            variant={tab === candidate ? 'primary' : 'ghost'}
            size="sm"
            dir={dir}
            data-testid={`run-tab-${candidate}`}
            onClick={() => setTab(candidate)}
          >
            {TAB_LABELS[candidate][locale]}
          </Button>
        ))}
      </div>

      {/* Main content — the event stream and the artifacts (the original run view) */}
      {tab === 'stream' && (
        <Box dir={dir} style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Event stream */}
        <Box dir={dir} style={{ 
          flex: '0 0 400px', 
          maxWidth: '400px',
          borderInlineEnd: '1px solid #e5e7eb',
          backgroundColor: '#fafafa',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <Box dir={dir} style={{ padding: '16px', borderBottom: '1px solid #e5e7eb' }}>
            <Text weight="bold" dir={dir}>
              {locale === 'ar' ? 'سجل الأحداث' : 'Event Stream'}
            </Text>
          </Box>
          
          <Box dir={dir} style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {events.map(event => (
              <Card key={event.id} dir={dir} style={{ backgroundColor: 'white' }}>
                <Box dir={dir} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <Text size="sm" weight="bold" dir={dir} style={{ color: '#2563eb' }}>
                    {getEventIcon(event.kind)}
                  </Text>
                  <Text size="xs" dir={dir} style={{ color: '#6b7280' }}>
                    {formatEventTime(event.createdAt)}
                  </Text>
                  <Text size="xs" dir={dir} style={{ color: '#9ca3af', marginInlineStart: 'auto' }}>
                    {STAGE_LABELS[event.stage] || event.stage}
                  </Text>
                </Box>
                <Text size="sm" dir={dir}>
                  {event.kind}: {JSON.stringify(event.payload).slice(0, 100)}
                </Text>
                {event.costCents && (
                  <Text size="xs" dir={dir} style={{ color: '#059669', marginTop: '4px' }}>
                    💰 ${(event.costCents / 100).toFixed(2)}
                  </Text>
                )}
              </Card>
            ))}
            <div ref={eventsEndRef} />
          </Box>
        </Box>

        {/* Artifacts panel */}
        <Box dir={dir} style={{ 
          flex: 1, 
          padding: '24px', 
          overflowY: 'auto',
          backgroundColor: 'white',
        }}>
          <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <Text size="xl" weight="bold" dir={dir}>
              {locale === 'ar' ? 'المصنوعات' : 'Artifacts'}
            </Text>
            <Button variant="secondary" size="sm" dir={dir}>
              {locale === 'ar' ? 'تصدير الكل' : 'Export All'}
            </Button>
          </Box>

          {Object.entries(artifacts).length === 0 ? (
            <Card dir={dir} style={{ textAlign: 'center', padding: '64px 32px' }}>
              <Text size="md" dir={dir} style={{ color: '#9ca3af' }}>
                {locale === 'ar' ? 'لا توجد مصنوعات بعد' : 'No artifacts yet'}
              </Text>
            </Card>
          ) : (
            <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {Object.entries(artifacts).map(([name, content]) => (
                <Card key={name} dir={dir}>
                  <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <Text weight="medium" dir={dir} style={{ textTransform: 'capitalize' }}>
                      {name.replace(/_/g, ' ')}
                    </Text>
                    <Box dir={dir} style={{ display: 'flex', gap: '8px' }}>
                      <Button variant="ghost" size="sm" dir={dir}>
                        {locale === 'ar' ? 'نسخ' : 'Copy'}
                      </Button>
                      <Button variant="ghost" size="sm" dir={dir}>
                        {locale === 'ar' ? 'تحميل' : 'Download'}
                      </Button>
                    </Box>
                  </Box>
                  <pre style={{
                    backgroundColor: '#1f2937',
                    color: '#e5e7eb',
                    padding: '16px',
                    borderRadius: '8px',
                    overflowX: 'auto',
                    fontSize: '0.875rem',
                    lineHeight: '1.6',
                    maxHeight: '400px',
                    direction: 'ltr',
                  }}>
                    {content}
                  </pre>
                </Card>
              ))}
            </Box>
          )}
        </Box>
      </Box>
      )}

      {/* Live preview (M5b): the panel takes the URL and the status from here */}
      {tab === 'preview' && (
        <Box dir={dir} style={{ flex: 1, overflowY: 'auto', padding: '24px', backgroundColor: '#fafafa' }}>
          <LivePreview
            url={previewUrl}
            status={previewStatus}
            onRun={handlePreviewRun}
            onStop={handlePreviewStop}
            onElementClick={handleElementClick}
          />
        </Box>
      )}

      {/* Continue on server (M6a): the handoff entry point and the review & apply dry run */}
      {tab === 'handoff' && (
        <Box dir={dir} style={{ flex: 1, overflowY: 'auto', padding: '24px', backgroundColor: '#fafafa', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Button variant="secondary" size="sm" dir={dir} onClick={() => setHandoffOpen(true)}>
            {locale === 'ar' ? 'المتابعة على الخادم' : 'Hand off'}
          </Button>
          {/* `files` stays empty until the remote run brings changes back, so the panel
              shows its empty state; applying needs the daemon's backup + apply RPC. */}
          <ReviewApplyPanel files={handoffFiles} backupName="" onApply={handleApplyChanges} />
        </Box>
      )}

      {/* Router & cost (M14b): Eco mode and the local/cloud badge per target */}
      {tab === 'router' && (
        <Box dir={dir} style={{ flex: 1, overflowY: 'auto', padding: '24px', backgroundColor: 'white', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Text size="xl" weight="bold" dir={dir}>
            {locale === 'ar' ? 'التوجيه والتكلفة' : 'Router & cost'}
          </Text>
          {/* The battery and network values are caller-supplied until a router RPC exists. */}
          <EcoModeToggle
            enabled={ecoEnabled}
            onBattery={onBattery}
            batteryPct={batteryPct}
            networkOk={networkOk}
            onChange={setEcoEnabled}
          />
          {routerTargets.length === 0 ? (
            <Text size="sm" dir={dir} style={{ color: '#9ca3af' }}>
              {locale === 'ar' ? 'لا توجد أهداف توجيه بعد' : 'No router targets yet'}
            </Text>
          ) : (
            <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {routerTargets.map((target) => (
                <Card key={target.name} dir={dir} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <LocalCloudBadge kind={target.kind} targetName={target.name} model={target.model} />
                  <Text size="sm" dir={dir}>{target.name}</Text>
                  <Text size="xs" dir={dir} style={{ color: '#6b7280' }}>{target.model}</Text>
                </Card>
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* Continue on server dialog (M6a): mounted once, opened from the header or the tab */}
      <HandoffDialog
        open={handoffOpen}
        phase={handoffPhase}
        remoteUrl={handoffRemoteUrl}
        onHandOff={handleHandOff}
        onClose={() => setHandoffOpen(false)}
      />
    </Box>
  );
}