// Roles settings — Set role routing (provider/model per role)
import React, { useState, useEffect } from 'react';
import { Box, Text, Button, Card } from '@warsha/ui';
import { t, useDirection, useLocale } from '@warsha/i18n';
import { WarshaClient, type RoleRoutingConfig, type RoutingTargetConfig, type Role } from '@warsha/client';

interface RolesSettingsProps {
  client: WarshaClient;
  onBack: () => void;
}

const ROLES: Role[] = [
  'intake', 'researcher', 'pm', 'designer', 'architect', 
  'coder', 'reviewer', 'qa', 'security', 'release', 'marketer', 'feedback'
];

const ROLE_LABELS: Record<Role, { ar: string; en: string }> = {
  intake: { ar: 'الاستقبال', en: 'Intake' },
  researcher: { ar: 'الباحث', en: 'Researcher' },
  pm: { ar: 'مدير المنتج', en: 'Product Manager' },
  designer: { ar: 'المصمم', en: 'Designer' },
  architect: { ar: 'المهندس المعماري', en: 'Architect' },
  coder: { ar: 'المبرمج', en: 'Coder' },
  reviewer: { ar: 'المراجع', en: 'Reviewer' },
  qa: { ar: 'ضمان الجودة', en: 'QA' },
  security: { ar: 'الأمان', en: 'Security' },
  release: { ar: 'الإصدار', en: 'Release' },
  marketer: { ar: 'المسوق', en: 'Marketer' },
  feedback: { ar: 'التغذية الراجعة', en: 'Feedback' },
};

