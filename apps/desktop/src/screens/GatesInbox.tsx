// Gates inbox — Approve/reject with device confirmation
import React, { useState, useEffect } from 'react';
import { Box, Text, Button, Card } from '@warsha/ui';
import { t, useDirection, useLocale } from '@warsha/i18n';
import { WarshaClient, type RunSummary, type GateState, type DeviceId } from '@warsha/client';

interface GatesInboxProps {
  client: WarshaClient;
  run: RunSummary;
  onBack: () => void;
}

const GATE_STAGES = ['gate_a', 'gate_b', 'gate_c', 'gate_d'] as const;
const GATE_LABELS = {
  'gate_a': { ar: 'البوابة أ', en: 'Gate A' },
  'gate_b': { ar: 'البوابة ب', en: 'Gate B' },
  'gate_c': { ar: 'البوابة ج', en: 'Gate C' },
  'gate_d': { ar: 'البوابة د', en: 'Gate D' },
};

export function GatesInbox({ client, run, onBack }: GatesInboxProps) {
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
          <span style={{ color: '#059669', fontWeight: 500 }}>
            ✓ {locale === 'ar' ? 'موافق عليه' : 'Approved'}
          </span>
        );
      case 'rejected':
        return (
          <span style={{ color: '#dc2626', fontWeight: 500 }}>
            ✗ {locale === 'ar' ? 'مرفوض' : 'Rejected'}
            {state.reason && <Text size="xs" dir={dir} style={{ color: '#6b7280', marginTop: '4px' }}>{state.reason}</Text>}
          </span>
        );
      case 'changes_requested':
        return (
          <span style={{ color: '#d97706', fontWeight: 500 }}>
            ↻ {locale === 'ar' ? 'تغييرات مطلوبة' : 'Changes Requested'}
            {state.notes && <Text size="xs" dir={dir} style={{ color: '#6b7280', marginTop: '4px' }}>{state.notes}</Text>}
          </span>
        );
      case 'pending':
      default:
        return (
          <span style={{ color: '#d97706', fontWeight: 500 }}>
            ⏳ {locale === 'ar' ? 'في الانتظار' : 'Pending'}
          </span>
        );
    }
  };

  const canAct = (state: GateState) => state.state === 'pending';

  return (
    <Box dir={dir} className="gates-inbox" style={{ padding: '24px', minHeight: 'calc(100vh - 80px)' }}>
      <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <Box dir={dir}>
          <Button variant="ghost" size="sm" onClick={onBack} dir={dir} style={{ marginBottom: '8px' }}>
            ← {locale === 'ar' ? 'رجوع' : 'Back'}
          </Button>
          <Text size="xl" weight="bold" dir={dir}>
            {locale === 'ar' ? 'صندوق الوارد للبوابات' : 'Gates Inbox'}
          </Text>
          <Text size="md" dir={dir} style={{ color: '#6b7280' }}>
            {run.projectId}
          </Text>
        </Box>
      </Box>

      {loading ? (
        <Box dir={dir} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px' }}>
          <Text dir={dir}>{locale === 'ar' ? 'جاري التحميل...' : 'Loading...'}</Text>
        </Box>
      ) : (
        <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '800px' }}>
          {gates.map((gate, index) => (
            <Card key={gate.stage} dir={dir} style={{ 
              backgroundColor: gate.state.state === 'pending' ? '#fffbeb' : 'white',
              borderLeft: `4px solid ${gate.state.state === 'approved' ? '#10b981' : gate.state.state === 'rejected' ? '#ef4444' : gate.state.state === 'changes_requested' ? '#f59e0b' : '#f59e0b'}`,
            }}>
              <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
                <Box dir={dir}>
                  <Text weight="bold" size="lg" dir={dir}>
                    {GATE_LABELS[gate.stage as keyof typeof GATE_LABELS]?.[locale] || gate.stage}
                  </Text>
                  <Text size="sm" dir={dir} style={{ color: '#6b7280', marginTop: '4px' }}>
                    {locale === 'ar' ? `البوابة ${index + 1} من ${gates.length}` : `Gate ${index + 1} of ${gates.length}`}
                  </Text>
                </Box>
                <Box dir={dir} style={{ textAlign: dir === 'rtl' ? 'right' : 'left' }}>
                  {renderGateState(gate.state)}
                </Box>
              </Box>

              {canAct(gate.state) && (
                <Box dir={dir} style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #e5e7eb' }}>
                  <Text weight="medium" size="sm" dir={dir} style={{ marginBottom: '12px' }}>
                    {locale === 'ar' ? 'الإجراء المطلوب' : 'Action Required'}
                  </Text>
                  
                  {selectedGate === gate.stage && action && (
                    <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {action === 'reject' && (
                        <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <textarea
                            placeholder={locale === 'ar' ? 'سبب الرفض...' : 'Reason for rejection...'}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                            style={{
                              padding: '12px',
                              border: '1px solid #d1d5db',
                              borderRadius: '6px',
                              fontSize: '0.875rem',
                              fontFamily: 'inherit',
                              resize: 'vertical',
                            }}
                            dir={dir}
                          />
                          <Box dir={dir} style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
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
                        <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <textarea
                            placeholder={locale === 'ar' ? 'ملاحظات التغييرات المطلوبة...' : 'Notes for requested changes...'}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                            style={{
                              padding: '12px',
                              border: '1px solid #d1d5db',
                              borderRadius: '6px',
                              fontSize: '0.875rem',
                              fontFamily: 'inherit',
                              resize: 'vertical',
                            }}
                            dir={dir}
                          />
                          <Box dir={dir} style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
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
                        <Box dir={dir} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
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