// Simple Mode — Chat with bots/agents (modeled on Grok Bot / openbot.run)
// Left sidebar: bots/agents list, Center: chat, Right: team activity summary
import React, { useState, useEffect } from 'react';
import { Box, Text, Button, Card } from '@warsha/ui';
import { useLocale, useDirection, t } from '@warsha/i18n';
import { type WarshaClient, type ProjectSummary, type RunSummary, type GateSummary, type WarshaEvent, type Stage, subscribeEvents } from '@warsha/client';

interface SimpleModeProps {
  client: WarshaClient;
  project: ProjectSummary;
  onBack?: () => void;
}

interface Agent {
  id: string;
  name: string;
  role: string;
  avatar: string;
  model: string;
  status: 'idle' | 'working' | 'waiting' | 'done';
  unreadCount: number;
  lastMessage?: string;
  lastActivity?: string;
}

interface ChatMessage {
  id: string;
  agentId: string;
  sender: 'user' | 'agent';
  content: string;
  timestamp: string;
  stage?: string;
}

const ROLE_AVATARS: Record<string, string> = {
  Orchestrator: '🎯',
  Intake: '📥',
  Researcher: '🔍',
  Pm: '📋',
  Designer: '🎨',
  Architect: '🏗️',
  Coder: '💻',
  Reviewer: '✅',
  Qa: '🧪',
  Security: '🔒',
  Release: '🚀',
  Marketer: '📢',
  Feedback: '💬',
};

const ROLE_NAMES: Record<string, { ar: string; en: string }> = {
  Orchestrator: { ar: 'المنسق', en: 'Orchestrator' },
  Intake: { ar: 'الاستقبال', en: 'Intake' },
  Researcher: { ar: 'الباحث', en: 'Researcher' },
  Pm: { ar: 'مدير المشروع', en: 'Project Manager' },
  Designer: { ar: 'المصمم', en: 'Designer' },
  Architect: { ar: 'المهندس', en: 'Architect' },
  Coder: { ar: 'المبرمج', en: 'Coder' },
  Reviewer: { ar: 'المراجع', en: 'Reviewer' },
  Qa: { ar: 'الجودة', en: 'QA' },
  Security: { ar: 'الأمان', en: 'Security' },
  Release: { ar: 'الإصدار', en: 'Release' },
  Marketer: { ar: 'التسويق', en: 'Marketer' },
  Feedback: { ar: 'التغذية الراجعة', en: 'Feedback' },
};

