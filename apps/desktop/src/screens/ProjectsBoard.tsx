// Projects board — Kanban columns = stages
import { type ProjectSummary, type RunSummary, type Stage, WarshaClient } from '@warsha/client';
import { useDirection, useLocale } from '@warsha/i18n';
import { Box, Text, Button, Card } from '@warsha/ui';
import React, { useState, useEffect } from 'react';

const STAGE_COLUMNS: { stage: Stage; label: string; isGate: boolean }[] = [
  { stage: 'idea', label: 'Idea', isGate: false },
  { stage: 'gate_a', label: 'Gate A', isGate: true },
  { stage: 'research', label: 'Research', isGate: false },
  { stage: 'prd_spec', label: 'PRD Spec', isGate: false },
  { stage: 'gate_b', label: 'Gate B', isGate: true },
  { stage: 'design', label: 'Design', isGate: false },
  { stage: 'plan_tasks', label: 'Plan Tasks', isGate: false },
  { stage: 'code', label: 'Code', isGate: false },
  { stage: 'review_qa_security', label: 'Review/QA/Sec', isGate: false },
  { stage: 'gate_c', label: 'Gate C', isGate: true },
  { stage: 'release', label: 'Release', isGate: false },
  { stage: 'gate_d', label: 'Gate D', isGate: true },
  { stage: 'launch_drafts', label: 'Launch Drafts', isGate: false },
  { stage: 'feedback', label: 'Feedback', isGate: false },
];

interface RunWithProject extends RunSummary {
  projectName: string;
}

interface ProjectsBoardProps {
  client: WarshaClient;
  onProjectSelect?: (project: ProjectSummary) => void;
}

