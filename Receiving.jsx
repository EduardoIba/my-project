import React, {useEffect, useRef, useState} from 'react';
import {Barcode, ChevronDown, CircleAlert, ClipboardCheck, Download, Plus, Upload} from 'lucide-react';
import {Catalog} from './ReceivingShared.jsx';
import ReceivingReports, {Badge, batchLabel, NoteTable, noteLabel, Stat} from './ReceivingReports.jsx';
import Sidebar from './Sidebar.jsx';
import {accessKey, checkedQuantity, number, previewDistribution, validAccessKey} from './receivingWorkflow.js';
import './receiving.css';

export {Occurrences} from './ReceivingShared.jsx';

const navigation = [['dashboard', 'Painel'], ['new', 'Nova conferência'], ['history', 'Histórico'], ['pending', 'Pendências'], ['reports', 'Relatórios']];
const xmlLimit = 10 * 1024 * 1024;
const fiscalNamespace = 'http://www.portalfiscal.inf.br/nfe';

function Header({title, description, children}) {
  return <header className="rx-header"><div><span className="rx-eyebrow">IMPORT LASER / CONFERÊNCIA</span>
    <h1>{title}</h1><p>{description}</p></div>{children}</header>;
}

function Identify({value, setValue, lookup, importXml, busy, missing, onHistory}) {
  const [showUpload, setShowUpload] = useState(false);
  const keyInput = useRef(null);
  const fileInput = useRef(null);
  useEffect(() => {
    if (!busy && !showUpload && !missing) keyInput.current?.focus();
  }, [busy]);
  useEffect(() => { if (missing) setShowUpload(true); }, [missing]);
  useEffect(() => { if (showUpload && !busy) fileInput.current?.focus(); }, [showUpload, busy]);

  return <>
    <Header title="Nova conferência" description="Leia a chave de acesso para iniciar o recebimento.">
      <button className="rx-primary" onClick={onHistory}>Histórico de notas</button>
    </Header>
    <section className="rx-card rx-identify">
      <h2>Identificação da NF-e</h2>
      <p>Leia o código de barras do DANFE com seu leitor ou digite a chave de 44 dígitos.</p>
      <form onSubmit={event => {event.preventDefault(); lookup();}}>
        <label htmlFor="rx-access-key">Chave de acesso</label>
        <div className="rx-input-icon rx-key-input"><Barcode size={18}/>
          <input id="rx-access-key" ref={keyInput} value={value} onChange={event => setValue(event.target.value)}
            inputMode="numeric" autoComplete="off" spellCheck={false} disabled={busy}
            placeholder="Escaneie a chave da nota fiscal (44 dígitos)"/>
        </div>
        <div className="rx-actions">
          <button className="rx-primary" disabled={busy}>{busy ? 'Aguarde…' : 'Consultar NF-e'}</button>
          <button type="button" className="rx-secondary" disabled={busy}
            aria-expanded={showUpload} onClick={() => setShowUpload(!showUpload)}>Importar XML</button>
        </div>
      </form>
      <div className="rx-notice" role="status">
        {missing ? 'Chave ainda não encontrada na base. Importe o XML correspondente para continuar.'
          : 'A consulta busca notas já cadastradas. Para uma nota nova, importe o XML da NF-e.'}
      </div>
      {showUpload && <form className="rx-upload" onSubmit={event => {
        event.preventDefault();
        importXml(new FormData(event.currentTarget).get('file'));
      }}><label>Arquivo XML<input ref={fileInput} type="file" name="file" accept=".xml,text/xml,application/xml" required disabled={busy}/></label>
        <button className="rx-primary" disabled={busy}><Upload size={15}/> Carregar XML</button>
      </form>}
    </section>
    <section className="rx-card rx-guide"><h2>Como funciona</h2><ol>
      <li><span>01</span><div><strong>Bipe a chave</strong><p>Localize a nota na base ou importe seu XML.</p></div></li>
      <li><span>02</span><div><strong>Confirme as quantidades</strong><p>Informe a quantidade física de cada produto recebido.</p></div></li>
      <li><span>03</span><div><strong>Veja os destinos</strong><p>A distribuição segue a prioridade das solicitações.</p></div></li>
    </ol></section>
  </>;
}

