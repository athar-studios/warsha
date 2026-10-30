// Advanced Mode — Full workspace (modeled on ZadLoop's workspace)
// Per-agent lanes, live event stream, diffs, file tree, terminal, kanban, skills/MCP config, costs
import { type WarshaClient, type ProjectSummary, type WarshaEvent, subscribeEvents } from '@warsha/client';
import { useLocale, useDirection, t } from '@warsha/i18n';
import { Box, Text, Button, Card } from '@warsha/ui';
import React, { useState, useEffect } from 'react';

interface AdvancedModeProps {
  client: WarshaClient;
  project: ProjectSummary;
  onBack?: () => void;
}

interface AgentLane {
  id: string;
  name: string;
  role: string;
  model: string;
  status: 'idle' | 'running' | 'waiting' | 'done' | 'error';
  events: WarshaEvent[];
  costCents: number;
}

const ROLE_COLORS: Record<string, string> = {
  Orchestrator: '#2563eb',
  Intake: '#6b7280',
  Researcher: '#8b5cf6',
  Pm: '#0ea5e9',
  Designer: '#ec4899',
  Architect: '#f97316',
  Coder: '#10b981',
  Reviewer: '#14b8a6',
  Qa: '#f59e0b',
  Security: '#ef4444',
  Release: '#6366f1',
  Marketer: '#d946ef',
  Feedback: '#06b6d4',
};

