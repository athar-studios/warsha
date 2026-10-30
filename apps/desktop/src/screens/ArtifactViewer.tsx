// Artifact viewer/editor — Markdown with syntax highlighting
import { WarshaClient, type RunSummary } from '@warsha/client';
import { useDirection, useLocale } from '@warsha/i18n';
import { Box, Text, Button, Card } from '@warsha/ui';
import React, { useState } from 'react';

interface ArtifactViewerProps {
  client: WarshaClient;
  run: RunSummary;
  onBack: () => void;
}

export function ArtifactViewer({ run, onBack }: ArtifactViewerProps) {
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
        borderInlineEnd: '1px solid var(--warsha-color-border)',
        backgroundColor: 'var(--warsha-color-bg)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <Box dir={dir} style={{ padding: 'var(--warsha-space-4)', borderBottom: '1px solid var(--warsha-color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text weight="bold" dir={dir}>
            {locale === 'ar' ? 'المصنوعات' : 'Artifacts'}
          </Text>
          <Button variant="ghost" size="sm" onClick={onBack} dir={dir}>
            ←
          </Button>
        </Box>
        
        <Box dir={dir} style={{ flex: 1, overflowY: 'auto', padding: 'var(--warsha-space-2)' }}>
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
                  backgroundColor: selectedArtifact === artifact.key ? 'var(--warsha-color-surface-muted)' : 'transparent',
                  color: selectedArtifact === artifact.key ? 'var(--warsha-color-accent-strong)' : 'var(--warsha-color-text)',
                }}
              >
                <span>{artifact.label[locale]}</span>
                {exists && (
                  <span style={{ fontSize: 'var(--warsha-font-size-xs)', color: 'var(--warsha-color-success)' }}>●</span>
                )}
              </Button>
            );
          })}
        </Box>
      </Box>

      {/* Main content */}
      <Box dir={dir} style={{ flex: 1, padding: 'var(--warsha-space-6)', overflowY: 'auto', backgroundColor: 'var(--warsha-color-surface)' }}>
        {selectedArtifact ? (
          <Box dir={dir}>
            <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--warsha-space-4)' }}>
              <Text size="xl" weight="bold" dir={dir}>
                {artifactList.find(a => a.key === selectedArtifact)?.label[locale] || selectedArtifact}
              </Text>
              <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-2)' }}>
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
              <Box dir={dir} style={{ border: '1px solid var(--warsha-color-border)', borderRadius: '8px', overflow: 'hidden' }}>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: '500px',
                    padding: 'var(--warsha-space-4)',
                    border: 'none',
                    outline: 'none',
                    fontFamily: 'var(--warsha-font-mono)',
                    fontSize: 'var(--warsha-font-size-sm)',
                    lineHeight: '1.6',
                    resize: 'vertical',
                    direction: 'ltr',
                  }}
                  dir="ltr"
                  spellCheck={false}
                />
              </Box>
            ) : (
              <Box dir={dir} style={{ border: '1px solid var(--warsha-color-border)', borderRadius: '8px', overflow: 'hidden' }}>
                <pre style={{
                  width: '100%',
                  minHeight: '500px',
                  padding: 'var(--warsha-space-4)',
                  margin: 0,
                  backgroundColor: 'var(--warsha-color-bg)',
                  fontFamily: 'var(--warsha-font-mono)',
                  fontSize: 'var(--warsha-font-size-sm)',
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
          <Card dir={dir} style={{ textAlign: 'center', padding: 'var(--warsha-space-16) var(--warsha-space-8)', maxWidth: '480px', margin: '0 auto', marginTop: 'var(--warsha-space-16)' }}>
            <Text size="xl" weight="bold" dir={dir} style={{ marginBottom: 'var(--warsha-space-2)' }}>
              {locale === 'ar' ? 'اختر مصنوعة' : 'Select an Artifact'}
            </Text>
            <Text size="md" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
              {locale === 'ar' ? 'اختر من القائمة الجانبية لعرض أو تحرير مصنوعة' : 'Select from the sidebar to view or edit an artifact'}
            </Text>
          </Card>
        )}
      </Box>
    </Box>
  );
}