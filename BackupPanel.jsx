import React, { useState } from 'react';
import { BACKUP_KEY, RESET_BACKUP_KEY, downloadJson } from './src/shared/data/storage.js';

export default function BackupPanel({ db, cloud = false }) {
  const [feedback, setFeedback] = useState('');
  function previousBackup() {
    try {
      const raw =
        localStorage.getItem(db.resetBackupKey || RESET_BACKUP_KEY) ||
        localStorage.getItem(BACKUP_KEY);
      if (!raw) {
        setFeedback(
          'Não há backup da limpeza anterior neste navegador. Você pode baixar o backup atual.',
        );
        return;
      }
      downloadJson('import-laser-backup-antes-da-limpeza.json', JSON.parse(raw));
      setFeedback('Backup anterior preparado para download.');
    } catch {
      setFeedback('Não foi possível acessar o backup neste navegador.');
    }
  }
  return (
    <details className="backupPanel">
      <summary>Backup de segurança</summary>
      <p className="muted">
        {cloud
          ? 'Baixe uma cópia dos dados de Compras disponíveis nesta sessão.'
          : 'A limpeza solicitada preserva uma cópia anterior neste navegador. Baixe o backup para guardá-lo também em arquivo. Os cadastros e as configurações continuam na base atual.'}
      </p>
      <div className="requestActions">
        {!cloud && (
          <button className="secondary" onClick={previousBackup}>
            Baixar backup anterior à limpeza
          </button>
        )}
        <button
          className="secondary"
          onClick={() => downloadJson('import-laser-backup-atual.json', db)}
        >
          Baixar backup atual
        </button>
      </div>
      {feedback && (
        <p role="status" className="muted">
          {feedback}
        </p>
      )}
    </details>
  );
}
