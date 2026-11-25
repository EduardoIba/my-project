import React, { useEffect, useRef, useState } from 'react';
import { createSupabaseApi } from './src/shared/api/supabaseApi.js';
import Receiving, { Occurrences } from './Receiving.jsx';
import LoginScreen from './LoginScreen.jsx';

const sessionKey = 'importlaser-supabase-session';

export default function CloudApp({ Buyer, url, publishableKey }) {
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(sessionKey));
    } catch {
      return null;
    }
  });
  const token = useRef(session?.access_token);
  const [workspace, setWorkspace] = useState(null);
  const [role, setRole] = useState(null);
  const [section, setSection] = useState('buyer');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const api = createSupabaseApi(url, publishableKey, session?.access_token);
  const revision = useRef(null);
  const saving = useRef(false);
  const signingIn = useRef(false);

  useEffect(() => {
    if (!retryAt) return;
    const timeout = setTimeout(
      () => {
        setRetryAt(0);
        setError('');
      },
      Math.max(0, retryAt - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [retryAt]);

  function saveSession(next) {
    token.current = next?.access_token;
    if (next) sessionStorage.setItem(sessionKey, JSON.stringify(next));
    else sessionStorage.removeItem(sessionKey);
    setSession(next);
  }

  useEffect(() => {
    if (!session) return;
    const timeout = setTimeout(
      async () => {
        try {
          const next = await api.refresh(session.refresh_token);
          if (token.current === session.access_token) saveSession(next);
        } catch (failure) {
          if (token.current === session.access_token) {
            saveSession(null);
            setRole(null);
            setWorkspace(null);
            setError(failure.message);
          }
        }
      },
      Math.max(0, (session.expires_at * 1000 || Date.now() + 3600000) - Date.now() - 60000),
    );
    return () => clearTimeout(timeout);
  }, [session]);

  useEffect(() => {
    if (!session || role) return;
    let active = true;
    async function load() {
      try {
        const profile = await api.rpc('current_profile_role');
        if (!profile) throw new Error('Seu usuário precisa de um perfil ativo da Import Laser.');
        const result = profile === 'conferente' ? null : await api.rpc('load_buyer_workspace');
        const alerts = result
          ? await api.select('occurrences', {
              select: 'id,description,status,resolution_notes',
              order: 'created_at.desc',
            })
          : [];
        if (!active) return;
        revision.current = result?.revision;
        setWorkspace(result ? { ...result.data, alerts } : null);
        setSection(profile === 'conferente' ? 'receiving' : 'buyer');
        setRole(profile);
      } catch (failure) {
        if (active) setError(failure.message);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [session, role]);

  useEffect(() => {
    if (!session || !workspace || section !== 'buyer') return;
    let active = true;
    async function refreshAlerts() {
      try {
        const alerts = await api.select('occurrences', {
          select: 'id,description,status,resolution_notes',
          order: 'created_at.desc',
        });
        if (active) setWorkspace((previous) => previous && { ...previous, alerts });
      } catch (failure) {
        if (active) setError(failure.message);
      }
    }
    window.addEventListener('focus', refreshAlerts);
    refreshAlerts();
    return () => {
      active = false;
      window.removeEventListener('focus', refreshAlerts);
    };
  }, [session, section, Boolean(workspace)]);

  async function signIn(event) {
    event.preventDefault();
    if (signingIn.current || retryAt > Date.now()) return;
    signingIn.current = true;
    const input = new FormData(event.currentTarget);
    setError('');
    setBusy(true);
    try {
      saveSession(await api.signIn(input.get('username'), input.get('password')));
    } catch (failure) {
      if (failure.waitSeconds) setRetryAt(Date.now() + failure.waitSeconds * 1000);
      setError(failure.message);
    } finally {
      signingIn.current = false;
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      await api.signOut();
    } catch (failure) {
      setError(failure.message);
    } finally {
      saveSession(null);
      setRole(null);
      setWorkspace(null);
    }
  }

  async function saveBuyer(data, previous) {
    if (saving.current) throw new Error('Aguarde a gravação em andamento.');
    saving.current = true;
    try {
      const { activeBatchId, alerts, ...shared } = data;
      const requestIds = new Set(data.requests.map((row) => row.id));
      const batchIds = new Set((data.imports || []).map((batch) => batch.id));
      const result = await api.rpc('save_buyer_workspace', {
        expected_revision: revision.current,
        payload: { ...shared, imports: data.imports || [] },
        archive_requests: previous.requests
          .filter((row) => !requestIds.has(row.id))
          .map((row) => row.id),
        archive_batches: (previous.imports || [])
          .filter((batch) => !batchIds.has(batch.id))
          .map((batch) => batch.id),
        deactivate_sellers: previous.sellers.filter((name) => !data.sellers.includes(name)),
      });
      revision.current = result.revision;
      const next = { ...result.data, activeBatchId, alerts };
      setWorkspace((current) => ({ ...next, alerts: current?.alerts || alerts }));
      return next;
    } finally {
      saving.current = false;
    }
  }

  async function resolve(target, justification) {
    setError('');
    try {
      await api.rpc('resolve_occurrence', { target, justification });
      const alerts = await api.select('occurrences', {
        select: 'id,description,status,resolution_notes',
        order: 'created_at.desc',
      });
      setWorkspace((previous) => ({ ...previous, alerts }));
    } catch (failure) {
      setError(failure.message);
    }
  }

  if (!session)
    return (
      <LoginScreen key="login" onSubmit={signIn} busy={busy} retryAt={retryAt} error={error} />
    );
  if (!role) return <LoginScreen key="profile" checkingProfile onSignOut={signOut} error={error} />;
  if (section === 'receiving')
    return (
      <Receiving
        api={api}
        role={role}
        userId={session.user?.id}
        onBuyer={role === 'administrador' ? () => setSection('buyer') : undefined}
        onSignOut={signOut}
        sessionError={error}
      />
    );

  return (
    <Buyer
      cloudData={workspace}
      saveCloud={saveBuyer}
      role={role}
      onModuleSwitch={role === 'administrador' ? () => setSection('receiving') : undefined}
      onSignOut={signOut}
      sessionError={error}
      occurrences={<Occurrences alerts={workspace.alerts || []} onResolve={resolve} />}
    />
  );
}
