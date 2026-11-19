import React, {useEffect, useState} from 'react';
import {ArrowRight, CircleAlert, Eye, EyeOff, LoaderCircle, LockKeyhole, UserRound} from 'lucide-react';
import './auth.css';

export default function LoginScreen({onSubmit, busy, retryAt, error, checkingProfile, onSignOut}) {
  const [visible, setVisible] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!retryAt) {
      setSeconds(0);
      return;
    }
    const update = () => setSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [retryAt]);

  const locked = Boolean(retryAt);
  const submitText = busy ? 'Entrando…' : locked ? 'Aguarde para tentar novamente' : 'Entrar';

  return <main className="auth-page">
    <div className="auth-frame">
      <div className="auth-brand">
        <div className="auth-wordmark"><span className="auth-monogram" aria-hidden="true">IL</span><span>IMPORT LASER</span></div>
        <div className="auth-brand-copy"><p>Compras e<br className="auth-break"/> Conferência de <span>NF-e</span></p></div>
        <div className="auth-pattern" aria-hidden="true"/>
      </div>
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-card-content">
          <h1 id="auth-title">{checkingProfile ? 'Acesso ao sistema' : 'Entrar na sua conta'}</h1>
          {!checkingProfile && <p className="auth-intro">Informe seu usuário e sua senha para acessar o sistema.</p>}
          {error && <div className="auth-feedback" role="alert">
            <CircleAlert size={18} aria-hidden="true"/>
            <div>{error}{locked && seconds > 0 && <span className="auth-countdown" aria-hidden="true">Tente novamente em {seconds} s.</span>}</div>
          </div>}
          {checkingProfile ? <>
            {!error && <p className="auth-progress" role="status"><LoaderCircle size={18} aria-hidden="true"/> Carregando perfil…</p>}
            <button className="auth-cancel" type="button" onClick={onSignOut}>Sair</button>
          </> : <form className="auth-form" onSubmit={onSubmit} aria-busy={busy}>
            <div className="auth-field">
              <label htmlFor="auth-username">Usuário</label>
              <div className="auth-input">
                <UserRound size={18} aria-hidden="true"/>
                <input id="auth-username" name="username" placeholder="Seu nome de usuário" required maxLength={64}
                  autoComplete="username" autoCapitalize="none" spellCheck={false} readOnly={busy}/>
              </div>
            </div>
            <div className="auth-field">
              <label htmlFor="auth-password">Senha</label>
              <div className="auth-input">
                <LockKeyhole size={18} aria-hidden="true"/>
                <input id="auth-password" name="password" type={visible ? 'text' : 'password'} placeholder="Sua senha"
                  required autoComplete="current-password" readOnly={busy}/>
                <button className="auth-toggle" type="button" aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
                  aria-controls="auth-password" onClick={() => setVisible(!visible)}>
                  {visible ? <EyeOff size={18} aria-hidden="true"/> : <Eye size={18} aria-hidden="true"/>}
                </button>
              </div>
            </div>
            <button className="auth-submit" type="submit" disabled={busy || locked}>
              {busy && <LoaderCircle size={18} aria-hidden="true"/>}
              {submitText}
              {!busy && !locked && <ArrowRight size={18} aria-hidden="true"/>}
            </button>
          </form>}
          {busy && <span className="auth-sr-only" role="status">Verificando credenciais.</span>}
        </div>
      </section>
    </div>
  </main>;
}
