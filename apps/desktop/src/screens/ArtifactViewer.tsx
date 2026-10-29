// Artifact viewer/editor — Markdown with syntax highlighting
import React, { useState } from 'react';
import { Box, Text, Button, Card } from '@warsha/ui';
import { t, useDirection, useLocale } from '@warsha/i18n';
import { WarshaClient, type RunSummary } from '@warsha/client';

interface ArtifactViewerProps {
  client: WarshaClient;
  run: RunSummary;
  onBack: () => void;
}

export function ArtifactViewer({ client, run, onBack }: ArtifactViewerProps) {
  const dir = useDirection();
  const locale = useLocale();
  const [artifacts, setArtifacts] = useState<Record<string, string>>({});
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [content, setContent] = useState('');

  const artifactList = [
    { key: 'idea', label: { ar: 'الفكرة', en: 'Idea' } },
    { key: 'research', label: { ar: 'البحث', en: 'Research' } },
    { key: 'prd_spec', label: { ar: 'مواصفات المنتج', en: 'PRD Spec' } },
    { key: 'design', label: { ar: 'التصميم', en: 'Design' } },
    { key: 'plan_tasks', label: { ar: 'خطة المهام', en: 'Plan Tasks' } },
    { key: 'code', label: { ar: 'الكود', en: 'Code' } },
    { key: 'review_qa_security', label: { ar: 'المراجعة/الجودة/الأمان', en: 'Review/QA/Security' } },
    { key: 'release', label: { ar: 'الإصدار', en: 'Release' } },
    { key: 'launch_drafts', label: { ar: 'مسودات الإطلاق', en: 'Launch Drafts' } },
    { key: 'feedback', label: { ar: 'التغذية الراجعة', en: 'Feedback' } },
  ];

  React.useEffect(() => {
    // Mock artifacts
    setArtifacts({
      idea: '# Project Idea\n\nBuild a todo app with React and TypeScript.',
      research: '# Research Report\n\n## Competitors\n- Todoist\n- Microsoft To Do\n\n## Tech Stack\n- React 18\n- TypeScript\n- Vite',
      prd_spec: '# PRD Spec\n\n## User Stories\n1. As a user, I want to add todos\n2. As a user, I want to mark todos as complete',
    });
  }, [run.id]);

  const handleSelect = (key: string) => {
    setSelectedArtifact(key);
    setContent(artifacts[key] || '');
    setEditMode(false);
  };

  const handleSave = () => {
    if (selectedArtifact) {
      setArtifacts(prev => ({ ...prev, [selectedArtifact]: content }));
      setEditMode(false);
    }
  };

  const handleExport = () => {
    if (selectedArtifact) {
      const blob = new Blob([content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedArtifact}.md`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <Box dir={dir} className="artifact-viewer" style={{ display: 'flex', height: 'calc(100vh - 80px)' }}>
      {/* Sidebar */}
      <Box dir={dir} style={{ 
        width: '280px', 
        borderRight: '1px solid #e5e7eb',
        backgroundColor: '#fafafa',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <Box dir={dir} style={{ padding: '16px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text weight="bold" dir={dir}>
            {locale === 'ar' ? 'المصنوعات' : 'Artifacts'}
          </Text>
          <Button variant="ghost" size="sm" onClick={onBack} dir={dir}>
            ←
          </Button>
        </Box>
        
        <Box dir={dir} style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {artifactList.map(artifact => {
            const exists = artifacts[artifact.key];
            return (
              <Button
                key={artifact.key}
                variant={selectedArtifact === artifact.key ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => handleSelect(artifact.key)}
                dir={dir}
                style={{ 
                  width: '100%', 
                  justifyContent: 'space-between',
                  textAlign: dir === 'rtl' ? 'right' : 'left',
                  backgroundColor: selectedArtifact === artifact.key ? '#dbeafe' : 'transparent',
                  color: selectedArtifact === artifact.key ? '#1d4ed8' : '#374151',
                }}
              >
                <span>{artifact.label[locale]}</span>
                {exists && (
                  <span style={{ fontSize: '0.75rem', color: '#10b981' }}>●</span>
                )}
              </Button>
            );
          })}
        </Box>
      </Box>

      {/* Main content */}
      <Box dir={dir} style={{ flex: 1, padding: '24px', overflowY: 'auto', backgroundColor: 'white' }}>
        {selectedArtifact ? (
          <Box dir={dir}>
            <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <Text size="xl" weight="bold" dir={dir}>
                {artifactList.find(a => a.key === selectedArtifact)?.label[locale] || selectedArtifact}
              </Text>
              <Box dir={dir} style={{ display: 'flex', gap: '8px' }}>
                {!editMode && (
                  <>
                    <Button variant="secondary" onClick={() => setEditMode(true)} dir={dir}>
                      {locale === 'ar' ? 'تحرير' : 'Edit'}
                    </Button>
                    <Button variant="ghost" onClick={handleExport} dir={dir}>
                      {locale === 'ar' ? 'تصدير' : 'Export'}
                    </Button>
                  </>
                )}
                {editMode && (
                  <>
                    <Button variant="secondary" onClick={() => setEditMode(false)} dir={dir}>
                      {locale === 'ar' ? 'إلغاء' : 'Cancel'}
                    </Button>
                    <Button variant="primary" onClick={handleSave} dir={dir}>
                      {locale === 'ar' ? 'حفظ' : 'Save'}
                    </Button>
                  </>
                )}
              </Box>
            </Box>

            {editMode ? (
              <Box dir={dir} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: '500px',
                    padding: '16px',
                    border: 'none',
                    outline: 'none',
                    fontFamily: 'monospace',
                    fontSize: '0.875rem',
                    lineHeight: '1.6',
                    resize: 'vertical',
                    direction: 'ltr',
                  }}
                  dir="ltr"
                  spellCheck={false}
                />
              </Box>
            ) : (
              <Box dir={dir} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                <pre style={{
                  width: '100%',
                  minHeight: '500px',
                  padding: '16px',
                  margin: 0,
                  backgroundColor: '#f9fafb',
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  lineHeight: '1.6',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordWrap: 'break-word',
                }}>
                  {content}
                </pre>
              </Box>
            )}
          </Box>
        ) : (
          <Card dir={dir} style={{ textAlign: 'center', padding: '64px 32px', maxWidth: '480px', margin: '0 auto', marginTop: '64px' }}>
            <Text size="xl" weight="bold" dir={dir} style={{ marginBottom: '8px' }}>
              {locale === 'ar' ? 'اختر مصنوعة' : 'Select an Artifact'}
            </Text>
            <Text size="md" dir={dir} style={{ color: '#6b7280' }}>
              {locale === 'ar' ? 'اختر من القائمة الجانبية لعرض أو تحرير مصنوعة' : 'Select from the sidebar to view or edit an artifact'}
            </Text>
          </Card>
        )}
      </Box>
    </Box>
  );
}