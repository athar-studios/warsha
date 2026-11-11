import type { FileEntry } from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  Card,
  CodeView,
  EmptyState,
  IconButton,
  IconCopy,
  IconFile,
  IconFolder,
  Skeleton,
// eslint-disable-next-line import/no-unresolved
} from '@warsha/ui/v3';
import React, { useState } from 'react';

import { useClient } from '../../../app/ClientContext';
import { copyTextToClipboard } from '../helpers';

export interface FilesTabProps {
  projectId: string;
  files: FileEntry[];
  status: 'loading' | 'empty' | 'error' | 'ready';
  onReload: () => void;
}

export const FilesTab: React.FC<FilesTabProps> = ({
  projectId,
  files,
  status,
  onReload,
}) => {
  const t = useT();
  const client = useClient();

  const [expandedDirs, setExpandedDirs] = useState<Record<string, FileEntry[]>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  const toggleDir = async (path: string) => {
    if (expandedDirs[path]) {
      setExpandedDirs((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
      return;
    }
    if (!client) {
      setExpandedDirs((prev) => ({ ...prev, [path]: [] }));
      return;
    }
    try {
      const children = await client.getFilesTree(projectId, path);
      setExpandedDirs((prev) => ({ ...prev, [path]: children }));
    } catch {
      setExpandedDirs((prev) => ({ ...prev, [path]: [] }));
    }
  };

  const openFile = async (path: string) => {
    setSelectedPath(path);
    if (!client) return;
    setContentLoading(true);
    setContentError(null);
    try {
      const result = await client.readFileContent(projectId, path);
      setFileContent(result.content);
    } catch (err) {
      setContentError(err instanceof Error ? err.message : String(err));
      setFileContent('');
    } finally {
      setContentLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (fileContent) {
      copyTextToClipboard(fileContent);
    }
  };

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-2)' }}>
        <Skeleton height="var(--w-space-8)" />
        <Skeleton height="var(--w-space-8)" />
        <Skeleton height="var(--w-space-8)" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <Banner
        variant="danger"
        action={
          <Button variant="secondary" size="sm" onClick={onReload} data-action="bench.files.open">
            {t('bench.retry')}
          </Button>
        }
      >
        {t('bench.error')}
      </Banner>
    );
  }

  if (status === 'empty' || files.length === 0) {
    return (
      <div
        role="tabpanel"
        id="bench-panel-files"
        aria-labelledby="bench-tab-files"
        data-testid="bench-tabpanel-files"
      >
        <EmptyState
          icon={<IconFolder size={20} />}
          title={t('bench.files.empty')}
          data-testid="bench-files-empty"
        />
      </div>
    );
  }

  const renderEntry = (entry: FileEntry, depth = 0): React.ReactNode => {
    const isExpanded = Boolean(expandedDirs[entry.path]);
    const children = expandedDirs[entry.path] ?? [];
    return (
      <li
        key={entry.path}
        style={{
          paddingInlineStart: depth > 0 ? 'var(--w-space-4)' : 0,
        }}
      >
        {entry.isDir ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<IconFolder size={14} />}
              aria-expanded={isExpanded}
              onClick={() => void toggleDir(entry.path)}
              data-action="bench.files.expand"
              data-testid={`file-tree-dir-${entry.name}`}
              style={{ width: '100%', justifyContent: 'flex-start' }}
            >
              {entry.name}
            </Button>
            {isExpanded && children.length > 0 && (
              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--w-space-1)',
                }}
              >
                {children.map((child) => renderEntry(child, depth + 1))}
              </ul>
            )}
          </>
        ) : (
          <Button
            variant={selectedPath === entry.path ? 'secondary' : 'ghost'}
            size="sm"
            icon={<IconFile size={14} />}
            onClick={() => void openFile(entry.path)}
            data-action="bench.files.open"
            data-testid={`file-tree-file-${entry.name}`}
            style={{ width: '100%', justifyContent: 'flex-start' }}
          >
            <span dir="ltr" style={{ fontFamily: 'var(--w-font-mono)' }}>
              {entry.name}
            </span>
          </Button>
        )}
      </li>
    );
  };

  return (
    <div
      role="tabpanel"
      id="bench-panel-files"
      aria-labelledby="bench-tab-files"
      data-testid="bench-tabpanel-files"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(var(--w-rail-width), 1fr))',
        gap: 'var(--w-space-4)',
      }}
    >
      <Card title={t('bench.files.root')} style={{ minWidth: 0 }}>
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--w-space-1)',
          }}
        >
          {files.map((file) => renderEntry(file, 0))}
        </ul>
      </Card>

      <div style={{ minWidth: 0 }}>
        {selectedPath ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-2)' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingInline: 'var(--w-space-2)',
              }}
            >
              <span dir="ltr" style={{ fontFamily: 'var(--w-font-mono)', fontSize: 'var(--w-font-size-sm)' }}>
                {selectedPath}
              </span>
              <IconButton
                icon={<IconCopy size={16} />}
                label={t('bench.action.code_copy')}
                variant="ghost"
                size="sm"
                onClick={handleCopyCode}
                data-action="bench.code.copy"
                data-testid="bench-code-copy-btn"
              />
            </div>

            {contentLoading ? (
              <Skeleton height="var(--w-space-10)" />
            ) : contentError ? (
              <Banner variant="danger">{contentError}</Banner>
            ) : (
              <CodeView code={fileContent} filename={selectedPath} />
            )}
          </div>
        ) : (
          <EmptyState
            icon={<IconFile size={20} />}
            title={t('bench.files.select_hint')}
          />
        )}
      </div>
    </div>
  );
};

FilesTab.displayName = 'FilesTab';
