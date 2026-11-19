import React, {useRef, useState} from 'react';
import {printDispatch} from './dispatchPrint.js';
import {DEFAULT_RULES, REVIEW_ACTIONS, applyReviewAction, applyBulkItems, blankItem, importIssues, itemErrors, localDate, makeId, parseMessage, previewTotal, supplierAliases} from './whatsapp.js';

const money = n => Number(n || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});

export default function WhatsAppImport({sellers, suppliers, savedRules, onRulesChange, onSave}) {
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(null);
  const [mode, setMode] = useState('request');
  const [purchaseDate, setPurchaseDate] = useState(localDate());
  const [confirmed, setConfirmed] = useState(false);
  const [bulk, setBulk] = useState({supplier: '', seller: '', client: ''});
  const [selected, setSelected] = useState([]);
  const [rules, setRules] = useState({aliases: savedRules?.aliases ?? DEFAULT_RULES.aliases});
  const [feedback, setFeedback] = useState('');
  const saving = useRef(false);

  function interpret() {
    try {
      const result = parseMessage(message, {sellers, suppliers, rules});
      setPreview({...result, id: makeId(), originalMessage: message, rules: {...rules},
        originalItemLines: result.items.map(item => ({line: item.sourceLine, text: item.originalLine}))});
      setSelected(result.items.map(item => item.id));
      setConfirmed(false); setFeedback('Prévia gerada. Confira os campos antes de salvar.');
      saving.current = false;
    } catch (error) { setFeedback(error.message); }
  }
  function update(id, field, value) {
    setPreview(p => ({...p, items: p.items.map(item => item.id === id ? {...item, [field]: value} : item)}));
  }
  async function printForDispatch() {
    try {
      if (preview && message !== preview.originalMessage) {
        setFeedback('A mensagem foi alterada. Clique em Interpretar novamente e confira a prévia antes de imprimir.');
        return;
      }
      const source = preview || parseMessage(message, {sellers, suppliers, rules});
      await printDispatch(source.items, {unparsedCount: source.review.filter(line => !line.resolution).length});
      setFeedback('Impressão preparada por fornecedor, com vendedores em ordem, clientes, quantidades e itens, sem preços.');
    } catch (error) {setFeedback(error.message);}
  }
  function applyBulk() {
    setPreview(p => ({...p, items: applyBulkItems(p.items, bulk, selected)}));
    setFeedback(selected.length ? `Campos aplicados aos ${selected.length} produtos selecionados.` : 'Campos aplicados a todos os produtos.');
  }
  function resolve(line, action) {
    if(!action)return;
    try {
      const next=applyReviewAction(preview,line.id,action,selected);
      setPreview(next);
      if(action==='product')setSelected(previous=>[...previous,next.items.at(-1).id]);
      setFeedback(REVIEW_ACTIONS.find(option=>option.value===action).description);
    }catch(error){setFeedback(error.message);}
  }
  const issues = preview ? importIssues({...preview, mode, purchaseDate, purchaseConfirmed: confirmed}, {sellers, suppliers}) : [];
  if (preview && message !== preview.originalMessage) issues.push('A mensagem foi alterada: clique em Interpretar novamente para atualizar a prévia.');
  const invalid = !preview || issues.length > 0;
  async function save() {
    if (invalid || saving.current) return;
    saving.current = true;
    try {
      await onSave({...preview, mode, purchaseDate, purchaseConfirmed: confirmed});
      setPreview(null); setMessage(''); setSelected([]); setConfirmed(false);
      setFeedback('Importação salva. Consulte os itens e a mensagem original em Solicitações.');
    } catch (error) { setFeedback(error.name === 'QuotaExceededError' ? 'O armazenamento do navegador está cheio. Libere espaço e tente salvar novamente; a prévia foi mantida.' : error.message); }
    finally { saving.current = false; }
  }
  return <section className="panel whatsappImport" aria-labelledby="import-title">
    <h2 id="import-title">Importar mensagem do WhatsApp</h2>
    <p className="muted">Cole a lista, confira a prévia e salve todos os produtos de uma vez.</p>
    <label>Mensagem original<textarea rows="7" value={message} onChange={e => setMessage(e.target.value)}
      placeholder={'MASTER BR\nADRIANA\nST SUPRIMENTOS\n01 - CARTUCHO 122 BK R$ 51,80\n01 - CARTUCHO 122 CL R$ 57,00\nJOÃO\nOUTRO CLIENTE\n02 - TONER TN750 R$ 33,40'} /></label>
    <div className="importToolbar">
      <button type="button" className="primary" disabled={!message.trim()} onClick={interpret}>{preview ? 'Interpretar novamente' : 'Interpretar mensagem'}</button>
      <button type="button" className="secondary" disabled={!message.trim() && !preview?.items.length} onClick={printForDispatch}>Imprimir</button>
      <button type="button" className="secondary" onClick={() => {setMessage(''); setPreview(null); setSelected([]); setFeedback(''); setConfirmed(false);}}>Limpar</button>
    </div>
    {preview && message !== preview.originalMessage && <p className="importWarning">O texto foi alterado. Interprete novamente para atualizar a prévia; as correções anteriores serão substituídas.</p>}
    <details className="importRules"><summary>Regras de interpretação</summary>
      <label>Variações de fornecedor (uma por linha: ALTERNATIVA=Fornecedor)<textarea rows="4" value={rules.aliases} onChange={e => setRules(p => ({...p, aliases: e.target.value}))}/></label>
      <p className="muted">Formato da lista: fornecedor, vendedor, cliente e produtos (quantidade - descrição e valor opcional). Para outro vendedor, informe o nome dele, o cliente e seus produtos. O fornecedor continua o mesmo até aparecer outro fornecedor. O cliente é texto livre. Também é aceito começar pelo vendedor e selecionar o fornecedor na prévia.</p>
      <p className="muted">Cabeçalhos aceitos: Fornecedor:, Vendedor:, Cliente:, Data: e Observações:. Os cabeçalhos valem para os produtos seguintes. Data ausente usa hoje. Regras novas valem ao interpretar novamente.</p>
      <button type="button" className="secondary" onClick={async () => {try {supplierAliases(rules, suppliers); await onRulesChange(rules); setFeedback('Regras salvas.');} catch (error) {setFeedback(error.message);}}}>Salvar regras</button>
    </details>
    {feedback && <p role="status" className="importFeedback">{feedback}</p>}
    {preview && <>
      <div className="importMode"><label>Como registrar<select value={mode} onChange={e => {setMode(e.target.value); setConfirmed(false);}}>
        <option value="request">Registrar solicitação — pendente</option><option value="purchase">Registrar compra realizada</option>
      </select></label>
      {mode === 'purchase' ? <><label>Data da compra<input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)}/></label>
        <label className="checkLabel"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>Confirmo que todos os itens desta prévia já foram comprados nas quantidades informadas.</label></>
        : <p className="muted">Os preços serão cotações de referência. A quantidade comprada será zero e os indicadores de compras não serão alterados.</p>}
      </div>
      <h3>Prévia editável</h3>
      <div className="importBulk">
        <label>Fornecedor em lote<select value={bulk.supplier} onChange={e => setBulk(p => ({...p, supplier: e.target.value}))}><option value="">Manter atual</option>{suppliers.map(name => <option key={name}>{name}</option>)}</select></label>
        <label>Vendedor em lote<select value={bulk.seller} onChange={e => setBulk(p => ({...p, seller: e.target.value}))}><option value="">Manter atual</option>{sellers.map(name => <option key={name}>{name}</option>)}</select></label>
        <label>Cliente em lote<input value={bulk.client} onChange={e => setBulk(p => ({...p, client: e.target.value}))} placeholder="Manter atual"/></label>
        <button type="button" className="secondary" onClick={applyBulk}>{selected.length ? `Aplicar aos selecionados (${selected.length})` : 'Aplicar a todos'}</button>
      </div>
      <p className="muted">{selected.length ? 'Use as caixas à esquerda para escolher os produtos. Campos em lote vazios mantêm o valor atual.' : 'Nenhum produto selecionado. Clique em Aplicar a todos para preencher todas as linhas.'}</p>
      <div className="tableWrap"><table className="importTable"><thead><tr>
        <th><input type="checkbox" aria-label="Selecionar todos os itens" checked={!!preview.items.length && selected.length === preview.items.length}
          onChange={e => setSelected(e.target.checked ? preview.items.map(item => item.id) : [])}/></th>
        {['Fornecedor', 'Vendedor', 'Cliente', 'Quantidade', 'Produto / SKU', 'Valor unitário (R$)', 'Subtotal', 'Data da solicitação', 'Observações', 'Conferência', 'Ações'].map(title => <th key={title}>{title}</th>)}
      </tr></thead><tbody>{preview.items.map((item, index) => {
        const errors = itemErrors(item, {mode, sellers, suppliers});
        const label = field => `${field} do item ${index + 1}`;
        return <tr key={item.id}>
          <td><input type="checkbox" aria-label={`Selecionar item ${index + 1}`} checked={selected.includes(item.id)} onChange={e => setSelected(p => e.target.checked ? [...p, item.id] : p.filter(id => id !== item.id))}/></td>
          <td><select aria-label={label('Fornecedor')} value={item.supplier} onChange={e => update(item.id, 'supplier', e.target.value)}><option value="">Selecione</option>{suppliers.map(name => <option key={name}>{name}</option>)}</select></td>
          <td><select aria-label={label('Vendedor')} value={item.seller} onChange={e => update(item.id, 'seller', e.target.value)}><option value="">Selecione</option>{sellers.map(name => <option key={name}>{name}</option>)}</select></td>
          <td><input aria-label={label('Cliente')} value={item.client} onChange={e => update(item.id, 'client', e.target.value)}/></td>
          <td><input aria-label={label('Quantidade')} type="number" min="1" step="1" value={item.quantity} onChange={e => update(item.id, 'quantity', e.target.value)}/></td>
          <td><textarea aria-label={label('Produto')} rows="3" value={item.sku} onChange={e => update(item.id, 'sku', e.target.value)}/></td>
          <td><input aria-label={label('Valor unitário')} type="number" min={mode === 'purchase' ? '0.01' : '0'} step="0.01" value={item.price} onChange={e => update(item.id, 'price', e.target.value)}/></td>
          <td>{money(previewTotal([item]))}</td>
          <td><input aria-label={label('Data')} type="date" value={item.date} onChange={e => update(item.id, 'date', e.target.value)}/></td>
          <td><textarea aria-label={label('Observações')} rows="2" value={item.notes} onChange={e => update(item.id, 'notes', e.target.value)}/></td>
          <td className="reviewStatus">{errors.length ? <span className="danger">Pendente: {errors.join(', ')}</span> : <span>Pronto para salvar</span>}{item.price === '' && mode === 'request' && <small>Sem cotação</small>}</td>
          <td><button type="button" className="link danger" onClick={() => {setPreview(p => ({...p, items: p.items.filter(row => row.id !== item.id)})); setSelected(p => p.filter(id => id !== item.id));}}>Excluir linha</button>
            {item.originalLine && <details><summary>Original</summary><p className="sourceText">{item.originalLine}</p></details>}</td>
        </tr>;
      })}</tbody></table></div>
      <button type="button" className="secondary" onClick={() => {const item = blankItem(); setPreview(p => ({...p, items: [...p.items, item]})); setSelected(p => [...p, item.id]);}}>+ Adicionar produto</button>
      {preview.review.length > 0 && <div className="manualReview"><h3>Revisar manualmente (opcional)</h3><p className="muted">Estes textos ficam preservados na mensagem original. Você pode aproveitá-los ou corrigir os campos na tabela. Não é necessário marcar conferência para salvar produtos com os campos obrigatórios preenchidos.</p>
        {preview.review.map(line => <div className="reviewLine" key={line.id}>
          <div><strong>Linha {line.line}</strong><p className="sourceText">{line.text}</p><small>{line.reason}</small></div>
          {line.resolution ? <span>Ação aplicada: {line.resolution}</span> : <div className="reviewAction"><label>Como usar este texto<select aria-label={`Como usar o texto da linha ${line.line}`} value="" onChange={e => resolve(line, e.target.value)}>
            <option value="">Escolha uma ação (opcional)</option>{REVIEW_ACTIONS.map(option=><option key={option.value} value={option.value} disabled={!selected.length&&['client','notes'].includes(option.value)}>{option.label}</option>)}
          </select></label><small>Cliente e observações alteram apenas os produtos marcados. Criar produto adiciona uma linha editável; manter na mensagem não altera produtos nem status.</small></div>}
        </div>)}
      </div>}
      <div className="importSummary"><div><strong>{preview.items.length} produto(s) · Total {mode === 'request' ? 'cotado' : 'da compra'}: {money(previewTotal(preview.items))}</strong>
        {issues.length ? <div className="importPending" role="status"><p>Para salvar, resolva:</p><ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div> : <p className="muted">Tudo pronto. O registro só será criado ao confirmar abaixo.</p>}</div>
        <button type="button" className="primary" disabled={invalid} onClick={save}>Confirmar e salvar solicitações</button>
      </div>
    </>}
  </section>;
}
