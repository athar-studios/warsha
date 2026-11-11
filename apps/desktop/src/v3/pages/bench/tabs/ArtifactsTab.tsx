import type { RunArtifact } from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
import {
  Button,
  Card,
  CodeView,
  EmptyState,
  IconCopy,
  IconFile,
  Sheet,
// eslint-disable-next-line import/no-unresolved
} from '@warsha/ui/v3';
import React, { useState } from 'react';

import { copyTextToClipboard } from '../helpers';

export interface ArtifactsTabProps {
  artifacts: RunArtifact[];
}

export const ArtifactsTab: React.FC<ArtifactsTabProps> = ({ artifacts }) => {
  const t = useT();
  const [selectedArtifact, setSelectedArtifact] = useState<RunArtifact | null>(null);

  const handleCopyPath = (name: string) => {
    copyTextToClipboard(`artifacts/${name}`);
  };

  return (
    <div
      role="tabpanel"
      id="bench-panel-artifacts"
      aria-labelledby="bench-tab-artifacts"
      data-testid="bench-tabpanel-artifacts"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w-space-4)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 'var(--w-font-size-md)',
            fontWeight: 'var(--w-font-weight-semibold)',
            color: 'var(--w-text)',
          }}
        >
          {t('bench.artifacts.title')}
        </h2>
      </div>

      {artifacts.length === 0 ? (
        <EmptyState
          icon={<IconFile size={20} />}
          title={t('bench.artifacts.empty')}
          data-testid="bench-artifacts-empty"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-2)' }}>
          {artifacts.map((art) => (
            <Card
              key={art.name}
              data-testid={`bench-artifact-item-${art.name}`}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--w-space-3)',
                gap: 'var(--w-space-3)',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-1)', minWidth: 0 }}>
                <div style={{ fontWeight: 'var(--w-font-weight-medium)', fontSize: 'var(--w-font-size-sm)' }}>
                  {art.name}
                </div>
                <div style={{ fontSize: 'var(--w-font-size-xs)', color: 'var(--w-text-muted)' }}>
                  {t(`bench.stage.${art.stage}`)} · {t('bench.artifacts.version', { version: art.version })}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w-space-2)' }}>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<IconCopy size={14} />}
                  onClick={() => handleCopyPath(art.name)}
                  data-action="bench.artifact.copy-path"
                  data-testid={`bench-artifact-copy-btn-${art.name}`}
                >
                  {t('bench.action.artifact_copy_path')}
                </Button>

                <Button
                  variant="secondary"
                  size="sm"
                  icon={<IconFile size={14} />}
                  onClick={() => setSelectedArtifact(art)}
                  data-action="bench.artifact.open"
                  data-testid={`bench-artifact-open-btn-${art.name}`}
                >
                  {t('bench.action.artifact_open')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {selectedArtifact && (
        <Sheet
          open={Boolean(selectedArtifact)}
          onClose={() => setSelectedArtifact(null)}
          title={selectedArtifact.name}
          description={`${t(`bench.stage.${selectedArtifact.stage}`)} · v${selectedArtifact.version}`}
          closeLabel={t('bench.header.cancel')}
        >
          <CodeView
            code={selectedArtifact.content}
            filename={selectedArtifact.name}
          />
        </Sheet>
      )}
    </div>
  );
};

ArtifactsTab.displayName = 'ArtifactsTab';
