import React, { useState } from 'react';
import { Download, FileSpreadsheet, Search } from 'lucide-react';
import { exportCsv, number } from '../domain/receivingWorkflow.js';

const date = (value) => (value ? new Date(value).toLocaleDateString('pt-BR') : '—');
export const batchLabel = (value) => 'Lote ' + String(value).padStart(3, '0');
export const noteLabel = (note) => 'NF-e ' + note.invoice_number;
const statusOf = (note) =>
  note.status === 'received'
    ? ['Finalizada', 'success']
    : note.inspection?.status === 'in_progress'
      ? ['Em conferência', 'blue']
      : ['Aguardando', 'warning'];

export function Badge({ tone = 'blue', children }) {
  return <span className={'rx-badge rx-' + tone}>{children}</span>;
}

export function Stat({ label, value }) {
  return (
    <article className="rx-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

export function NoteTable({ notes, open, busy }) {
  return (
    <div className="rx-table-wrap">
      <table className="rx-table">
        <thead>
          <tr>
            <th>Nota fiscal</th>
            <th>Fornecedor</th>
            <th>Emissão</th>
            <th>Chave de acesso</th>
            <th>Status</th>
            <th aria-label="Ações" />
          </tr>
        </thead>
        <tbody>
          {notes.map((note) => {
            const [status, tone] = statusOf(note);
            return (
              <tr key={note.id}>
                <td>
                  <strong>{noteLabel(note)}</strong>
                  <small>Série {note.series}</small>
                </td>
                <td>{note.supplierName}</td>
                <td>{date(note.issued_at)}</td>
                <td className="rx-key-cell" title={note.access_key}>
                  {note.access_key}
                </td>
                <td>
                  <Badge tone={tone}>{status}</Badge>
                </td>
                <td>
                  <button className="rx-text-button" disabled={busy} onClick={() => open(note)}>
                    {note.status === 'received' ? 'Ver conferência' : 'Abrir'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!notes.length && <p className="rx-empty">Nenhuma nota fiscal encontrada.</p>}
    </div>
  );
}

const tabs = [
  ['completed', 'Concluídas'],
  ['issues', 'Divergências'],
  ['pending', 'Pendências'],
  ['all', 'Histórico geral'],
];

export default function ReceivingReports({
  screen,
  notes,
  pending,
  alerts,
  suppliers,
  open,
  resolve,
  busy,
}) {
  const [tab, setTab] = useState(
    screen === 'pending' ? 'pending' : screen === 'history' ? 'all' : 'completed',
  );
  const [period, setPeriod] = useState('');
  const [supplier, setSupplier] = useState('');
  const [term, setTerm] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const notesById = new Map(notes.map((note) => [note.id, note]));
  const query = term.trim().toLocaleLowerCase('pt-BR');
  const matches = (...fields) => fields.join(' ').toLocaleLowerCase('pt-BR').includes(query);
  const after = period ? Date.now() - Number(period) * 86400000 : 0;
  const dateMatches = (value) => !after || (value && new Date(value).getTime() >= after);
  const vendorMatches = (id) => !supplier || id === supplier;
  const filteredNotes = notes.filter(
    (note) =>
      vendorMatches(note.supplier_id) &&
      dateMatches(tab === 'completed' ? note.inspection?.completed_at : note.issued_at) &&
      matches(note.invoice_number, note.access_key, note.supplierName) &&
      (tab !== 'completed' || note.status === 'received'),
  );
  const filteredPending = pending.filter(
    (row) =>
      vendorMatches(row.supplier_id) &&
      dateMatches(row.confirmed_at) &&
      matches(
        row.customer_name,
        row.product_name,
        row.supplier_name,
        batchLabel(row.batch_sequence),
      ),
  );
  const filteredAlerts = alerts.filter((row) => {
    const note = notesById.get(row.invoice_id);
    return (
      vendorMatches(note?.supplier_id) &&
      dateMatches(row.created_at) &&
      matches(row.description, row.resolution_notes, note?.invoice_number, note?.supplierName)
    );
  });

  function download() {
    const [headers, rows] =
      tab === 'pending'
        ? [
            ['Prioridade', 'Fornecedor', 'Cliente', 'Produto', 'Saldo', 'Status'],
            filteredPending.map((row) => [
              batchLabel(row.batch_sequence),
              row.supplier_name,
              row.customer_name,
              row.product_name,
              number.format(row.pending_quantity),
              'Pendente',
            ]),
          ]
        : tab === 'issues'
          ? [
              ['Nota fiscal', 'Ocorrência', 'Data', 'Status', 'Resolução'],
              filteredAlerts.map((row) => [
                notesById.get(row.invoice_id)?.invoice_number,
                row.description,
                date(row.created_at),
                row.status === 'resolved' ? 'Resolvida' : 'Em aberto',
                row.resolution_notes,
              ]),
            ]
          : [
              ['Nota fiscal', 'Fornecedor', 'Emissão', 'Chave de acesso', 'Status'],
              filteredNotes.map((note) => [
                noteLabel(note),
                note.supplierName,
                date(note.issued_at),
                note.access_key,
                statusOf(note)[0],
              ]),
            ];
    const url = URL.createObjectURL(
      new Blob([exportCsv(headers, rows)], { type: 'text/csv;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'import-laser-conferencia-' + tab + '.csv';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportOpen(false);
  }

  const heading = {
    reports: 'Relatórios de conferência',
    history: 'Histórico de notas',
    pending: 'Pendências',
  }[screen];
  return (
    <>
      <header className="rx-header">
        <div>
          <span className="rx-eyebrow">IMPORT LASER / CONFERÊNCIA</span>
          <h1>{heading}</h1>
          <p>Consulte conferências, divergências e solicitações por prioridade.</p>
        </div>
        <div className="rx-export">
          <button
            className="rx-primary"
            aria-expanded={exportOpen}
            onClick={() => setExportOpen(!exportOpen)}
          >
            <Download size={15} /> Exportar PDF / CSV
          </button>
          {exportOpen && (
            <div className="rx-export-options">
              <button onClick={download}>
                <FileSpreadsheet size={15} /> Baixar CSV
              </button>
              <button
                onClick={() => {
                  setExportOpen(false);
                  window.print();
                }}
              >
                Imprimir / salvar PDF
              </button>
            </div>
          )}
        </div>
      </header>
      {screen !== 'history' && (
        <nav className="rx-tabs" aria-label="Tipos de relatório">
          {(screen === 'pending'
            ? tabs.filter(([key]) => key === 'pending' || key === 'issues')
            : tabs
          ).map(([key, label]) => (
            <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>
      )}
      <section className="rx-card rx-filter-card">
        <h2>Filtros</h2>
        <div className="rx-filters">
          <label>
            Período
            <select value={period} onChange={(event) => setPeriod(event.target.value)}>
              <option value="">Todo o histórico</option>
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
            </select>
          </label>
          <label>
            Fornecedor
            <select value={supplier} onChange={(event) => setSupplier(event.target.value)}>
              <option value="">Todos</option>
              {suppliers.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.trade_name || row.legal_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Buscar
            <span className="rx-input-icon">
              <Search size={15} />
              <input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder={
                  tab === 'pending' ? 'Produto, cliente ou fornecedor' : 'NF-e, chave ou fornecedor'
                }
              />
            </span>
          </label>
        </div>
      </section>
      <div className="rx-stats rx-stats-three">
        <Stat label="Pendências em aberto" value={filteredPending.length} />
        <Stat
          label="Divergências ativas"
          value={filteredAlerts.filter((row) => row.status === 'open').length}
        />
        <Stat
          label="Conferências concluídas"
          value={filteredNotes.filter((note) => note.status === 'received').length}
        />
      </div>
      <section className="rx-card">
        <h2>
          {
            {
              pending: 'Solicitações pendentes por prioridade',
              issues: 'Divergências de conferência',
              completed: 'Conferências concluídas',
              all: 'Notas fiscais',
            }[tab]
          }
        </h2>
        {tab === 'pending' ? (
          <div className="rx-table-wrap">
            <table className="rx-table">
              <thead>
                <tr>
                  <th>Prioridade</th>
                  <th>Fornecedor</th>
                  <th>Cliente</th>
                  <th>Produto</th>
                  <th>Saldo</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredPending.map((row) => (
                  <tr key={row.request_id}>
                    <td className="rx-priority">{batchLabel(row.batch_sequence)}</td>
                    <td>{row.supplier_name || '—'}</td>
                    <td>{row.customer_name}</td>
                    <td>{row.product_name}</td>
                    <td>
                      <strong>{number.format(row.pending_quantity)}</strong>
                    </td>
                    <td>
                      <Badge tone="warning">Pendente</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredPending.length && (
              <p className="rx-empty">Nenhuma solicitação pendente encontrada.</p>
            )}
          </div>
        ) : tab === 'issues' ? (
          <div className="rx-issues">
            {filteredAlerts.map((row) => (
              <article key={row.id}>
                <div>
                  <Badge tone={row.status === 'resolved' ? 'success' : 'danger'}>
                    {row.status === 'resolved' ? 'Resolvida' : 'Em aberto'}
                  </Badge>
                  <strong>{row.description}</strong>
                  <small>
                    {notesById.has(row.invoice_id)
                      ? noteLabel(notesById.get(row.invoice_id)) + ' · '
                      : ''}
                    {date(row.created_at)}
                  </small>
                  {row.resolution_notes && <p>{row.resolution_notes}</p>}
                </div>
                {row.status === 'open' && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      resolve(row.id, new FormData(event.currentTarget).get('justification'));
                    }}
                  >
                    <label>
                      Resolução
                      <input name="justification" required />
                    </label>
                    <button className="rx-secondary" disabled={busy}>
                      Resolver
                    </button>
                  </form>
                )}
              </article>
            ))}
            {!filteredAlerts.length && <p className="rx-empty">Nenhuma divergência encontrada.</p>}
          </div>
        ) : (
          <NoteTable notes={filteredNotes} open={open} busy={busy} />
        )}
      </section>
    </>
  );
}