export function ProjectsBoard({ client, onProjectSelect }: ProjectsBoardProps) {
  const dir = useDirection();
  const locale = useLocale();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [runsByStage, setRunsByStage] = useState<Record<Stage, RunWithProject[]>>({} as Record<Stage, RunWithProject[]>);
  const [loading, setLoading] = useState(true);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectIdea, setNewProjectIdea] = useState('');

  // `loadData` is declared below and only reads `client`, which is a prop, so an empty dependency
  // array is the correct "load once on mount" behaviour. Behaviour is unchanged.
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load-once on mount; client is a stable prop
  }, []);

  const loadData = async () => {
    try {
      const projectsData = await client.listProjects();
      setProjects(projectsData);
      
      const allRuns: RunWithProject[] = [];
      for (const project of projectsData) {
        const runs = await client.listRuns(project.id);
        allRuns.push(...runs.map(r => ({ ...r, projectName: project.name })));
      }
      
      const grouped: Record<Stage, RunWithProject[]> = {} as Record<Stage, RunWithProject[]>;
      for (const col of STAGE_COLUMNS) {
        grouped[col.stage] = allRuns.filter(r => r.stage === col.stage);
      }
      setRunsByStage(grouped);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !newProjectIdea.trim()) return;
    
    try {
      const project = await client.createProject(newProjectName);
      await client.startRun(project.id, newProjectIdea);
      setShowNewProject(false);
      setNewProjectName('');
      setNewProjectIdea('');
      loadData();
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };

  const handleOpenRun = (run: RunWithProject) => {
    const project = projects.find(p => p.id === run.projectId);
    if (project) {
      onProjectSelect?.(project);
    }
  };

  const renderColumn = (stage: Stage, label: string, isGate: boolean) => {
    const runs = runsByStage[stage] || [];
    const count = runs.length;
    
    return (
      <Box key={stage} dir={dir} style={{
        minWidth: '280px',
        maxWidth: '280px',
        backgroundColor: isGate ? 'var(--warsha-color-surface-muted)' : 'var(--warsha-color-bg)',
        borderRadius: '12px',
        padding: 'var(--warsha-space-3)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '600px',
      }}>
        <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--warsha-space-3)' }}>
          <Text weight="bold" size="sm" dir={dir} style={{ 
            color: isGate ? 'var(--warsha-color-warning)' : 'var(--warsha-color-text)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            {locale === 'ar' && isGate ? 'بوابة' : label}
          </Text>
          <Text size="xs" dir={dir} style={{ 
            backgroundColor: isGate ? 'var(--warsha-color-surface-muted)' : 'var(--warsha-color-border)',
            padding: '2px var(--warsha-space-2)',
            borderRadius: '9999px',
            color: isGate ? 'var(--warsha-color-warning)' : 'var(--warsha-color-text-muted)',
          }}>
            {count}
          </Text>
        </Box>
        
        <Box dir={dir} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
          {runs.length === 0 ? (
            <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-muted)', textAlign: 'center', marginTop: '40px' }}>
              {isGate 
                ? (locale === 'ar' ? 'في انتظار الموافقة' : 'Awaiting approval')
                : (locale === 'ar' ? 'فارغ' : 'Empty')}
            </Text>
          ) : (
            runs.map(run => (
              <Card key={run.id} dir={dir} onClick={() => handleOpenRun(run)} style={{ cursor: 'pointer' }}>
                <Text weight="medium" size="sm" dir={dir} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {run.projectName}
                </Text>
                <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
                  {new Date(run.startedAt).toLocaleDateString(locale)}
                </Text>
              </Card>
            ))
          )}
        </Box>
      </Box>
    );
  };

  return (
    <Box dir={dir} className="projects-board" style={{ padding: 'var(--warsha-space-6)', minHeight: 'calc(100vh - 80px)' }}>
      <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--warsha-space-6)' }}>
        <Text size="xl" weight="bold" dir={dir}>
          {locale === 'ar' ? 'لوحة المشاريع' : 'Projects Board'}
        </Text>
        <Button variant="primary" onClick={() => setShowNewProject(true)} dir={dir}>
          + {locale === 'ar' ? 'مشروع جديد' : 'New Project'}
        </Button>
      </Box>

      {loading ? (
        <Box dir={dir} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '400px' }}>
          <Text dir={dir}>{locale === 'ar' ? 'جاري التحميل...' : 'Loading...'}</Text>
        </Box>
      ) : (
        <Box dir={dir} style={{ 
          display: 'flex', 
          gap: 'var(--warsha-space-4)', 
          overflowX: 'auto',
          paddingBottom: 'var(--warsha-space-6)',
          minHeight: '600px',
        }}>
          {STAGE_COLUMNS.map(col => renderColumn(col.stage, col.label, col.isGate))}
        </Box>
      )}

      {showNewProject && (
        <div style={{
          position: 'fixed',
          top: 0,
          insetInlineStart: 0,
          insetInlineEnd: 0,
          bottom: 0,
          backgroundColor: 'var(--warsha-color-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          direction: dir,
        }}>
          <Card dir={dir} style={{ width: '100%', maxWidth: '480px', margin: 'var(--warsha-space-4)' }}>
            <Text size="lg" weight="bold" dir={dir} style={{ marginBottom: 'var(--warsha-space-6)' }}>
              {locale === 'ar' ? 'مشروع جديد' : 'New Project'}
            </Text>
            
            <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-4)' }}>
              <input
                type="text"
                placeholder={locale === 'ar' ? 'اسم المشروع' : 'Project name'}
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                style={{
                  padding: 'var(--warsha-space-3)',
                  border: '1px solid var(--warsha-color-border-strong)',
                  borderRadius: '6px',
                  fontSize: 'var(--warsha-font-size-md)',
                }}
                dir={dir}
              />
              <textarea
                placeholder={locale === 'ar' ? 'صف فكرتك هنا...' : 'Describe your idea...'}
                value={newProjectIdea}
                onChange={(e) => setNewProjectIdea(e.target.value)}
                rows={4}
                style={{
                  padding: 'var(--warsha-space-3)',
                  border: '1px solid var(--warsha-color-border-strong)',
                  borderRadius: '6px',
                  fontSize: 'var(--warsha-font-size-md)',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
                dir={dir}
              />
              <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', justifyContent: 'flex-end' }}>
                <Button variant="secondary" onClick={() => setShowNewProject(false)} dir={dir}>
                  {locale === 'ar' ? 'إلغاء' : 'Cancel'}
                </Button>
                <Button variant="primary" onClick={handleCreateProject} dir={dir}>
                  {locale === 'ar' ? 'إنشاء' : 'Create'}
                </Button>
              </Box>
            </Box>
          </Card>
        </div>
      )}
    </Box>
  );
}