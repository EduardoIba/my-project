import React, {useEffect, useState} from 'react';
import Table from './RequestTable.jsx';
import {isPurchased, purchaseDateLabel} from './purchases.js';
import {lastPaidPrices, purchasePeriod, purchaseReport} from './purchaseReports.js';
const currency = value => Number(value || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});

export function LastPaidPrices({rows, supplier, search}) {
  const matches = lastPaidPrices(rows, {supplier, search});
  return <section className="panel lastPaidPrices"><h2>Último preço unitário pago</h2>
    <p className="muted">Pesquise um produto ou SKU no campo Pesquisar acima. Esta consulta usa o histórico completo e o fornecedor selecionado, independentemente do período do painel.</p>
    {search.trim() ? <div className="tableWrap"><table><thead><tr>{['Produto / SKU', 'Fornecedor', 'Preço pago por unidade', 'Data da compra', 'Quantidade daquela compra'].map(title => <th key={title}>{title}</th>)}</tr></thead>
      <tbody>{matches.length ? matches.map(row => <tr key={JSON.stringify([row.sku, row.supplier])}>
        <td className="productCell">{row.sku}</td><td>{row.supplier || 'Não informado'}</td>
        <td><strong className="lastPaidValue">{row.prices.map(currency).join(' / ')}</strong>{row.ambiguous && <small className="quantityBought">Mais de um preço na mesma data, sem horário suficiente para definir o último.</small>}{row.hasUndated && <small className="quantityBought">{row.purchaseDate ? 'Há compras sem data. Referência entre as compras datadas.' : 'Compra sem data: não é possível confirmar qual foi a última.'}</small>}</td>
        <td>{purchaseDateLabel(row)}</td><td>{row.candidates.length === 1 ? row.purchasedQty : 'Vários registros na mesma data'}</td>
      </tr>) : <tr><td colSpan="5" className="empty">Nenhuma compra efetivada encontrada para o produto e fornecedor pesquisados.</td></tr>}</tbody></table></div> : <p className="muted">Exemplo: TN2340. São exibidos preços reais de compras, sem usar cotações ou médias.</p>}
  </section>;
}

