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
  Orchestrator: 'var(--warsha-color-accent-strong)',
  Intake: 'var(--warsha-color-text-muted)',
  Researcher: 'var(--warsha-color-accent-strong)',
  Pm: 'var(--warsha-color-accent-strong)',
  Designer: 'var(--warsha-color-error)',
  Architect: 'var(--warsha-color-warning)',
  Coder: 'var(--warsha-color-success)',
  Reviewer: 'var(--warsha-color-success)',
  Qa: 'var(--warsha-color-warning)',
  Security: 'var(--warsha-color-error)',
  Release: 'var(--warsha-color-accent-strong)',
  Marketer: 'var(--warsha-color-error)',
  Feedback: 'var(--warsha-color-accent-strong)',
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
    <Box dir={dir} style={{ padding: 'var(--warsha-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-4)' }}>
      <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text weight="bold" size="lg" dir={dir}>
          {t('advanced.agentLanes') || 'Agent Lanes'}
        </Text>
        <Text size="sm" style={{ color: 'var(--warsha-color-text-muted)' }} dir={dir}>
          {lanes.length} {t('advanced.activeAgents') || 'active agents'} • {runCount} {t('advanced.runs') || 'runs'}
        </Text>
      </Box>

      <Box dir={dir} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 'var(--warsha-space-4)', flex: 1, overflowY: 'auto' }}>
        {lanes.map(lane => (
          <Card key={lane.id} dir={dir} style={{ 
            borderInlineStart: `4px solid ${ROLE_COLORS[lane.role] || 'var(--warsha-color-text-muted)'}`,
            display: 'flex',
            flexDirection: 'column',
          }}>
            <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--warsha-space-3)' }}>
              <Box dir={dir}>
                <Text weight="bold" size="lg" dir={dir}>{lane.name}</Text>
                <Text size="sm" style={{ color: 'var(--warsha-color-text-muted)' }} dir={dir}>
                  {t('run.model_label', {}, locale) || 'Model:'} {lane.model} • ${(lane.costCents / 100).toFixed(4)}
                </Text>
              </Box>
              <Box dir={dir} style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: lane.status === 'running' ? 'var(--warsha-color-success)' : 
                                 lane.status === 'waiting' ? 'var(--warsha-color-warning)' : 
                                 lane.status === 'error' ? 'var(--warsha-color-error)' : 'var(--warsha-color-muted)',
              }} />
            </Box>

            <Box dir={dir} style={{ flex: 1, minHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
              {lane.events.slice(-5).map((event, idx) => (
                <Box key={idx} dir={dir} style={{
                  padding: 'var(--warsha-space-2) var(--warsha-space-3)',
                  backgroundColor: 'var(--warsha-color-bg)',
                  borderRadius: '6px',
                  borderInlineStart: `3px solid ${ROLE_COLORS[lane.role] || 'var(--warsha-color-text-muted)'}`,
                  fontSize: '13px',
                }}>
                  <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--warsha-space-1)' }}>
                    <Text size="sm" weight="medium" dir={dir}>{event.kind}</Text>
                    <Text size="sm" style={{ color: 'var(--warsha-color-muted)' }} dir={dir}>
                      {new Date(event.createdAt).toLocaleTimeString()}
                    </Text>
                  </Box>
                  <Text size="sm" style={{ color: 'var(--warsha-color-text-muted)', fontFamily: 'var(--warsha-font-mono)' }} dir={dir}>
                    {JSON.stringify(event.payload).slice(0, 100)}...
                  </Text>
                </Box>
              ))}
              {lane.events.length > 5 && (
                <Text size="sm" style={{ color: 'var(--warsha-color-muted)', textAlign: 'center', padding: 'var(--warsha-space-2)' }} dir={dir}>
                  {t('advanced.andMore', { count: lane.events.length - 5 }) || `+${lane.events.length - 5} more events`}
                </Text>
              )}
            </Box>
          </Card>
        ))}

        {lanes.length === 0 && (
          <Card dir={dir} style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 'var(--warsha-space-12)' }}>
            <Text size="lg" style={{ color: 'var(--warsha-color-muted)' }} dir={dir}>
              {t('advanced.noLanes') || 'No active agent lanes yet. Start a run to see activity.'}
            </Text>
          </Card>
        )}
      </Box>
    </Box>
  );

  const renderEventsTab = () => (
    <Box dir={dir} style={{ padding: 'var(--warsha-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-4)' }}>
      <Text weight="bold" size="lg" dir={dir}>
        {t('advanced.eventStream') || 'Live Event Stream'}
      </Text>

      <Box dir={dir} style={{ flex: 1, overflowY: 'auto', backgroundColor: 'var(--warsha-color-surface-muted)', borderRadius: '8px', padding: 'var(--warsha-space-4)', fontFamily: 'var(--warsha-font-mono)', fontSize: '13px' }}>
        {events.length === 0 ? (
          <Text style={{ color: 'var(--warsha-color-text-muted)' }} dir={dir}>
            {t('advanced.noEvents') || 'No events yet. Start a run to see the live stream.'}
          </Text>
        ) : (
          events.slice(-100).map((event, idx) => (
            <Box key={idx} dir={dir} style={{ marginBottom: 'var(--warsha-space-2)', padding: 'var(--warsha-space-2)', backgroundColor: 'var(--warsha-color-surface-muted)', borderRadius: '4px', borderInlineStart: `3px solid ${ROLE_COLORS[event.role ?? ''] || 'var(--warsha-color-text-muted)'}` }}>
              <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', flexWrap: 'wrap', marginBottom: 'var(--warsha-space-1)' }}>
                <Text style={{ color: 'var(--warsha-color-muted)' }} dir={dir}>{new Date(event.createdAt).toISOString()}</Text>
                <Text style={{ color: ROLE_COLORS[event.role ?? ''] || 'var(--warsha-color-text-muted)' }} dir={dir}>{event.stage}</Text>
                <Text style={{ color: 'var(--warsha-color-text-muted)' }} dir={dir}>{event.kind}</Text>
                {event.costCents !== null && (
                  <Text style={{ color: 'var(--warsha-color-success)' }} dir={dir}>${(event.costCents / 100).toFixed(4)}</Text>
                )}
              </Box>
              <Text style={{ color: 'var(--warsha-color-text)' }} dir={dir}>{JSON.stringify(event.payload).slice(0, 200)}</Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );

  const renderDiffsTab = () => (
    <Box dir={dir} style={{ padding: 'var(--warsha-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-4)' }}>
      <Text weight="bold" size="lg" dir={dir}>
        {t('advanced.diffs') || 'Code Diffs'}
      </Text>
      <Card dir={dir} style={{ flex: 1, overflowY: 'auto' }}>
        <Text style={{ color: 'var(--warsha-color-muted)' }} dir={dir}>
          {t('advanced.diffsPlaceholder') || 'Diffs will appear here when agents modify files. Select a run and stage to view changes.'}
        </Text>
      </Card>
    </Box>
  );

  const renderFilesTab = () => (
    <Box dir={dir} style={{ padding: 'var(--warsha-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-4)' }}>
      <Text weight="bold" size="lg" dir={dir}>
        {t('advanced.fileTree') || 'File Tree'}
      </Text>
      <Card dir={dir} style={{ flex: 1, overflowY: 'auto' }}>
        <Text style={{ color: 'var(--warsha-color-muted)' }} dir={dir}>
          {t('advanced.filesPlaceholder') || 'File tree will appear here. Shows project structure and agent-modified files.'}
        </Text>
      </Card>
    </Box>
  );

  const renderTerminalTab = () => (
    <Box dir={dir} style={{ padding: 'var(--warsha-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-4)', height: '100%' }}>
      <Text weight="bold" size="lg" dir={dir}>
        {t('advanced.terminal') || 'Terminal'}
      </Text>

      <Box dir={dir} style={{ flex: 1, backgroundColor: 'var(--warsha-color-surface-muted)', borderRadius: '8px', padding: 'var(--warsha-space-4)', fontFamily: 'var(--warsha-font-mono)', fontSize: '13px', overflowY: 'auto', display: 'flex', flexDirection: 'column', color: 'var(--warsha-color-text)' }}>
        {terminalOutput.map((line, idx) => (
          <Box key={idx} dir={dir} style={{ 
            color: line.startsWith('$') ? 'var(--warsha-color-success)' : 
                   line.startsWith('Done') ? 'var(--warsha-color-warning)' : 'var(--warsha-color-text)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {line}
          </Box>
        ))}
      </Box>

      <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-2)' }}>
        <Text style={{ color: 'var(--warsha-color-text-muted)', alignSelf: 'center' }} dir={dir}>$</Text>
        <input
          type="text"
          value={terminalInput}
          onChange={(e) => setTerminalInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleTerminalSubmit()}
          placeholder={t('advanced.terminalPlaceholder') || 'Type a command...'}
          dir={dir}
          style={{
            flex: 1,
            backgroundColor: 'var(--warsha-color-surface-muted)',
            border: '1px solid var(--warsha-color-border-strong)',
            borderRadius: '4px',
            padding: 'var(--warsha-space-2) var(--warsha-space-3)',
            color: 'var(--warsha-color-text)',
            fontFamily: 'var(--warsha-font-mono)',
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
    <Box dir={dir} style={{ padding: 'var(--warsha-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-4)' }}>
      <Text weight="bold" size="lg" dir={dir}>
        {t('advanced.kanban') || 'Task Board'}
      </Text>

      <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-4)', flex: 1, overflowX: 'auto' }}>
        {[
          { id: 'backlog', label: locale === 'ar' ? 'قائمة الانتظار' : 'Backlog', color: 'var(--warsha-color-text-muted)' },
          { id: 'todo', label: locale === 'ar' ? 'للقيام' : 'To Do', color: 'var(--warsha-color-accent-strong)' },
          { id: 'in_progress', label: locale === 'ar' ? 'قيد التنفيذ' : 'In Progress', color: 'var(--warsha-color-warning)' },
          { id: 'review', label: locale === 'ar' ? 'مراجعة' : 'Review', color: 'var(--warsha-color-accent-strong)' },
          { id: 'done', label: locale === 'ar' ? 'منجز' : 'Done', color: 'var(--warsha-color-success)' },
        ].map(col => (
          <Box key={col.id} dir={dir} style={{
            minWidth: '280px',
            maxWidth: '280px',
            backgroundColor: 'var(--warsha-color-bg)',
            borderRadius: '8px',
            borderTop: `4px solid ${col.color}`,
            display: 'flex',
            flexDirection: 'column',
          }}>
            <Box dir={dir} style={{ padding: 'var(--warsha-space-3)', borderBottom: '1px solid var(--warsha-color-border)' }}>
              <Text weight="bold" dir={dir}>{col.label}</Text>
            </Box>
            <Box dir={dir} style={{ flex: 1, padding: 'var(--warsha-space-2)', overflowY: 'auto', minHeight: '300px' }}>
              <Text size="sm" style={{ color: 'var(--warsha-color-muted)', textAlign: 'center', padding: '20px' }} dir={dir}>
                {t('advanced.emptyColumn') || 'No tasks'}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );

  const renderSkillsTab = () => (
    <Box dir={dir} style={{ padding: 'var(--warsha-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-4)' }}>
      <Text weight="bold" size="lg" dir={dir}>
        {t('advanced.skillsMcp') || 'Skills / MCP Config'}
      </Text>

      <Card dir={dir} style={{ marginBottom: 'var(--warsha-space-4)' }}>
        <Text weight="medium" dir={dir} style={{ marginBottom: 'var(--warsha-space-3)' }}>
          {t('advanced.installedSkills') || 'Installed Skills'}
        </Text>
        <Box dir={dir} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--warsha-space-2)' }}>
          {['planning', 'task-decomposition', 'code-generation', 'refactoring', 'testing', 'code-review', 'security-audit', 'threat-modeling', 'test-planning'].map(skill => (
            <Button key={skill} variant="ghost" size="sm" dir={dir} style={{ backgroundColor: 'var(--warsha-color-surface-muted)', color: 'var(--warsha-color-accent-strong)' }}>
              {skill}
            </Button>
          ))}
        </Box>
      </Card>

      <Card dir={dir}>
        <Text weight="medium" dir={dir} style={{ marginBottom: 'var(--warsha-space-3)' }}>
          {t('advanced.availableMcp') || 'Available MCP Servers'}
        </Text>
        <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
          {['github', 'filesystem', 'sqlite', 'postgres', 'web-search', 'docker'].map(server => (
            <Box key={server} dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--warsha-space-2)', backgroundColor: 'var(--warsha-color-bg)', borderRadius: '6px' }}>
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
    <Box dir={dir} style={{ padding: 'var(--warsha-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-4)' }}>
      <Text weight="bold" size="lg" dir={dir}>
        {t('advanced.costs') || 'Costs & Budget'}
      </Text>

      <Box dir={dir} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--warsha-space-4)' }}>
        <Card dir={dir}>
          <Text size="sm" style={{ color: 'var(--warsha-color-text-muted)' }} dir={dir}>
            {t('advanced.totalBudget') || 'Total Budget'}
          </Text>
          <Text size="xl" weight="bold" dir={dir}>$100.00</Text>
        </Card>
        <Card dir={dir}>
          <Text size="sm" style={{ color: 'var(--warsha-color-text-muted)' }} dir={dir}>
            {t('advanced.spent') || 'Spent'}
          </Text>
          <Text size="xl" weight="bold" style={{ color: 'var(--warsha-color-error)' }} dir={dir}>$23.45</Text>
        </Card>
        <Card dir={dir}>
          <Text size="sm" style={{ color: 'var(--warsha-color-text-muted)' }} dir={dir}>
            {t('advanced.remaining') || 'Remaining'}
          </Text>
          <Text size="xl" weight="bold" style={{ color: 'var(--warsha-color-success)' }} dir={dir}>$76.55</Text>
        </Card>
        <Card dir={dir}>
          <Text size="sm" style={{ color: 'var(--warsha-color-text-muted)' }} dir={dir}>
            {t('advanced.costPerRun') || 'Cost / Run'}
          </Text>
          <Text size="xl" weight="bold" dir={dir}>$2.35</Text>
        </Card>
      </Box>

      <Card dir={dir} style={{ flex: 1 }}>
        <Text weight="medium" dir={dir} style={{ marginBottom: 'var(--warsha-space-3)' }}>
          {t('advanced.costBreakdown') || 'Cost Breakdown by Role'}
        </Text>
        <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
          {lanes.map(lane => (
            <Box key={lane.id} dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--warsha-space-2)', backgroundColor: 'var(--warsha-color-bg)', borderRadius: '6px' }}>
              <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: 'var(--warsha-space-2)' }}>
                <Box dir={dir} style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: ROLE_COLORS[lane.role] || 'var(--warsha-color-text-muted)' }} />
                <Text dir={dir}>{lane.name}</Text>
              </Box>
              <Text weight="medium" style={{ color: ROLE_COLORS[lane.role] || 'var(--warsha-color-text-muted)' }} dir={dir}>
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
    <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '600px', backgroundColor: 'var(--warsha-color-bg)' }}>
      {/* Header */}
      <Box dir={dir} style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--warsha-space-4)',
        backgroundColor: 'var(--warsha-color-surface)',
        borderBottom: '1px solid var(--warsha-color-border)',
        flexWrap: 'wrap',
        gap: 'var(--warsha-space-3)',
      }}>
        <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: 'var(--warsha-space-3)' }}>
          {onBack && (
            <Button variant="ghost" size="sm" dir={dir} onClick={onBack}>
              ← {t('common.back') || 'Back'}
            </Button>
          )}
          <Text size="xl" weight="bold" style={{ color: 'var(--warsha-color-accent-strong)' }} dir={dir}>{t('app.brand') || 'Warsha'}</Text>
          <Text size="sm" style={{ color: 'var(--warsha-color-text-muted)' }} dir={dir}>{project.name}</Text>
        </Box>

        {/* Tab Bar */}
        <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-1)', backgroundColor: 'var(--warsha-color-surface-muted)', borderRadius: '8px', padding: 'var(--warsha-space-1)' }}>
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