function Distribution({rows, completed}) {
  const [view, setView] = useState('product');
  const field = view === 'product' ? 'product_name' : 'customer_name';
  const other = view === 'product' ? 'customer_name' : 'product_name';
  const groups = new Map();
  for (const row of rows) {
    const name = row[field];
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  return <section className="rx-card rx-distribution">
    <h2>{completed ? 'Distribuição registrada' : 'Distribuição sugerida'}</h2>
    <div className="rx-segments" role="group" aria-label="Visualização da distribuição">
      <button type="button" aria-pressed={view === 'product'} onClick={() => setView('product')}>Por produto</button>
      <button type="button" aria-pressed={view === 'customer'} onClick={() => setView('customer')}>Por cliente</button>
    </div>
    {!groups.size && <p className="rx-empty">{completed ? 'Nenhuma alocação registrada.' : 'Informe as quantidades físicas para ver as alocações previstas.'}</p>}
    {[...groups].map(([name, group]) => <div className="rx-distribution-group" key={name}>
      <h3>{name}</h3>
      <ol>{group.map((row, index) => <li key={row.purchase_request_id + ':' + index}>
        <span>{index + 1}</span><span>{row.batch_sequence ? batchLabel(row.batch_sequence) + ' · ' : ''}{row[other]}</span>
        <strong>{number.format(row.allocated_quantity)}</strong>
      </li>)}</ol>
    </div>)}
    <p className="rx-caption">{completed ? 'Quantidades gravadas na finalização.' : 'Prévia por lote mais antigo e ordem original. Os saldos são recalculados ao finalizar.'}</p>
  </section>;
}

function Inspection({note, items, products, pending, rows, alerts, busy, change, save, download, fresh, userId}) {
  const completed = note.status === 'received' || note.inspection?.status === 'completed';
  const locked = !completed && note.inspection?.inspector_id && userId && note.inspection.inspector_id !== userId && !note.canOverride;
  const readOnly = completed || locked;
  const suggested = completed ? rows : previewDistribution(items, pending, products, note.supplier_id);
  const definitions = new Map(products.map(product => [product.id, product]));
  const mismatch = item => {
    const product = definitions.get(item.productId);
    return !item.productId || item.productId !== item.product_id ||
      (product && (Number(product.package_quantity ?? 1) !== 1 || product.unit.trim().toUpperCase() !== item.unit.trim().toUpperCase())) ||
      (checkedQuantity(item.received) && Number(item.received) !== Number(item.invoiced_quantity));
  };
  const issues = items.filter(mismatch);
  const invoiceAlerts = alerts.filter(row => row.invoice_id === note.id);
  const label = (item, prefix) => prefix + ' — ' + item.description;
  return <>
    <Header title="Conferência de NF-e" description="Conferência física, cruzamento com solicitações e distribuição por prioridade.">
      <button className="rx-primary" onClick={fresh} disabled={busy}><Plus size={16}/> Nova conferência</button>
    </Header>
    <section className="rx-card rx-note-summary">
      <div><span>Fornecedor</span><strong>{note.supplierName}</strong></div>
      <div><span>Nota fiscal</span><strong>{noteLabel(note)}</strong></div>
      <div><span>Chave de acesso</span><code>{note.access_key}</code></div>
      <div className="rx-summary-status"><Badge tone="success">{completed ? 'Finalizada' : 'XML carregado'}</Badge>
        <button className="rx-text-button" onClick={download} disabled={busy}><Download size={14}/> Baixar XML</button></div>
    </section>
    {locked && <div className="rx-notice">Esta conferência está atribuída a outro usuário. A visualização está disponível.</div>}
    <div className="rx-stats">
      <Stat label="Itens na NF-e" value={items.length}/>
      <Stat label="Unidades recebidas" value={number.format(items.reduce((total, item) => total + (Number(item.received) || 0), 0))}/>
      <Stat label="Divergências" value={completed ? invoiceAlerts.length : issues.length}/>
      <Stat label={completed ? 'Solicitações atendidas' : 'Pendências na prévia'} value={new Set(suggested.map(row => row.purchase_request_id)).size}/>
    </div>
    <form onSubmit={event => {event.preventDefault(); save(event.nativeEvent.submitter?.value === 'finalize');}} noValidate>
      <div className="rx-inspection-grid">
        <section className="rx-card rx-products"><h2>Produtos da NF-e</h2>
          <div className="rx-product-head"><span>Produto</span><span>NF-e</span><span>Conferido</span><span>Status</span></div>
          {items.map(item => {
            const known = checkedQuantity(item.received);
            const difference = known ? Math.round((Number(item.received) - Number(item.invoiced_quantity)) * 10000) / 10000 : 0;
            return <article className="rx-product-row" key={item.id}>
              <div className="rx-product-data">
                <div><strong>{item.description}</strong><small>Código fiscal: {item.supplier_product_code} · {item.unit}</small></div>
                <strong className="rx-invoiced">{number.format(item.invoiced_quantity)}</strong>
                <input aria-label={label(item, 'Quantidade conferida')} type="number" min="0" step="0.0001" inputMode="decimal"
                  value={item.received} placeholder="—" disabled={busy} readOnly={readOnly}
                  onChange={event => change(item.id, 'received', event.target.value)}/>
                <Badge tone={!known ? 'neutral' : difference ? 'danger' : mismatch(item) ? 'warning' : 'success'}>
                  {!known ? 'Pendente' : difference ? (difference > 0 ? '+' : '') + number.format(difference) : mismatch(item) ? 'Revisar' : 'OK'}
                </Badge>
              </div>
              <details><summary><ChevronDown size={13}/> Produto e observações</summary>
                <div className="rx-product-details">
                  <label>Produto vinculado<select value={item.productId} disabled={readOnly || busy} onChange={event => change(item.id, 'productId', event.target.value)}>
                    <option value="">Não identificado</option>
                    {item.productId && !definitions.has(item.productId) && <option value={item.productId}>Produto inativo</option>}
                    {products.map(product => <option key={product.id} value={product.id}>{product.name} · {product.unit}</option>)}
                  </select></label>
                  <label>{item.productId && item.productId !== item.product_id ? 'Justificativa da substituição' : 'Observações'}
                    <input value={item.notes} readOnly={readOnly} disabled={busy} onChange={event => change(item.id, 'notes', event.target.value)}/></label>
                </div>
              </details>
            </article>;
          })}
          {!items.length && <p className="rx-empty">Esta nota não contém itens para conferir.</p>}
        </section>
        <Distribution rows={suggested} completed={completed}/>
      </div>
      {(completed ? invoiceAlerts.length > 0 : issues.length > 0) && <section className="rx-card rx-inspection-alerts" aria-label="Divergências">
        {completed ? invoiceAlerts.map(row => <div key={row.id}><Badge tone={row.status === 'resolved' ? 'success' : 'danger'}>
          {row.status === 'resolved' ? 'Resolvida' : 'Divergência'}</Badge><span>{row.description}{row.resolution_notes && ' · ' + row.resolution_notes}</span></div>)
          : issues.map(item => <div key={item.id}><Badge tone="warning">Revisar item</Badge>
          <span>{item.description} · NF-e: {number.format(item.invoiced_quantity)}{checkedQuantity(item.received) ? ' · Conferido: ' + number.format(item.received) : ''}{!item.productId ? ' · Produto sem vínculo' : ''}</span></div>)}
      </section>}
      {!readOnly && <div className="rx-actions rx-inspection-actions">
        <button className="rx-secondary" value="draft" type="submit" disabled={busy}>Salvar rascunho</button>
        <button className="rx-primary" value="finalize" type="submit" disabled={busy || !items.length}>Finalizar conferência</button>
      </div>}
    </form>
  </>;
}

async function readPages(fetchPage) {
  const pageSize = 500;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage({limit: pageSize, offset});
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

const selectAll = (api, table, query) => readPages(page => api.select(table, {...query, ...page}));

export default function Receiving({api, role, userId, onBuyer, onSignOut, sessionError}) {
  const [screen, setScreen] = useState('new');
  const [data, setData] = useState({notes: [], products: [], suppliers: [], alerts: [], pending: []});
  const [key, setKey] = useState('');
  const [missing, setMissing] = useState(false);
  const [selected, setSelected] = useState(null);
  const [items, setItems] = useState([]);
  const [distribution, setDistribution] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [dirty, setDirty] = useState(false);
  const running = useRef(false);
  const apiRef = useRef(api);
  apiRef.current = api;

  async function loadLists() {
    const current = apiRef.current;
    const [notes, products, suppliers, alerts, inspections, pending] = await Promise.all([
      selectAll(current, 'invoices', {order: 'created_at.desc,id'}),
      selectAll(current, 'products', {select: 'id,internal_code,name,unit,package_quantity', is_active: 'eq.true', order: 'name,id'}),
      selectAll(current, 'suppliers', {select: 'id,legal_name,trade_name,cnpj,is_active', order: 'legal_name,id'}),
      selectAll(current, 'occurrences', {select: 'id,invoice_id,description,status,resolution_notes,created_at', order: 'created_at.desc,id'}),
      selectAll(current, 'receiving_inspections', {select: 'invoice_id,status,inspector_id,completed_at', order: 'invoice_id'}),
      readPages(page => current.rpc('receiving_pending_requests', {}, {...page, order: 'batch_sequence,customer_position,item_position'})),
    ]);
    const bySupplier = new Map(suppliers.map(row => [row.id, row.trade_name || row.legal_name]));
    const byInspection = new Map(inspections.map(row => [row.invoice_id, row]));
    const next = {products, suppliers, alerts, pending, notes: notes.map(note => ({...note,
      supplierName: bySupplier.get(note.supplier_id) || note.issuer_cnpj, inspection: byInspection.get(note.id),
    }))};
    setData(next);
    return next;
  }

  useEffect(() => {
    loadLists().catch(failure => setError(failure.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = event => {event.preventDefault(); event.returnValue = '';};
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function canLeave() {
    return !dirty || window.confirm('Há alterações sem salvar. Sair desta conferência?');
  }

  function navigate(next) {
    if (next === screen || !canLeave()) return;
    setDirty(false);
    setScreen(next);
    setError('');
    setFeedback('');
    if (next === 'new') {
      setSelected(null);
      setKey('');
      setMissing(false);
    }
  }

  async function open(note) {
    const current = apiRef.current;
    const filter = {invoice_id: 'eq.' + note.id};
    const [original, saved, allocations, inspections] = await Promise.all([
      selectAll(current, 'invoice_items', {...filter, order: 'item_number'}),
      selectAll(current, 'inspection_items', {...filter, order: 'id'}),
      selectAll(current, 'distribution_items', {...filter, order: 'purchase_request_id,product_id,customer_id'}),
      current.select('receiving_inspections', {...filter, select: 'status,inspector_id,completed_at'}),
    ]);
    const byItem = new Map(saved.map(row => [row.invoice_item_id, row]));
    setItems(original.map(item => {
      const previous = byItem.get(item.id);
      return {...item, productId: previous ? previous.product_id || '' : item.product_id || '',
        received: previous ? String(previous.received_quantity) : '', notes: previous?.notes || '', saved: Boolean(previous)};
    }));
    setDistribution(allocations);
    setDirty(false);
    setSelected({...note, inspection: inspections[0], canOverride: role === 'administrador'});
    setScreen('inspection');
  }

  async function run(action) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setFeedback('');
    try { await action(); }
    catch (failure) { setError(failure.message); }
    finally { running.current = false; setBusy(false); }
  }

  function lookup() {
    run(async () => {
      const value = accessKey(key);
      if (!validAccessKey(value)) throw new Error('Informe uma chave de acesso válida, com 44 dígitos e dígito verificador correto.');
      const [note] = await api.select('invoices', {access_key: 'eq.' + value, limit: 1});
      if (!note) {setMissing(true); return;}
      const supplier = data.suppliers.find(row => row.id === note.supplier_id);
      await open({...note, supplierName: supplier?.trade_name || supplier?.legal_name || note.issuer_cnpj});
    });
  }

  function importXml(file) {
    run(async () => {
      if (file.size > xmlLimit) throw new Error('O XML deve ter até 10 MiB.');
      const source = await file.text();
      if (missing) {
        const doc = new DOMParser().parseFromString(source, 'application/xml');
        const info = doc.getElementsByTagNameNS(fiscalNamespace, 'infNFe')[0];
        if (info?.getAttribute('Id') !== 'NFe' + accessKey(key)) throw new Error('O XML deve corresponder à chave consultada.');
      }
      const id = await api.rpc('import_invoice_xml', {source});
      const {notes} = await loadLists();
      const note = notes.find(row => row.id === id);
      if (!note) throw new Error('O XML foi gravado. Localize a nota pelo histórico.');
      await open(note);
      setFeedback('XML importado.');
    });
  }

  function save(complete) {
    run(async () => {
      const filled = items.filter(item => item.received !== '');
      if (complete && filled.length !== items.length) throw new Error('Informe a quantidade física de todos os itens, inclusive zero.');
      if (items.some(item => item.saved && item.received === '')) throw new Error('Informe a nova quantidade para o item já salvo, inclusive zero.');
      if (filled.some(item => !checkedQuantity(item.received))) throw new Error('Informe quantidades não negativas com até quatro casas decimais.');
      const substitute = filled.find(item => item.productId && item.productId !== item.product_id && !item.notes.trim());
      if (substitute) throw new Error('Justifique a substituição em “Produto e observações” para ' + substitute.description + '.');
      await api.rpc('save_inspection', {
        note_id: selected.id,
        items: filled.map(({id, received, productId, notes}) => ({id, received, productId, notes})),
        complete,
      });
      setDirty(false);
      const note = complete ? {...selected, status: 'received'} : selected;
      setSelected(note);
      setFeedback(complete ? 'Conferência finalizada e distribuição registrada.' : 'Rascunho salvo.');
      const {notes} = await loadLists();
      await open(notes.find(row => row.id === note.id) || note);
    });
  }

  function download() {
    run(async () => {
      const source = await api.rpc('get_invoice_xml', {note_id: selected.id});
      if (!source) throw new Error('XML indisponível.');
      const url = URL.createObjectURL(new Blob([source], {type: 'application/xml'}));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = selected.access_key + '.xml';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  const resolve = (target, justification) => run(async () => {
    await api.rpc('resolve_occurrence', {target, justification});
    await loadLists();
    setFeedback('Ocorrência resolvida.');
  });
  const openNote = note => run(() => open(note));
  const {notes, products, suppliers, alerts, pending} = data;
  return <div className="rx-app">
    <Sidebar items={[...navigation.map(([id, label]) => ({id, label})), ...(role === 'administrador' ? [{id: 'catalog', label: 'Cadastro fiscal'}] : [])]}
      active={screen === 'inspection' ? 'new' : screen} onNavigate={id => navigate(id)} moduleLabel="Módulo de conferência"
      roleLabel={role === 'administrador' ? 'Administrador' : 'Conferente'}
      accessLabel={role === 'administrador' ? 'Acesso Master' : 'Acesso operacional'}
      switchLabel={onBuyer ? 'Compras' : undefined} onSwitch={() => {if (canLeave()) onBuyer();}}
      onSignOut={() => {if (canLeave()) onSignOut();}} disabled={busy}/>
    <main className="rx-main" aria-busy={loading || busy}>
      {(error || sessionError) && <div className="rx-message rx-message-error" role="alert"><CircleAlert size={18}/>{error || sessionError}</div>}
      {feedback && <div className="rx-message rx-message-ok" role="status"><ClipboardCheck size={18}/>{feedback}</div>}
      {loading && <div className="rx-notice" role="status">Carregando dados de conferência…</div>}
      {screen === 'new' && <Identify value={key} setValue={value => {setKey(value); setMissing(false);}}
        lookup={lookup} importXml={importXml} busy={busy || loading} missing={missing} onHistory={() => navigate('history')}/>}
      {screen === 'inspection' && selected && <Inspection key={selected.id} note={selected} items={items} products={products} pending={pending}
        rows={distribution} alerts={alerts} busy={busy} userId={userId} fresh={() => navigate('new')} save={save} download={download}
        change={(id, field, value) => {
          setDirty(true);
          setItems(previous => previous.map(item => item.id === id ? {...item, [field]: value} : item));
        }}/>}
      {screen === 'dashboard' && <>
        <Header title="Painel de conferência" description="Acompanhe notas, recebimentos e pendências do módulo.">
          <button className="rx-primary" onClick={() => navigate('new')}><Plus size={16}/> Nova conferência</button>
        </Header>
        <div className="rx-stats rx-stats-three"><Stat label="Notas aguardando conferência" value={notes.filter(note => note.status !== 'received').length}/>
          <Stat label="Conferências concluídas" value={notes.filter(note => note.status === 'received').length}/>
          <Stat label="Divergências ativas" value={alerts.filter(row => row.status === 'open').length}/></div>
        <section className="rx-card"><h2>Notas recentes</h2><NoteTable notes={notes.slice(0, 10)} open={openNote} busy={busy}/></section>
      </>}
      {['history', 'pending', 'reports'].includes(screen) && <ReceivingReports key={screen} screen={screen}
        notes={notes} pending={pending} alerts={alerts} suppliers={suppliers} open={openNote} resolve={resolve} busy={busy}/>}
      {screen === 'catalog' && role === 'administrador' && <>
        <Header title="Cadastro fiscal" description="Vincule fornecedores, produtos e equivalências usados na conferência."/>
        <Catalog api={api} suppliers={suppliers.filter(row => row.is_active)} products={products}
          run={action => run(async () => {await action(); await loadLists(); setFeedback('Cadastro atualizado.');})} busy={busy}/>
      </>}
    </main>
  </div>;
}