export function SimpleMode({ client, project, onBack }: SimpleModeProps) {
  const dir = useDirection();
  const locale = useLocale();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [pendingGates, setPendingGates] = useState<GateSummary[]>([]);
  const [recentActivity, setRecentActivity] = useState<WarshaEvent[]>([]);

  // Initialize agents
  useEffect(() => {
    const initAgents = async () => {
      try {
        const runs = await client.listRuns(project.id as any);
        const currentRun = runs[0] as RunSummary | undefined;

        const baseAgents: Agent[] = [
          { id: 'orchestrator', name: 'Orchestrator', role: 'Orchestrator', avatar: '🎯', model: 'gpt-4o', status: 'working', unreadCount: 2 },
          { id: 'intake', name: 'Intake', role: 'Intake', avatar: '📥', model: 'gpt-4o-mini', status: 'done', unreadCount: 0 },
          { id: 'researcher', name: 'Researcher', role: 'Researcher', avatar: '🔍', model: 'gpt-4o', status: 'working', unreadCount: 1 },
          { id: 'pm', name: 'PM', role: 'Pm', avatar: '📋', model: 'claude-3-5-sonnet', status: 'idle', unreadCount: 0 },
          { id: 'designer', name: 'Designer', role: 'Designer', avatar: '🎨', model: 'gpt-4o', status: 'idle', unreadCount: 0 },
          { id: 'architect', name: 'Architect', role: 'Architect', avatar: '🏗️', model: 'claude-3-5-sonnet', status: 'idle', unreadCount: 0 },
          { id: 'coder', name: 'Coder', role: 'Coder', avatar: '💻', model: 'gpt-4o', status: 'idle', unreadCount: 0 },
          { id: 'reviewer', name: 'Reviewer', role: 'Reviewer', avatar: '✅', model: 'gpt-4o-mini', status: 'idle', unreadCount: 0 },
          { id: 'qa', name: 'QA', role: 'Qa', avatar: '🧪', model: 'gpt-4o-mini', status: 'idle', unreadCount: 0 },
          { id: 'security', name: 'Security', role: 'Security', avatar: '🔒', model: 'claude-3-5-sonnet', status: 'idle', unreadCount: 0 },
          { id: 'release', name: 'Release', role: 'Release', avatar: '🚀', model: 'gpt-4o-mini', status: 'idle', unreadCount: 0 },
          { id: 'marketer', name: 'Marketer', role: 'Marketer', avatar: '📢', model: 'gpt-4o-mini', status: 'idle', unreadCount: 0 },
        ];

        setAgents(baseAgents);
        setSelectedAgent(baseAgents[0]);

        // Load gates if a run exists; the live stream is wired in a separate effect.
        if (currentRun) {
          const gates = await client.getGates(currentRun.id as any);
          setPendingGates(gates.filter((g: GateSummary) => g.state.state === 'pending'));
        }

        // Welcome message
        setMessages([{
          id: 'welcome',
          agentId: 'orchestrator',
          sender: 'agent',
          content: locale === 'ar'
            ? `أهلاً بك في مشروع ${project.name}! 🎯\n\nأنا المنسق، وسأقود فريق العمل. اسألني أي شيء عن المشروع، أو انتظر بينما يعمل الفريق على المراحل.`
            : `Welcome to ${project.name}! 🎯\n\nI'm the Orchestrator, leading the team. Ask me anything about the project, or watch as the team works through the stages.`,
          timestamp: new Date().toISOString(),
        }]);
      } catch (error) {
        console.error('Failed to initialize agents:', error);
      }
    };
    initAgents();
  }, [client, project, locale]);

  // Subscribe to the daemon event stream so the activity panel stays live.
  useEffect(() => {
    const subscription = subscribeEvents({
      url: 'http://127.0.0.1:8766',
      token: 'test-token',
      onEvent: (event: WarshaEvent) => {
        setRecentActivity(prev => [...prev, event].slice(-10));
      },
      onError: (error: Error) => {
        console.error('Event stream error:', error.message);
      },
    });
    return () => subscription.close();
  }, []);

  const refreshGates = async () => {
    const runs = await client.listRuns(project.id as any);
    const currentRun = runs[0];
    if (!currentRun) return;
    const gates = await client.getGates(currentRun.id as any);
    setPendingGates(gates.filter((g: GateSummary) => g.state.state === 'pending'));
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !selectedAgent) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      agentId: selectedAgent.id,
      sender: 'user',
      content: inputMessage,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');

    // Mock agent response (in real app, sends to daemon)
    setTimeout(() => {
      const agentResponse: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        agentId: selectedAgent.id,
        sender: 'agent',
        content: locale === 'ar'
          ? `فهمت! أعمل على "${inputMessage}". سأعود إليك قريباً.`
          : `Understood! Working on "${inputMessage}". I'll get back to you shortly.`,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, agentResponse]);
    }, 1000);
  };

  const handleApproveGate = async (stage: Stage) => {
    try {
      const runs = await client.listRuns(project.id as any);
      const currentRun = runs[0];
      if (currentRun) {
        await client.approveGate(currentRun.id as any, stage);
        await refreshGates();
      }
    } catch (error) {
      console.error('Failed to approve gate:', error);
    }
  };

  const handleRejectGate = async (stage: Stage) => {
    try {
      const runs = await client.listRuns(project.id as any);
      const currentRun = runs[0];
      if (currentRun) {
        await client.rejectGate(currentRun.id as any, stage, 'Needs more work');
        await refreshGates();
      }
    } catch (error) {
      console.error('Failed to reject gate:', error);
    }
  };

  const getStatusColor = (status: Agent['status']) => {
    switch (status) {
      case 'working': return '#10b981';
      case 'waiting': return '#f59e0b';
      case 'done': return '#6b7280';
      default: return '#9ca3af';
    }
  };

  return (
    <Box dir={dir} style={{ display: 'flex', height: '100%', minHeight: '600px' }}>
      {/* Left Sidebar — Agents List */}
      <Box dir={dir} style={{
        width: '280px',
        minWidth: '280px',
        backgroundColor: 'white',
        borderInlineEnd: '1px solid #e5e7eb',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <Box dir={dir} style={{ padding: '16px', borderBottom: '1px solid #e5e7eb' }}>
          {onBack && (
            <Button variant="ghost" size="sm" dir={dir} onClick={onBack} style={{ marginBottom: '8px' }}>
              ← {t('common.back') || 'Back'}
            </Button>
          )}
          <Text weight="bold" size="lg" dir={dir}>{project.name}</Text>
          <Text size="sm" style={{ color: '#6b7280' }} dir={dir}>
            {t('simple.team') || '12 team members'}
          </Text>
        </Box>

        <Box dir={dir} style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {agents.map(agent => (
            <Box
              key={agent.id}
              dir={dir}
              onClick={() => {
                setSelectedAgent(agent);
                setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, unreadCount: 0 } : a));
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px',
                borderRadius: '8px',
                cursor: 'pointer',
                backgroundColor: selectedAgent?.id === agent.id ? '#eff6ff' : 'transparent',
                border: selectedAgent?.id === agent.id ? '1px solid #bfdbfe' : '1px solid transparent',
                marginBottom: '4px',
              }}
            >
              <Box dir={dir} style={{ position: 'relative' }}>
                <Box dir={dir} style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  backgroundColor: '#f3f4f6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                }}>
                  {agent.avatar}
                </Box>
                <Box dir={dir} style={{
                  position: 'absolute',
                  bottom: 0,
                  insetInlineEnd: 0,
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  backgroundColor: getStatusColor(agent.status),
                  border: '2px solid white',
                }} />
              </Box>

              <Box dir={dir} style={{ flex: 1, minWidth: 0 }}>
                <Box dir={dir} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text weight="medium" size="sm" dir={dir} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {locale === 'ar' ? ROLE_NAMES[agent.role]?.ar || agent.name : agent.name}
                  </Text>
                  {agent.unreadCount > 0 && (
                    <Box dir={dir} style={{
                      backgroundColor: '#2563eb',
                      color: 'white',
                      borderRadius: '9999px',
                      paddingInline: '6px',
                      paddingBlock: '2px',
                      fontSize: '12px',
                      fontWeight: 600,
                      minWidth: '20px',
                      textAlign: 'center',
                    }}>
                      {agent.unreadCount}
                    </Box>
                  )}
                </Box>
                <Text size="sm" style={{ color: '#6b7280' }} dir={dir}>
                  {agent.model} • {agent.status}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Center — Chat */}
      <Box dir={dir} style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#fafafa' }}>
        {/* Chat Header */}
        <Box dir={dir} style={{
          padding: '16px',
          backgroundColor: 'white',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}>
          {selectedAgent && (
            <>
              <Box dir={dir} style={{ fontSize: '24px' }}>{selectedAgent.avatar}</Box>
              <Box dir={dir}>
                <Text weight="bold" dir={dir}>
                  {locale === 'ar' ? ROLE_NAMES[selectedAgent.role]?.ar || selectedAgent.name : selectedAgent.name}
                </Text>
                <Text size="sm" style={{ color: '#6b7280' }} dir={dir}>
                  {selectedAgent.model} • {selectedAgent.status}
                </Text>
              </Box>
            </>
          )}
        </Box>

        {/* Gate Approval Cards */}
        {pendingGates.length > 0 && (
          <Box dir={dir} style={{ padding: '16px', backgroundColor: '#fef3c7', borderBottom: '1px solid #fcd34d' }}>
            <Text weight="bold" dir={dir} style={{ marginBottom: '8px' }}>
              {t('simple.pendingApproval') || 'Pending Approval'} ({pendingGates.length})
            </Text>
            {pendingGates.map(gate => (
              <Card key={gate.stage as string} dir={dir} style={{ marginBottom: '8px', border: '1px solid #f59e0b' }}>
                <Text weight="medium" dir={dir}>{gate.stage as string}</Text>
                <Text size="sm" style={{ color: '#6b7280', marginBlock: '8px' }} dir={dir}>
                  {t('simple.gateReady') || 'Gate is ready for review'}
                </Text>
                <Box dir={dir} style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <Button variant="primary" size="sm" dir={dir} onClick={() => handleApproveGate(gate.stage)}>
                    ✅ {t('common.approve') || 'Approve'}
                  </Button>
                  <Button variant="secondary" size="sm" dir={dir} onClick={() => handleRejectGate(gate.stage)}>
                    ❌ {t('common.reject') || 'Reject'}
                  </Button>
                </Box>
              </Card>
            ))}
          </Box>
        )}

        {/* Messages */}
        <Box dir={dir} style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {messages.map(msg => (
            <Box
              key={msg.id}
              dir={dir}
              style={{
                display: 'flex',
                justifyContent: msg.sender === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <Box dir={dir} style={{
                maxWidth: '70%',
                padding: '12px 16px',
                borderRadius: '12px',
                backgroundColor: msg.sender === 'user' ? '#2563eb' : 'white',
                color: msg.sender === 'user' ? 'white' : '#1f2937',
                boxShadow: msg.sender === 'agent' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                whiteSpace: 'pre-wrap',
              }}>
                <Text dir={dir} style={{ color: 'inherit' }}>{msg.content}</Text>
              </Box>
            </Box>
          ))}
        </Box>

        {/* Input */}
        <Box dir={dir} style={{
          padding: '16px',
          backgroundColor: 'white',
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          gap: '8px',
        }}>
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder={locale === 'ar' ? 'اكتب رسالتك...' : 'Type your message...'}
            dir={dir}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: '8px',
              border: '1px solid #d1d5db',
              fontSize: '14px',
              outline: 'none',
            }}
          />
          <Button variant="primary" dir={dir} onClick={handleSendMessage}>
            {t('common.send') || 'Send'} →
          </Button>
        </Box>
      </Box>

      {/* Right Panel — Team Activity */}
      <Box dir={dir} style={{
        width: '320px',
        minWidth: '320px',
        backgroundColor: 'white',
        borderInlineStart: '1px solid #e5e7eb',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <Box dir={dir} style={{ padding: '16px', borderBottom: '1px solid #e5e7eb' }}>
          <Text weight="bold" size="lg" dir={dir}>
            {t('simple.teamActivity') || 'Team Activity'}
          </Text>
          <Text size="sm" style={{ color: '#6b7280' }} dir={dir}>
            {t('simple.whatsHappening') || 'What’s happening'}
          </Text>
        </Box>

        <Box dir={dir} style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {recentActivity.length === 0 ? (
            <Text size="sm" style={{ color: '#9ca3af' }} dir={dir}>
              {t('simple.noActivity') || 'No activity yet. The team will start working soon.'}
            </Text>
          ) : (
            recentActivity.map((event: WarshaEvent) => (
              <Box key={event.id} dir={dir} style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #f3f4f6' }}>
                <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <Box dir={dir} style={{ fontSize: '16px' }}>
                    {ROLE_AVATARS[event.role || 'Orchestrator'] || '🤖'}
                  </Box>
                  <Text weight="medium" size="sm" dir={dir}>
                    {locale === 'ar' ? ROLE_NAMES[event.role || '']?.ar || event.role || 'Orchestrator' : event.role || 'Orchestrator'}
                  </Text>
                </Box>
                <Text size="sm" style={{ color: '#4b5563' }} dir={dir}>
                  {event.stage} • {event.kind}
                </Text>
                {event.costCents !== null && (
                  <Text size="sm" style={{ color: '#059669' }} dir={dir}>
                    ${(event.costCents / 100).toFixed(4)}
                  </Text>
                )}
              </Box>
            ))
          )}
        </Box>

        {/* Team Summary */}
        <Box dir={dir} style={{ padding: '16px', borderTop: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
          <Text weight="medium" size="sm" dir={dir} style={{ marginBottom: '8px' }}>
            {t('simple.teamSummary') || 'Team Summary'}
          </Text>
          <Text size="sm" style={{ color: '#4b5563', lineHeight: 1.6 }} dir={dir}>
            {locale === 'ar'
              ? `المنسق يقود الفريق. الباحث يجمع المعلومات. ${pendingGates.length} بوابة بانتظار الموافقة.`
              : `Orchestrator is leading. Researcher is gathering info. ${pendingGates.length} gates awaiting approval.`}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}