export default function PurchaseReports({rows, pendingRows = [], period, supplier, search, onCustomPeriod, savedDates, onDatesChange, edit, initialSeller = ''}) {
  const [dates, setDates] = useState(() => period === 'personalizado' && savedDates ? savedDates : purchasePeriod(period));
  const [client, setClient] = useState('');
  const [seller, setSeller] = useState(initialSeller);
  const [groupBy, setGroupBy] = useState('client');
  useEffect(() => {if (period !== 'personalizado') setDates(purchasePeriod(period));}, [period]);
  const invalid = dates.from && dates.to && dates.from > dates.to;
  const report = purchaseReport(rows, {...dates, supplier, client, seller, search});
  const names = field => [...new Set(rows.filter(isPurchased).map(row => row[field]?.trim() || 'Não informado'))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  function changeDate(field, value) {const next = {...dates, [field]: value};setDates(next);onDatesChange(next);onCustomPeriod();}
  const summaries = groupBy === 'client' ? report.byClient : groupBy === 'seller' ? report.bySeller : report.bySupplier;
  return <div className="panel purchaseReports"><h2>Relatórios de compras</h2>
    <p className="muted">Confira as compras pela data em que foram realizadas, para comparar com as vendas do cliente ou vendedor.</p>
    <div className="filters reportFilters">
      <label>Compras de<input aria-label="Data inicial da compra" type="date" value={dates.from} onChange={event => changeDate('from', event.target.value)}/></label>
      <label>Compras até<input aria-label="Data final da compra" type="date" value={dates.to} onChange={event => changeDate('to', event.target.value)}/></label>
      <label>Cliente<select aria-label="Cliente do relatório" value={client} onChange={event => setClient(event.target.value)}><option value="">Todos os clientes</option>{names('client').map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Vendedor<select aria-label="Vendedor do relatório" value={seller} onChange={event => setSeller(event.target.value)}><option value="">Todos os vendedores</option>{names('seller').map(name => <option key={name}>{name}</option>)}</select></label>
    </div>
    {invalid ? <p role="alert" className="bulkError">A data inicial não pode ser posterior à data final.</p> : <>
      <div className="reportTotals"><strong>Total efetivamente comprado: {currency(report.total)}</strong><span>{report.purchases.length} registro(s) · {report.units.toLocaleString('pt-BR')} unidade(s) comprada(s)</span></div>
      {report.missingDates > 0 && <p className="muted">{report.missingDates} compra(s) antiga(s) sem data válida. {dates.from || dates.to ? 'Não entram neste período; selecione Todo o histórico para consultá-las e use Editar para informar a data correta.' : 'Estão incluídas no total, com data indicada como Não informada. Use Editar para informar a data correta.'}</p>}
      <div className="report"><label>Somar compras por<select aria-label="Agrupar compras por" value={groupBy} onChange={event => setGroupBy(event.target.value)}><option value="client">Cliente</option><option value="seller">Vendedor</option><option value="supplier">Fornecedor</option></select></label>
        <div className="tableWrap"><table className="purchaseSummary"><thead><tr>{[groupBy === 'client' ? 'Cliente' : groupBy === 'seller' ? 'Vendedor' : 'Fornecedor', 'Registros de compra', 'Unidades compradas', 'Total comprado'].map(title => <th key={title}>{title}</th>)}</tr></thead>
          <tbody>{summaries.length ? summaries.map(group => <tr key={group.name}><td>{group.name}</td><td>{group.items}</td><td>{group.units}</td><td>{currency(group.total)}</td></tr>) : <tr><td className="empty" colSpan="4">Sem compras para os filtros selecionados.</td></tr>}</tbody>
          <tfoot><tr><th>Total geral</th><th>{report.purchases.length}</th><th>{report.units}</th><th>{currency(report.total)}</th></tr></tfoot></table></div>
      </div>
      <div className="report productRanking"><h3>Itens mais comprados</h3><p className="muted">Do maior para o menor em quantidade efetivamente comprada, conforme os filtros acima. Os códigos da lista de equivalências são somados independentemente do restante da descrição (ex.: CE310/CE310A, W1810/W1810X e CB540/CB540A). Outros produtos usam tipo e código principal ou descrição normalizada. Os registros originais são preservados.</p>
        <div className="tableWrap"><table><thead><tr><th>Nº</th><th>Produto / SKU</th><th>Quantidade total comprada</th><th>Total comprado</th></tr></thead><tbody>
          {report.byProduct.length?report.byProduct.map((product,index)=><tr key={product.name}><td>{index+1}</td><td className="productCell">{product.name}</td><td><strong>{product.units.toLocaleString('pt-BR')}</strong><small className="quantityBought">Soma de {product.items} registro(s) de compra</small></td><td>{currency(product.total)}</td></tr>):<tr><td colSpan="4" className="empty">Nenhum item comprado nos filtros selecionados.</td></tr>}
        </tbody><tfoot><tr><th colSpan="2">Total geral</th><th>{report.units.toLocaleString('pt-BR')}</th><th>{currency(report.total)}</th></tr></tfoot></table></div>
      </div>
      <div className="report"><h3>Histórico de compras</h3><p className="muted">Somente quantidades efetivamente compradas. Pendentes, canceladas e cotações não contam como gasto.</p>
        <Table purchaseHistory rows={report.purchases} edit={edit}/></div>
      <details className="report"><summary>Solicitações pendentes</summary><Table rows={pendingRows.filter(row => {
        const date = isPurchased(row) ? row.purchaseDate : row.date;
        return (!client || row.client === client) && (!seller || row.seller === seller) && (!dates.from || date >= dates.from) && (!dates.to || date <= dates.to);
      })} edit={edit}/></details>
    </>}
  </div>;
}
