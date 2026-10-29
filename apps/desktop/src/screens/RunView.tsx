// Run view — Live event stream, diffs, costs
import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, Button, Card } from '@warsha/ui';
import { t, useDirection, useLocale } from '@warsha/i18n';
import { WarshaClient, type RunSummary, type WarshaEvent, type Stage, subscribeEvents } from '@warsha/client';

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

export function RunView({ client, run, onBack }: RunViewProps) {
  const dir = useDirection();
  const locale = useLocale();
  const [events, setEvents] = useState<WarshaEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [artifacts, setArtifacts] = useState<Record<string, string>>({});
  const subscriptionRef = useRef<{ close: () => void } | null>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadEvents();
    loadArtifacts();
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
        </Box>
      </Box>

      {/* Main content */}
      <Box dir={dir} style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Event stream */}
        <Box dir={dir} style={{ 
          flex: '0 0 400px', 
          maxWidth: '400px',
          borderRight: '1px solid #e5e7eb',
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
                  <Text size="xs" dir={dir} style={{ color: '#9ca3af', marginLeft: 'auto' }}>
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
    </Box>
  );
}