// @warsha/desktop — Main app component with Simple/Advanced mode routing
import React, { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { Box, Text, Button, Card } from '@warsha/ui';
import { LocaleProvider, useLocale, useDirection, t } from '@warsha/i18n';
import { createClient, type WarshaClient, type ProjectSummary, type RunSummary } from '@warsha/client';
import { Onboarding } from './screens/Onboarding';
import { ProjectsBoard } from './screens/ProjectsBoard';
import { RunView } from './screens/RunView';
import { GatesInbox } from './screens/GatesInbox';
import { ArtifactViewer } from './screens/ArtifactViewer';
import { ProvidersSettings } from './screens/ProvidersSettings';
import { RolesSettings } from './screens/RolesSettings';
import { Budgets } from './screens/Budgets';
import { Devices } from './screens/Devices';
import { SimpleMode } from './screens/SimpleMode';
import { AdvancedMode } from './screens/AdvancedMode';
import { SettingsScreen } from './screens/SettingsScreen';
import { invoke } from '@tauri-apps/api/core';

// Screen types
type Screen = 
  | 'onboarding' 
  | 'projects' 
  | 'run' 
  | 'gates' 
  | 'artifacts' 
  | 'providers' 
  | 'roles' 
  | 'budgets' 
  | 'devices'
  | 'simple'
  | 'advanced'
  | 'settings';

// App mode
type AppMode = 'simple' | 'advanced';

// Mode context
interface ModeContextValue {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
}

const ModeContext = createContext<ModeContextValue | null>(null);

export function useMode() {
  const context = useContext(ModeContext);
  if (!context) {
    throw new Error('useMode must be used within ModeProvider');
  }
  return context;
}

// Check if onboarding is complete
async function checkOnboarding(): Promise<boolean> {
  try {
    const result = await invoke<string>('get_config', { key: 'onboarding_complete' });
    return result === 'true';
  } catch {
    return false;
  }
}

// Get saved mode
async function getSavedMode(): Promise<AppMode> {
  try {
    const result = await invoke<string>('get_config', { key: 'app_mode' });
    return (result as AppMode) || 'simple';
  } catch {
    return 'simple';
  }
}

// Save mode
async function saveMode(mode: AppMode): Promise<void> {
  try {
    await invoke('set_config', { key: 'app_mode', value: mode });
  } catch (error) {
    console.error('Failed to save mode:', error);
  }
}

function ModeProvider({ children, initialMode }: { children: ReactNode; initialMode: AppMode }) {
  const [mode, setMode] = useState<AppMode>(initialMode);

  const handleSetMode = async (newMode: AppMode) => {
    setMode(newMode);
    await saveMode(newMode);
  };

  return (
    <ModeContext.Provider value={{ mode, setMode: handleSetMode }}>
      {children}
    </ModeContext.Provider>
  );
}

function AppContent() {
  const dir = useDirection();
  const locale = useLocale();
  const [screen, setScreen] = useState<Screen>('onboarding');
  const [client, setClient] = useState<WarshaClient | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunSummary | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [savedMode, setSavedMode] = useState<AppMode>('simple');

  // Initialize client and load mode
  useEffect(() => {
    const initApp = async () => {
      try {
        const baseUrl = 'http://127.0.0.1:8766';
        const token = 'test-token';
        const apiClient = createClient(baseUrl, token);
        setClient(apiClient);
        
        const complete = await checkOnboarding();
        setOnboardingComplete(complete);
        
        const mode = await getSavedMode();
        setSavedMode(mode);
        
        if (complete) {
          setScreen(mode);
          const projectsData = await apiClient.listProjects();
          setProjects(projectsData);
        } else {
          setScreen('onboarding');
        }
      } catch (error) {
        console.error('Failed to initialize app:', error);
        setScreen('onboarding');
      }
    };
    initApp();
  }, []);

  const handleOnboardingComplete = () => {
    setOnboardingComplete(true);
    setScreen(savedMode);
    if (client) {
      client.listProjects().then(setProjects);
    }
  };

  const handleCreateProject = async (name: string, idea: string) => {
    if (!client) return;
    try {
      const project = await client.createProject(name);
      await client.startRun(project.id as any, idea);
      const projectsData = await client.listProjects();
      setProjects(projectsData);
      setSelectedProject(project);
      const runs = await client.listRuns(project.id as any);
      if (runs.length > 0) {
        setSelectedRun(runs[0]);
        setScreen(savedMode);
      }
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };

  const renderScreen = () => {
    if (!onboardingComplete) {
      return <Onboarding onComplete={handleOnboardingComplete} />;
    }

    if (!client) {
      return (
        <Box dir={dir} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <Text dir={dir}>{t('app.loading') || 'Loading...'}</Text>
        </Box>
      );
    }

    // Main navigation for both modes
    const navigation = (
      <Box dir={dir} style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100vh',
        backgroundColor: '#fafafa'
      }}>
        {/* Top Bar */}
        <Box dir={dir} style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingInline: '16px',
          paddingBlock: '12px',
          backgroundColor: 'white',
          borderBottom: '1px solid #e5e7eb',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}>
          <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Text size="xl" weight="bold" style={{ color: '#2563eb' }}>Warsha</Text>
            <Text size="sm" style={{ color: '#6b7280' }}>{t('app.version') || 'v0.1.0'}</Text>
          </Box>
          
          <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Mode Toggle */}
            <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#f3f4f6', borderRadius: '8px', padding: '4px' }}>
              <Button
                variant={screen === 'simple' ? 'primary' : 'ghost'}
                size="sm"
                dir={dir}
                onClick={() => setScreen('simple')}
              >
                {t('app.simpleMode') || 'Simple'}
              </Button>
              <Button
                variant={screen === 'advanced' ? 'primary' : 'ghost'}
                size="sm"
                dir={dir}
                onClick={() => setScreen('advanced')}
              >
                {t('app.advancedMode') || 'Advanced'}
              </Button>
            </Box>
            
            <Button variant="ghost" size="sm" dir={dir} onClick={() => setScreen('settings')}>
              {t('app.settings') || 'Settings'}
            </Button>
          </Box>
        </Box>

        {/* Content */}
        <Box dir={dir} style={{ flex: 1, overflow: 'auto' }}>
          {renderMainContent()}
        </Box>
      </Box>
    );

    return (
      <ModeProvider initialMode={savedMode}>
        {navigation}
      </ModeProvider>
    );
  };

  const renderMainContent = () => {
    if (!client) {
      return (
        <Box dir={dir} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <Text dir={dir}>{t('app.loading') || 'Loading...'}</Text>
        </Box>
      );
    }

    switch (screen) {
      case 'projects':
        return <ProjectsBoard client={client} onProjectSelect={handleProjectSelect} />;
      
      case 'run': {
        const run = selectedRun;
        if (!run) return <ProjectsBoard client={client} onProjectSelect={handleProjectSelect} />;
        return <RunView client={client} run={run} onBack={() => setScreen('projects')} />;
      }
      
      case 'simple': {
        const project = selectedProject;
        if (!project) return <ProjectsBoard client={client} onProjectSelect={handleProjectSelect} />;
        return <SimpleMode client={client} project={project} onBack={() => setScreen('projects')} />;
      }
      
      case 'advanced': {
        const project = selectedProject;
        if (!project) return <ProjectsBoard client={client} onProjectSelect={handleProjectSelect} />;
        return <AdvancedMode client={client} project={project} onBack={() => setScreen('projects')} />;
      }
      
      case 'gates': {
        const run = selectedRun;
        if (!run) return <ProjectsBoard client={client} onProjectSelect={handleProjectSelect} />;
        return <GatesInbox client={client} run={run} onBack={() => setScreen('run')} />;
      }
      
      case 'artifacts': {
        const run = selectedRun;
        if (!run) return <ProjectsBoard client={client} onProjectSelect={handleProjectSelect} />;
        return <ArtifactViewer client={client} run={run} onBack={() => setScreen('run')} />;
      }
      
      case 'providers':
        return <ProvidersSettings client={client} onBack={() => setScreen('projects')} />;
      
      case 'roles':
        return <RolesSettings client={client} onBack={() => setScreen('projects')} />;
      
      case 'budgets':
        return <Budgets client={client} onBack={() => setScreen('projects')} />;
      
      case 'devices':
        return <Devices client={client} onBack={() => setScreen('projects')} />;
      
      case 'settings':
        return <SettingsScreen client={client} onBack={() => setScreen('projects')} />;
      
      default:
        return <ProjectsBoard client={client} onProjectSelect={handleProjectSelect} />;
    }
  };

  const handleProjectSelect = (project: ProjectSummary) => {
    setSelectedProject(project);
    setScreen(savedMode);
  };

  return (
    <LocaleProvider initialLocale={locale as 'ar' | 'en'}>
      <Box dir={dir} className="app" style={{ minHeight: '100vh', backgroundColor: '#fafafa' }}>
        {renderScreen()}
      </Box>
    </LocaleProvider>
  );
}

export default function App() {
  return <AppContent />;
}