export function AdvancedMode({ client, project, onBack }: AdvancedModeProps) {
  const dir = useDirection();
  const locale = useLocale();
  const [selectedTab, setSelectedTab] = useState<'lanes' | 'events' | 'diffs' | 'files' | 'terminal' | 'kanban' | 'skills' | 'costs'>('lanes');
  const [lanes, setLanes] = useState<AgentLane[]>([]);
  const [events, setEvents] = useState<WarshaEvent[]>([]);
  const [runCount, setRunCount] = useState(0);
  const [terminalOutput, setTerminalOutput] = useState<string[]>(['Welcome to Warsha Advanced Mode', 'Type "help" for commands']);
  const [terminalInput, setTerminalInput] = useState('');

  // Initialize runs, then follow the live event stream to build lanes.
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const runsData = await client.listRuns(project.id);
        if (cancelled) return;
        setRunCount(runsData.length);
      } catch (error) {
        console.error('Failed to initialize advanced mode:', error);
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, [client, project]);

  // Live event stream: append events and fold them into per-role lanes.
  useEffect(() => {
    const subscription = subscribeEvents({
      url: 'http://127.0.0.1:8766',
      token: 'test-token',
      onEvent: (event: WarshaEvent) => {
        setEvents(prev => [...prev, event].slice(-500));
        const role = event.role ?? 'Orchestrator';
        const cost = event.costCents ?? 0;
        setLanes(prev => {
          const existing = prev.find(lane => lane.role === role);
          if (existing) {
            return prev.map(lane =>
              lane.role === role
                ? { ...lane, events: [...lane.events, event], costCents: lane.costCents + cost, status: 'running' }
                : lane,
            );
          }
          return [
            ...prev,
            {
              id: role.toLowerCase(),
              name: role,
              role,
              model: 'gpt-4o',
              status: 'running',
              events: [event],
              costCents: cost,
            },
          ];
        });
      },
      onError: (error: Error) => {
        console.error('Event stream error:', error.message);
      },
    });
    return () => subscription.close();
  }, []);

  const handleTerminalSubmit = () => {
    if (!terminalInput.trim()) return;
    const cmd = terminalInput.trim();
    setTerminalOutput(prev => [...prev, `$ ${cmd}`, `Executing: ${cmd}...`]);
    setTerminalInput('');
    
    // Mock command execution
    setTimeout(() => {
      setTerminalOutput(prev => [...prev, `Done. Exit code: 0`, '']);
    }, 500);
  };

  const getTabLabel = (tab: string) => {
    const labels: Record<string, { ar: string; en: string }> = {
      lanes: { ar: 'المسارات', en: 'Lanes' },
      events: { ar: 'الأحداث', en: 'Events' },
      diffs: { ar: 'الاختلافات', en: 'Diffs' },
      files: { ar: 'الملفات', en: 'Files' },
      terminal: { ar: 'الطرفية', en: 'Terminal' },
      kanban: { ar: 'الكانبان', en: 'Kanban' },
      skills: { ar: 'المهارات', en: 'Skills' },
      costs: { ar: 'التكاليف', en: 'Costs' },
    };
    return locale === 'ar' ? labels[tab]?.ar || tab : labels[tab]?.en || tab;
  };

  const renderLanesTab = () => (
    <Box dir={dir} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text weight="bold" size="lg" dir={dir}>
          {t('advanced.agentLanes') || 'Agent Lanes'}
        </Text>
        <Text size="sm" style={{ color: '#6b7280' }} dir={dir}>
          {lanes.length} {t('advanced.activeAgents') || 'active agents'} • {runCount} {t('advanced.runs') || 'runs'}
        </Text>
      </Box>

      <Box dir={dir} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '16px', flex: 1, overflowY: 'auto' }}>
        {lanes.map(lane => (
          <Card key={lane.id} dir={dir} style={{ 
            borderInlineStart: `4px solid ${ROLE_COLORS[lane.role] || '#6b7280'}`,
            display: 'flex',
            flexDirection: 'column',
          }}>
            <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
              <Box dir={dir}>
                <Text weight="bold" size="lg" dir={dir}>{lane.name}</Text>
                <Text size="sm" style={{ color: '#6b7280' }} dir={dir}>
                  {t('run.model_label') || 'Model:'} {lane.model} • ${(lane.costCents / 100).toFixed(4)}
                </Text>
              </Box>
              <Box dir={dir} style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: lane.status === 'running' ? '#10b981' : 
                                 lane.status === 'waiting' ? '#f59e0b' : 
                                 lane.status === 'error' ? '#ef4444' : '#9ca3af',
              }} />
            </Box>

            <Box dir={dir} style={{ flex: 1, minHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {lane.events.slice(-5).map((event, idx) => (
                <Box key={idx} dir={dir} style={{
                  padding: '8px 12px',
                  backgroundColor: '#f9fafb',
                  borderRadius: '6px',
                  borderInlineStart: `3px solid ${ROLE_COLORS[lane.role] || '#6b7280'}`,
                  fontSize: '13px',
                }}>
                  <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <Text size="sm" weight="medium" dir={dir}>{event.kind}</Text>
                    <Text size="sm" style={{ color: '#9ca3af' }} dir={dir}>
                      {new Date(event.createdAt).toLocaleTimeString()}
                    </Text>
                  </Box>
                  <Text size="sm" style={{ color: '#4b5563', fontFamily: 'monospace' }} dir={dir}>
                    {JSON.stringify(event.payload).slice(0, 100)}...
                  </Text>
                </Box>
              ))}
              {lane.events.length > 5 && (
                <Text size="sm" style={{ color: '#9ca3af', textAlign: 'center', padding: '8px' }} dir={dir}>
                  {t('advanced.andMore', { count: lane.events.length - 5 }) || `+${lane.events.length - 5} more events`}
                </Text>
              )}
            </Box>
          </Card>
        ))}

        {lanes.length === 0 && (
          <Card dir={dir} style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px' }}>
            <Text size="lg" style={{ color: '#9ca3af' }} dir={dir}>
              {t('advanced.noLanes') || 'No active agent lanes yet. Start a run to see activity.'}
            </Text>
          </Card>
        )}
      </Box>
    </Box>
  );

  const renderEventsTab = () => (
    <Box dir={dir} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Text weight="bold" size="lg" dir={dir}>
        {t('advanced.eventStream') || 'Live Event Stream'}
      </Text>

      <Box dir={dir} style={{ flex: 1, overflowY: 'auto', backgroundColor: '#1e293b', borderRadius: '8px', padding: '16px', fontFamily: 'monospace', fontSize: '13px' }}>
        {events.length === 0 ? (
          <Text style={{ color: '#64748b' }} dir={dir}>
            {t('advanced.noEvents') || 'No events yet. Start a run to see the live stream.'}
          </Text>
        ) : (
          events.slice(-100).map((event, idx) => (
            <Box key={idx} dir={dir} style={{ marginBottom: '8px', padding: '8px', backgroundColor: '#0f172a', borderRadius: '4px', borderInlineStart: `3px solid ${ROLE_COLORS[event.role ?? ''] || '#6b7280'}` }}>
              <Box dir={dir} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '4px' }}>
                <Text style={{ color: '#94a3b8' }} dir={dir}>{new Date(event.createdAt).toISOString()}</Text>
                <Text style={{ color: ROLE_COLORS[event.role ?? ''] || '#64748b' }} dir={dir}>{event.stage}</Text>
                <Text style={{ color: '#64748b' }} dir={dir}>{event.kind}</Text>
                {event.costCents !== null && (
                  <Text style={{ color: '#10b981' }} dir={dir}>${(event.costCents / 100).toFixed(4)}</Text>
                )}
              </Box>
              <Text style={{ color: '#e2e8f0' }} dir={dir}>{JSON.stringify(event.payload).slice(0, 200)}</Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );

  const renderDiffsTab = () => (
    <Box dir={dir} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Text weight="bold" size="lg" dir={dir}>
        {t('advanced.diffs') || 'Code Diffs'}
      </Text>
      <Card dir={dir} style={{ flex: 1, overflowY: 'auto' }}>
        <Text style={{ color: '#9ca3af' }} dir={dir}>
          {t('advanced.diffsPlaceholder') || 'Diffs will appear here when agents modify files. Select a run and stage to view changes.'}
        </Text>
      </Card>
    </Box>
  );

  const renderFilesTab = () => (
    <Box dir={dir} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Text weight="bold" size="lg" dir={dir}>
        {t('advanced.fileTree') || 'File Tree'}
      </Text>
      <Card dir={dir} style={{ flex: 1, overflowY: 'auto' }}>
        <Text style={{ color: '#9ca3af' }} dir={dir}>
          {t('advanced.filesPlaceholder') || 'File tree will appear here. Shows project structure and agent-modified files.'}
        </Text>
      </Card>
    </Box>
  );

  const renderTerminalTab = () => (
    <Box dir={dir} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
      <Text weight="bold" size="lg" dir={dir}>
        {t('advanced.terminal') || 'Terminal'}
      </Text>

      <Box dir={dir} style={{ flex: 1, backgroundColor: '#1e1e1e', borderRadius: '8px', padding: '16px', fontFamily: 'monospace', fontSize: '13px', overflowY: 'auto', display: 'flex', flexDirection: 'column', color: '#e2e8f0' }}>
        {terminalOutput.map((line, idx) => (
          <Box key={idx} dir={dir} style={{ 
            color: line.startsWith('$') ? '#10b981' : 
                   line.startsWith('Done') ? '#f59e0b' : '#e2e8f0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {line}
          </Box>
        ))}
      </Box>

      <Box dir={dir} style={{ display: 'flex', gap: '8px' }}>
        <Text style={{ color: '#6b7280', alignSelf: 'center' }} dir={dir}>$</Text>
        <input
          type="text"
          value={terminalInput}
          onChange={(e) => setTerminalInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleTerminalSubmit()}
          placeholder={t('advanced.terminalPlaceholder') || 'Type a command...'}
          dir={dir}
          style={{
            flex: 1,
            backgroundColor: '#1e1e1e',
            border: '1px solid #374151',
            borderRadius: '4px',
            padding: '8px 12px',
            color: '#e2e8f0',
            fontFamily: 'monospace',
            fontSize: '13px',
            outline: 'none',
          }}
        />
        <Button variant="primary" size="sm" dir={dir} onClick={handleTerminalSubmit}>
          {t('common.run') || 'Run'}
        </Button>
      </Box>
    </Box>
  );

  const renderKanbanTab = () => (
    <Box dir={dir} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Text weight="bold" size="lg" dir={dir}>
        {t('advanced.kanban') || 'Task Board'}
      </Text>

      <Box dir={dir} style={{ display: 'flex', gap: '16px', flex: 1, overflowX: 'auto' }}>
        {[
          { id: 'backlog', label: locale === 'ar' ? 'قائمة الانتظار' : 'Backlog', color: '#6b7280' },
          { id: 'todo', label: locale === 'ar' ? 'للقيام' : 'To Do', color: '#3b82f6' },
          { id: 'in_progress', label: locale === 'ar' ? 'قيد التنفيذ' : 'In Progress', color: '#f59e0b' },
          { id: 'review', label: locale === 'ar' ? 'مراجعة' : 'Review', color: '#8b5cf6' },
          { id: 'done', label: locale === 'ar' ? 'منجز' : 'Done', color: '#10b981' },
        ].map(col => (
          <Box key={col.id} dir={dir} style={{
            minWidth: '280px',
            maxWidth: '280px',
            backgroundColor: '#f9fafb',
            borderRadius: '8px',
            borderTop: `4px solid ${col.color}`,
            display: 'flex',
            flexDirection: 'column',
          }}>
            <Box dir={dir} style={{ padding: '12px', borderBottom: '1px solid #e5e7eb' }}>
              <Text weight="bold" dir={dir}>{col.label}</Text>
            </Box>
            <Box dir={dir} style={{ flex: 1, padding: '8px', overflowY: 'auto', minHeight: '300px' }}>
              <Text size="sm" style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }} dir={dir}>
                {t('advanced.emptyColumn') || 'No tasks'}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );

  const renderSkillsTab = () => (
    <Box dir={dir} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Text weight="bold" size="lg" dir={dir}>
        {t('advanced.skillsMcp') || 'Skills / MCP Config'}
      </Text>

      <Card dir={dir} style={{ marginBottom: '16px' }}>
        <Text weight="medium" dir={dir} style={{ marginBottom: '12px' }}>
          {t('advanced.installedSkills') || 'Installed Skills'}
        </Text>
        <Box dir={dir} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {['planning', 'task-decomposition', 'code-generation', 'refactoring', 'testing', 'code-review', 'security-audit', 'threat-modeling', 'test-planning'].map(skill => (
            <Button key={skill} variant="ghost" size="sm" dir={dir} style={{ backgroundColor: '#eff6ff', color: '#2563eb' }}>
              {skill}
            </Button>
          ))}
        </Box>
      </Card>

      <Card dir={dir}>
        <Text weight="medium" dir={dir} style={{ marginBottom: '12px' }}>
          {t('advanced.availableMcp') || 'Available MCP Servers'}
        </Text>
        <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {['github', 'filesystem', 'sqlite', 'postgres', 'web-search', 'docker'].map(server => (
            <Box key={server} dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', backgroundColor: '#f9fafb', borderRadius: '6px' }}>
              <Text dir={dir}>{server}</Text>
              <Button variant="ghost" size="sm" dir={dir}>
                {t('common.install') || 'Install'}
              </Button>
            </Box>
          ))}
        </Box>
      </Card>
    </Box>
  );

  const renderCostsTab = () => (
    <Box dir={dir} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Text weight="bold" size="lg" dir={dir}>
        {t('advanced.costs') || 'Costs & Budget'}
      </Text>

      <Box dir={dir} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        <Card dir={dir}>
          <Text size="sm" style={{ color: '#6b7280' }} dir={dir}>
            {t('advanced.totalBudget') || 'Total Budget'}
          </Text>
          <Text size="xl" weight="bold" dir={dir}>$100.00</Text>
        </Card>
        <Card dir={dir}>
          <Text size="sm" style={{ color: '#6b7280' }} dir={dir}>
            {t('advanced.spent') || 'Spent'}
          </Text>
          <Text size="xl" weight="bold" style={{ color: '#ef4444' }} dir={dir}>$23.45</Text>
        </Card>
        <Card dir={dir}>
          <Text size="sm" style={{ color: '#6b7280' }} dir={dir}>
            {t('advanced.remaining') || 'Remaining'}
          </Text>
          <Text size="xl" weight="bold" style={{ color: '#10b981' }} dir={dir}>$76.55</Text>
        </Card>
        <Card dir={dir}>
          <Text size="sm" style={{ color: '#6b7280' }} dir={dir}>
            {t('advanced.costPerRun') || 'Cost / Run'}
          </Text>
          <Text size="xl" weight="bold" dir={dir}>$2.35</Text>
        </Card>
      </Box>

      <Card dir={dir} style={{ flex: 1 }}>
        <Text weight="medium" dir={dir} style={{ marginBottom: '12px' }}>
          {t('advanced.costBreakdown') || 'Cost Breakdown by Role'}
        </Text>
        <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {lanes.map(lane => (
            <Box key={lane.id} dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', backgroundColor: '#f9fafb', borderRadius: '6px' }}>
              <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Box dir={dir} style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: ROLE_COLORS[lane.role] || '#6b7280' }} />
                <Text dir={dir}>{lane.name}</Text>
              </Box>
              <Text weight="medium" style={{ color: ROLE_COLORS[lane.role] || '#6b7280' }} dir={dir}>
                ${(lane.costCents / 100).toFixed(4)}
              </Text>
            </Box>
          ))}
        </Box>
      </Card>
    </Box>
  );

  const tabs = [
    { id: 'lanes', render: renderLanesTab },
    { id: 'events', render: renderEventsTab },
    { id: 'diffs', render: renderDiffsTab },
    { id: 'files', render: renderFilesTab },
    { id: 'terminal', render: renderTerminalTab },
    { id: 'kanban', render: renderKanbanTab },
    { id: 'skills', render: renderSkillsTab },
    { id: 'costs', render: renderCostsTab },
  ];

  return (
    <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '600px', backgroundColor: '#fafafa' }}>
      {/* Header */}
      <Box dir={dir} style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px',
        backgroundColor: 'white',
        borderBottom: '1px solid #e5e7eb',
        flexWrap: 'wrap',
        gap: '12px',
      }}>
        <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {onBack && (
            <Button variant="ghost" size="sm" dir={dir} onClick={onBack}>
              ← {t('common.back') || 'Back'}
            </Button>
          )}
          <Text size="xl" weight="bold" style={{ color: '#2563eb' }} dir={dir}>{t('app.brand') || 'Warsha'}</Text>
          <Text size="sm" style={{ color: '#6b7280' }} dir={dir}>{project.name}</Text>
        </Box>

        {/* Tab Bar */}
        <Box dir={dir} style={{ display: 'flex', gap: '4px', backgroundColor: '#f3f4f6', borderRadius: '8px', padding: '4px' }}>
          {tabs.map(tab => (
            <Button
              key={tab.id}
              variant={selectedTab === tab.id ? 'primary' : 'ghost'}
              size="sm"
              dir={dir}
              onClick={() => setSelectedTab(tab.id as typeof selectedTab)}
            >
              {getTabLabel(tab.id)}
            </Button>
          ))}
        </Box>
      </Box>

      {/* Content */}
      <Box dir={dir} style={{ flex: 1, overflow: 'hidden' }}>
        {tabs.find(t => t.id === selectedTab)?.render()}
      </Box>
    </Box>
  );
}