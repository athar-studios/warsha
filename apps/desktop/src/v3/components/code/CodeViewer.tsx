import React, { useEffect, useState, useRef } from 'react';
import { EditorView, lineNumbers, highlightActiveLine, highlightSpecialChars, drawSelection, dropCursor, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { rust } from '@codemirror/lang-rust';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { useSearchParams } from 'react-router-dom';
import { useT } from '@warsha/i18n/v3';
import { useClient } from '../../app/ClientContext';

const langMap: Record<string, any> = {
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

const CodeViewer: React.FC = () => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [searchParams] = useSearchParams();
  const t = useT();
  const client = useClient();

  const projectId = searchParams.get('projectId');
  const filePath = searchParams.get('file');
  const line = searchParams.get('line');

  useEffect(() => {
    if (!projectId || !filePath || !editorRef.current || !client) return;

    let mounted = true;

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
      }
    }

    loadFile();

    return () => {
      mounted = false;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [projectId, filePath, line, client]);

  if (!client) return <div>{t('code.loading')}</div>;

  return <div ref={editorRef} data-testid="code-viewer-tab" />;
};

export default CodeViewer;
