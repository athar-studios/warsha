// Gates inbox — Approve/reject with device confirmation
import { WarshaClient, type RunSummary, type GateState, type DeviceId } from '@warsha/client';
import { useDirection, useLocale } from '@warsha/i18n';
import { Box, Text, Button, Card } from '@warsha/ui';
import React, { useState, useEffect } from 'react';

interface GatesInboxProps {
  client: WarshaClient;
  run: RunSummary;
  onBack: () => void;
}

const GATE_LABELS = {
  'gate_a': { ar: 'البوابة أ', en: 'Gate A' },
  'gate_b': { ar: 'البوابة ب', en: 'Gate B' },
  'gate_c': { ar: 'البوابة ج', en: 'Gate C' },
  'gate_d': { ar: 'البوابة د', en: 'Gate D' },
};

export function GatesInbox({ run, onBack }: GatesInboxProps) {
  const dir = useDirection();
  const locale = useLocale();
  const [gates, setGates] = useState<Array<{ stage: string; state: GateState }>>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGate, setSelectedGate] = useState<string | null>(null);
  const [action, setAction] = useState<'approve' | 'reject' | 'changes' | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    loadGates();
  }, [run.id]);

  const loadGates = async () => {
    try {
      // In real app: const gatesData = await client.getGates(run.id);
      // Mock data for now
      setGates([
        { stage: 'gate_a', state: { state: 'pending' } },
        { stage: 'gate_b', state: { state: 'pending' } },
        { stage: 'gate_c', state: { state: 'pending' } },
        { stage: 'gate_d', state: { state: 'pending' } },
      ]);
    } catch (error) {
      console.error('Failed to load gates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (stage: string) => {
    try {
      // await client.approveGate(run.id, stage as any);
      setGates(prev => prev.map(g => 
        g.stage === stage ? { ...g, state: { state: 'approved', by: 'device-1' as DeviceId, at: new Date().toISOString() } } : g
      ));
      setSelectedGate(null);
    } catch (error) {
      console.error('Failed to approve gate:', error);
    }
  };

  const handleReject = async (stage: string) => {
    if (!reason.trim()) return;
    try {
      // await client.rejectGate(run.id, stage as any, reason);
      setGates(prev => prev.map(g => 
        g.stage === stage ? { ...g, state: { state: 'rejected', reason, by: 'device-1' as DeviceId, at: new Date().toISOString() } } : g
      ));
      setSelectedGate(null);
      setReason('');
    } catch (error) {
      console.error('Failed to reject gate:', error);
    }
  };

  const handleChanges = async (stage: string) => {
    if (!reason.trim()) return;
    try {
      // await client.requestChanges(run.id, stage as any, reason);
      setGates(prev => prev.map(g => 
        g.stage === stage ? { ...g, state: { state: 'changes_requested', notes: reason, by: 'device-1' as DeviceId, at: new Date().toISOString() } } : g
      ));
      setSelectedGate(null);
      setReason('');
    } catch (error) {
      console.error('Failed to request changes:', error);
    }
  };

  const renderGateState = (state: GateState) => {
    switch (state.state) {
      case 'approved':
        return (
          <span style={{ color: 'var(--warsha-color-success)', fontWeight: 500 }}>
            ✓ {locale === 'ar' ? 'موافق عليه' : 'Approved'}
          </span>
        );
      case 'rejected':
        return (
          <span style={{ color: 'var(--warsha-color-error)', fontWeight: 500 }}>
            ✗ {locale === 'ar' ? 'مرفوض' : 'Rejected'}
            {state.reason && <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text-muted)', marginTop: 'var(--warsha-space-1)' }}>{state.reason}</Text>}
          </span>
        );
      case 'changes_requested':
        return (
          <span style={{ color: 'var(--warsha-color-warning)', fontWeight: 500 }}>
            ↻ {locale === 'ar' ? 'تغييرات مطلوبة' : 'Changes Requested'}
            {state.notes && <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text-muted)', marginTop: 'var(--warsha-space-1)' }}>{state.notes}</Text>}
          </span>
        );
      case 'pending':
      default:
        return (
          <span style={{ color: 'var(--warsha-color-warning)', fontWeight: 500 }}>
            ⏳ {locale === 'ar' ? 'في الانتظار' : 'Pending'}
          </span>
        );
    }
  };

  const canAct = (state: GateState) => state.state === 'pending';

  return (
    <Box dir={dir} className="gates-inbox" style={{ padding: 'var(--warsha-space-6)', minHeight: 'calc(100vh - 80px)' }}>
      <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--warsha-space-6)' }}>
        <Box dir={dir}>
          <Button variant="ghost" size="sm" onClick={onBack} dir={dir} style={{ marginBottom: 'var(--warsha-space-2)' }}>
            ← {locale === 'ar' ? 'رجوع' : 'Back'}
          </Button>
          <Text size="xl" weight="bold" dir={dir}>
            {locale === 'ar' ? 'صندوق الوارد للبوابات' : 'Gates Inbox'}
          </Text>
          <Text size="md" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
            {run.projectId}
          </Text>
        </Box>
      </Box>

      {loading ? (
        <Box dir={dir} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px' }}>
          <Text dir={dir}>{locale === 'ar' ? 'جاري التحميل...' : 'Loading...'}</Text>
        </Box>
      ) : (
        <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-4)', maxWidth: '800px' }}>
          {gates.map((gate, index) => (
            <Card key={gate.stage} dir={dir} style={{ 
              backgroundColor: gate.state.state === 'pending' ? 'var(--warsha-color-surface-muted)' : 'var(--warsha-color-surface)',
              borderInlineStart: `4px solid ${gate.state.state === 'approved' ? 'var(--warsha-color-success)' : gate.state.state === 'rejected' ? 'var(--warsha-color-error)' : gate.state.state === 'changes_requested' ? 'var(--warsha-color-warning)' : 'var(--warsha-color-warning)'}`,
            }}>
              <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--warsha-space-4)' }}>
                <Box dir={dir}>
                  <Text weight="bold" size="lg" dir={dir}>
                    {GATE_LABELS[gate.stage as keyof typeof GATE_LABELS]?.[locale] || gate.stage}
                  </Text>
                  <Text size="sm" dir={dir} style={{ color: 'var(--warsha-color-text-muted)', marginTop: 'var(--warsha-space-1)' }}>
                    {locale === 'ar' ? `البوابة ${index + 1} من ${gates.length}` : `Gate ${index + 1} of ${gates.length}`}
                  </Text>
                </Box>
                <Box dir={dir} style={{ textAlign: dir === 'rtl' ? 'right' : 'left' }}>
                  {renderGateState(gate.state)}
                </Box>
              </Box>

              {canAct(gate.state) && (
                <Box dir={dir} style={{ marginTop: 'var(--warsha-space-4)', paddingTop: 'var(--warsha-space-4)', borderTop: '1px solid var(--warsha-color-border)' }}>
                  <Text weight="medium" size="sm" dir={dir} style={{ marginBottom: 'var(--warsha-space-3)' }}>
                    {locale === 'ar' ? 'الإجراء المطلوب' : 'Action Required'}
                  </Text>
                  
                  {selectedGate === gate.stage && action && (
                    <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-3)' }}>
                      {action === 'reject' && (
                        <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
                          <textarea
                            placeholder={locale === 'ar' ? 'سبب الرفض...' : 'Reason for rejection...'}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                            style={{
                              padding: 'var(--warsha-space-3)',
                              border: '1px solid var(--warsha-color-border-strong)',
                              borderRadius: '6px',
                              fontSize: 'var(--warsha-font-size-sm)',
                              fontFamily: 'inherit',
                              resize: 'vertical',
                            }}
                            dir={dir}
                          />
                          <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-2)', justifyContent: 'flex-end' }}>
                            <Button variant="secondary" size="sm" onClick={() => { setSelectedGate(null); setAction(null); }} dir={dir}>
                              {locale === 'ar' ? 'إلغاء' : 'Cancel'}
                            </Button>
                            <Button variant="primary" size="sm" onClick={() => handleReject(gate.stage)} dir={dir}>
                              {locale === 'ar' ? 'رفض' : 'Reject'}
                            </Button>
                          </Box>
                        </Box>
                      )}
                      {action === 'changes' && (
                        <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
                          <textarea
                            placeholder={locale === 'ar' ? 'ملاحظات التغييرات المطلوبة...' : 'Notes for requested changes...'}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                            style={{
                              padding: 'var(--warsha-space-3)',
                              border: '1px solid var(--warsha-color-border-strong)',
                              borderRadius: '6px',
                              fontSize: 'var(--warsha-font-size-sm)',
                              fontFamily: 'inherit',
                              resize: 'vertical',
                            }}
                            dir={dir}
                          />
                          <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-2)', justifyContent: 'flex-end' }}>
                            <Button variant="secondary" size="sm" onClick={() => { setSelectedGate(null); setAction(null); }} dir={dir}>
                              {locale === 'ar' ? 'إلغاء' : 'Cancel'}
                            </Button>
                            <Button variant="primary" size="sm" onClick={() => handleChanges(gate.stage)} dir={dir}>
                              {locale === 'ar' ? 'طلب تعديلات' : 'Request Changes'}
                            </Button>
                          </Box>
                        </Box>
                      )}
                      {!action && (
                        <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
                          <Button variant="primary" size="sm" onClick={() => { setSelectedGate(gate.stage); setAction('approve'); handleApprove(gate.stage); }} dir={dir}>
                            ✓ {locale === 'ar' ? 'موافقة' : 'Approve'}
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => { setSelectedGate(gate.stage); setAction('reject'); }} dir={dir}>
                            ✗ {locale === 'ar' ? 'رفض' : 'Reject'}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => { setSelectedGate(gate.stage); setAction('changes'); }} dir={dir}>
                            ↻ {locale === 'ar' ? 'طلب تعديلات' : 'Request Changes'}
                          </Button>
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
              )}
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}