export function RolesSettings({ client, onBack }: RolesSettingsProps) {
  const dir = useDirection();
  const locale = useLocale();
  const [roles, setRoles] = useState<RoleRoutingConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [providers] = useState([{ id: 'openai-gpt4', name: 'OpenAI GPT-4' }, { id: 'anthropic-claude', name: 'Anthropic Claude' }, { id: 'ollama-local', name: 'Ollama Local' }]);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [editTargets, setEditTargets] = useState<Array<{ provider: string; model: string; weight: number }>>([]);

  useEffect(() => {
    loadRoles();
  }, []);

  const loadRoles = async () => {
    try {
      // const data = await client.listRoles();
      // Mock data
      setRoles([
        { role: 'intake', targets: [{ provider_id: 'openai-gpt4', model_id: 'gpt-4o', weight: 100 }], fallback_enabled: true, budget_cents_per_run: 500 },
        { role: 'researcher', targets: [{ provider_id: 'openai-gpt4', model_id: 'gpt-4o', weight: 100 }], fallback_enabled: true, budget_cents_per_run: 1000 },
        { role: 'pm', targets: [{ provider_id: 'anthropic-claude', model_id: 'claude-3-5-sonnet', weight: 100 }], fallback_enabled: true, budget_cents_per_run: 1000 },
      ]);
    } catch (error) {
      console.error('Failed to load roles:', error);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (roleConfig: RoleRoutingConfig) => {
    setEditingRole(roleConfig.role);
    setEditTargets(roleConfig.targets.map(t => ({ provider: t.provider_id, model: t.model_id, weight: t.weight })));
  };

  const handleSave = async () => {
    if (!editingRole) return;
    
    try {
      const config: RoleRoutingConfig = {
        role: editingRole,
        targets: editTargets.map(t => ({ provider_id: t.provider, model_id: t.model, weight: t.weight })),
        fallback_enabled: true,
        budget_cents_per_run: 500,
      };
      // await client.setRole(config);
      setRoles(prev => prev.map(r => r.role === editingRole ? config : r));
      setEditingRole(null);
    } catch (error) {
      console.error('Failed to save role:', error);
    }
  };

  const addTarget = () => {
    setEditTargets(prev => [...prev, { provider: providers[0]?.id || '', model: '', weight: 100 }]);
  };

  const removeTarget = (index: number) => {
    setEditTargets(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <Box dir={dir} className="roles-settings" style={{ padding: '24px', minHeight: 'calc(100vh - 80px)', maxWidth: '1000px' }}>
      <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <Box dir={dir}>
          <Button variant="ghost" size="sm" onClick={onBack} dir={dir} style={{ marginBottom: '8px' }}>
            ← {locale === 'ar' ? 'رجوع' : 'Back'}
          </Button>
          <Text size="xl" weight="bold" dir={dir}>
            {locale === 'ar' ? 'إعدادات الأدوار' : 'Role Settings'}
          </Text>
          <Text size="md" dir={dir} style={{ color: '#6b7280' }}>
            {locale === 'ar' ? 'تعيين توجيه المزود/النموذج لكل دور' : 'Assign provider/model routing per role'}
          </Text>
        </Box>
      </Box>

      {loading ? (
        <Box dir={dir} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px' }}>
          <Text dir={dir}>{locale === 'ar' ? 'جاري التحميل...' : 'Loading...'}</Text>
        </Box>
      ) : (
        <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {editingRole ? (
            <Card dir={dir}>
              <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <Text size="lg" weight="bold" dir={dir}>
                  {locale === 'ar' ? 'تحرير' : 'Editing'}: {ROLE_LABELS[editingRole]?.[locale] || editingRole}
                </Text>
                <Button variant="secondary" onClick={() => setEditingRole(null)} dir={dir}>
                  {locale === 'ar' ? 'إلغاء' : 'Cancel'}
                </Button>
              </Box>

              <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {editTargets.map((target, index) => (
                  <Card key={index} dir={dir} style={{ backgroundColor: '#f9fafb' }}>
                    <Box dir={dir} style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <Box dir={dir} style={{ flex: 1, minWidth: '150px' }}>
                        <Text size="xs" weight="medium" dir={dir} style={{ marginBottom: '4px', color: '#6b7280' }}>
                          {locale === 'ar' ? 'المزود' : 'Provider'}
                        </Text>
                        <select
                          value={target.provider}
                          onChange={(e) => {
                            setEditTargets(prev => prev.map((t, i) => i === index ? { ...t, provider: e.target.value } : t));
                          }}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: '1px solid #d1d5db',
                            borderRadius: '6px',
                            fontSize: '0.875rem',
                          }}
                          dir={dir}
                        >
                          {providers.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </Box>
                      
                      <Box dir={dir} style={{ flex: 1, minWidth: '150px' }}>
                        <Text size="xs" weight="medium" dir={dir} style={{ marginBottom: '4px', color: '#6b7280' }}>
                          {locale === 'ar' ? 'النموذج' : 'Model'}
                        </Text>
                        <input
                          type="text"
                          placeholder="gpt-4o"
                          value={target.model}
                          onChange={(e) => {
                            setEditTargets(prev => prev.map((t, i) => i === index ? { ...t, model: e.target.value } : t));
                          }}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: '1px solid #d1d5db',
                            borderRadius: '6px',
                            fontSize: '0.875rem',
                            direction: 'ltr',
                          }}
                          dir="ltr"
                        />
                      </Box>
                      
                      <Box dir={dir} style={{ width: '100px' }}>
                        <Text size="xs" weight="medium" dir={dir} style={{ marginBottom: '4px', color: '#6b7280' }}>
                          {locale === 'ar' ? 'الوزن' : 'Weight'}
                        </Text>
                        <input
                          type="number"
                          min="1"
                          max="100"
                          value={target.weight}
                          onChange={(e) => {
                            setEditTargets(prev => prev.map((t, i) => i === index ? { ...t, weight: parseInt(e.target.value) || 100 } : t));
                          }}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: '1px solid #d1d5db',
                            borderRadius: '6px',
                            fontSize: '0.875rem',
                            direction: 'ltr',
                          }}
                          dir="ltr"
                        />
                      </Box>
                      
                      <Button variant="ghost" size="sm" onClick={() => removeTarget(index)} dir={dir} style={{ color: '#ef4444' }}>
                        ✗
                      </Button>
                    </Box>
                  </Card>
                ))}

                <Button variant="ghost" onClick={addTarget} dir={dir} style={{ width: 'fit-content' }}>
                  + {locale === 'ar' ? 'إضافة هدف' : 'Add Target'}
                </Button>

                <Box dir={dir} style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '16px' }}>
                  <Button variant="secondary" onClick={() => setEditingRole(null)} dir={dir}>
                    {locale === 'ar' ? 'إلغاء' : 'Cancel'}
                  </Button>
                  <Button variant="primary" onClick={handleSave} dir={dir}>
                    {locale === 'ar' ? 'حفظ' : 'Save'}
                  </Button>
                </Box>
              </Box>
            </Card>
          ) : (
            <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {ROLES.map(role => {
                const config = roles.find(r => r.role === role);
                const targets = config?.targets || [];
                return (
                  <Card key={role} dir={dir} style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    backgroundColor: config ? 'white' : '#f9fafb',
                  }}>
                    <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                      <Text weight="bold" dir={dir}>{ROLE_LABELS[role]?.[locale] || role}</Text>
                      {config && targets.length > 0 && (
                        <Box dir={dir} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {targets.map((t, i) => (
                            <span key={i} style={{
                              padding: '2px 8px',
                              backgroundColor: '#dbeafe',
                              color: '#1d4ed8',
                              borderRadius: '9999px',
                              fontSize: '0.75rem',
                              fontWeight: 500,
                            }}>
                              {t.provider_id}:{t.model_id}
                            </span>
                          ))}
                        </Box>
                      )}
                      {!config && (
                        <Text size="sm" dir={dir} style={{ color: '#9ca3af' }}>
                          {locale === 'ar' ? 'غير مهيأ' : 'Not configured'}
                        </Text>
                      )}
                    </Box>
                    
                    <Button variant={config ? 'secondary' : 'primary'} size="sm" onClick={() => startEdit(config || { role, targets: [], fallback_enabled: true, budget_cents_per_run: 500 })} dir={dir}>
                      {config ? (locale === 'ar' ? 'تعديل' : 'Edit') : (locale === 'ar' ? 'تهيئة' : 'Configure')}
                    </Button>
                  </Card>
                );
              })}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}