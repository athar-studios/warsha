import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { search, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine, highlightSpecialChars, drawSelection, dropCursor, keymap } from '@codemirror/view';
import { useT } from '@warsha/i18n/v3';
import { Banner, EmptyState, IconCode } from '@warsha/ui/v3';
import React, { useEffect, useRef, useState } from 'react';

import { useClient } from '../../app/ClientContext';
import { useRoute } from '../../router/Router';

import { CodeSkeleton } from './CodeSkeleton';

const langMap: Record<string, Extension> = {
  rs: rust(),
  ts: javascript({ typescript: true }),
  tsx: javascript({ typescript: true }),
  js: javascript(),
  json: json(),
  py: python(),
  css: css(),
  html: html(),
  md: markdown(),
};

/** Reads the `?a=b` query that follows the route inside `window.location.hash`. */
function readHashSearchParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  const hash = window.location.hash;
  const qIdx = hash.indexOf('?');
  return new URLSearchParams(qIdx >= 0 ? hash.slice(qIdx + 1) : '');
}

/** Tracks the hash query; the router only re-renders on path changes, not on `?file=a` -> `?file=b`. */
function useHashSearch(): string {
  const [hashSearch, setHashSearch] = useState<string>(() => readHashSearchParams().toString());
  useEffect(() => {
    const sync = () => setHashSearch(readHashSearchParams().toString());
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  return hashSearch;
}

const CodeViewer: React.FC = () => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { params } = useRoute();
  const t = useT();
  const client = useClient();
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const hashSearch = useHashSearch();
  const searchParams = new URLSearchParams(hashSearch);
  const projectId = searchParams.get('projectId') || params.projectId || null;
  const filePath = searchParams.get('file');
  const line = searchParams.get('line');

  useEffect(() => {
    if (!projectId || !filePath || !editorRef.current || !client) return;

    let mounted = true;
    setFailed(false);
    setLoading(true);

    async function loadFile() {
      try {
        const content = await client!.readFileContent(projectId!, filePath!);
        if (!mounted) return;

        const extension = filePath!.split('.').pop() || 'plain';
        const lang = langMap[extension] || [];

        const state = EditorState.create({
          doc: content.content,
          extensions: [
            lineNumbers(),
            highlightActiveLine(),
            highlightSpecialChars(),
            drawSelection(),
            dropCursor(),
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
            lang,
            search(),
            EditorView.editable.of(false)
          ],
        });

        if (viewRef.current) viewRef.current.destroy();

        viewRef.current = new EditorView({
          state,
          parent: editorRef.current!,
        });

        if (line) {
          const lineNumber = parseInt(line, 10);
          if (!isNaN(lineNumber)) {
            const lineObj = viewRef.current.state.doc.line(Math.min(lineNumber, viewRef.current.state.doc.lines));
            viewRef.current.dispatch({
              selection: { anchor: lineObj.from },
              scrollIntoView: true
            });
          }
        }
      } catch (err) {
        console.error('Failed to load file', err);
        if (mounted) setFailed(true);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadFile();

    return () => {
      mounted = false;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [projectId, filePath, line, client]);

  if (!filePath || !projectId) {
    return (
      <EmptyState
        data-testid="code-viewer-empty"
        icon={<IconCode />}
        title={t('code.empty_title')}
        description={t('code.empty_desc')}
      />
    );
  }
  if (!client) return <CodeSkeleton label={t('code.loading')} />;

  return (
    <div className="v3-code-viewer">
      <div className="v3-code-viewer-header">
        <bdi className="v3-code-viewer-path" dir="ltr">
          {filePath}
        </bdi>
        <span className="v3-code-viewer-badge">{t('code.readOnly')}</span>
      </div>
      {failed ? (
        <Banner variant="danger" data-testid="code-viewer-error">
          {t('code.error')}
        </Banner>
      ) : null}
      {loading && !failed ? <CodeSkeleton label={t('code.loading')} /> : null}
      <div ref={editorRef} className="v3-code-viewer-editor" data-testid="code-viewer-tab" />
    </div>
  );
};

export default CodeViewer;
