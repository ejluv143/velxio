/**
 * LabLoaderPage — route `/lab`.
 *
 * Opens the editor with a project named by the link (see utils/labLink.ts):
 * `/lab#project=<base64url .vlx>` or `/lab?src=<https url of a .vlx>`.
 * Used by classroom sites to open an assignment's board, code and circuit.
 */

import { useEffect, useRef, useState } from 'react';
import { EditorPage } from './EditorPage';
import { AppHeader } from '../components/layout/AppHeader';
import { loadLabFromLocation } from '../utils/labLink';

type State = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string };

export const LabLoaderPage: React.FC = () => {
  const [state, setState] = useState<State>({ status: 'loading' });
  // React strict mode runs effects twice in dev; load once per address.
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const key = window.location.search + window.location.hash;
      if (loadedFor.current === key) return;
      loadedFor.current = key;
      setState({ status: 'loading' });
      try {
        const loaded = await loadLabFromLocation({
          search: window.location.search,
          hash: window.location.hash,
        });
        if (cancelled) return;
        setState(
          loaded
            ? { status: 'ready' }
            : {
                status: 'error',
                message: 'This link has no project. Open the lab from your class page again.',
              },
        );
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: (err as Error).message });
      }
    };

    void load();
    // Changing only the #project=… part of the address (a new lab link opened in
    // the same tab) does not reload a single-page app: load the new project.
    window.addEventListener('hashchange', load);
    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', load);
    };
  }, []);

  if (state.status === 'ready') return <EditorPage />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--wb-2)' }}>
      <AppHeader />
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          color: 'var(--wb-12)',
        }}
      >
        {state.status === 'loading' ? (
          <div style={{ fontSize: 15 }}>Loading lab…</div>
        ) : (
          <>
            <div style={{ fontSize: 16, color: 'var(--wb-11)', maxWidth: 480, textAlign: 'center' }} role="alert">
              {state.message}
            </div>
            <a
              href="/editor"
              style={{
                color: '#4fc3f7',
                textDecoration: 'none',
                border: '1px solid #4fc3f7',
                borderRadius: 4,
                padding: '8px 20px',
                fontSize: 14,
              }}
            >
              Open an empty editor
            </a>
          </>
        )}
      </div>
    </div>
  );
};
