import React, { useRef, useState } from 'react';
import { boughtQuantity, purchasePlan, registeredPrice } from '../domain/purchaseLedger.js';
import { makeId } from '../domain/whatsapp.js';
const currency = (value) =>
  Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function BulkRequestActions({
  rows,
  suppliers,
  sellers,
  onGenerate,
  onApply,
  onClear,
}) {
  const [panel, setPanel] = useState('');
  const [enabled, setEnabled] = useState({});
  const [fields, setFields] = useState({ supplier: '', seller: '', client: '', date: '' });
  const [status, setStatus] = useState('');
  const [quantities, setQuantities] = useState({});
  const [prices, setPrices] = useState({});
  const [operationId, setOperationId] = useState(makeId);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const buying = ['Comprado', 'Parcial'].includes(status);
  const plan = purchasePlan(rows, {
    mode: status === 'Parcial' ? 'partial' : 'full',
    quantities,
    prices,
  });
  const eligible = rows.filter(
    (row) => row.status !== 'Cancelado' && Number(row.quantity) > boughtQuantity(row),
  );
  async function apply(action) {
    if (submitting.current) return;
    submitting.current = true;
    try {
      await onApply(action);
      setPanel('');
      setError('');
    } catch (cause) {
      setError(cause.message);
    } finally {
      submitting.current = false;
    }
  }
  function show(name) {
    setPanel((previous) => (previous === name ? '' : name));
    setError('');
    setStatus('');
    setQuantities({});
    setPrices({});
    setOperationId(makeId());
  }
  return (
    <div className="bulkRequests">
      <div className="selectionBar" role="toolbar" aria-label="Ações das solicitações selecionadas">
        <strong>{rows.length} selecionado(s)</strong>
        <button className="primary" onClick={onGenerate}>
          Gerar pedido
        </button>
        <button className="secondary" onClick={() => show('edit')}>
          Editar
        </button>
        <button className="secondary" onClick={() => show('status')}>
          Alterar status
        </button>
        <button
          className="link danger"
          onClick={() => {
            if (
              confirm(
                `Excluir ${rows.length} solicitações selecionadas? Esta ação não pode ser desfeita.`,
              )
            )
              apply({ type: 'delete' });
          }}
        >
          Excluir
        </button>
        <button className="link" onClick={onClear}>
          Limpar seleção
        </button>
      </div>
      {panel === 'edit' && (
        <form
          className="bulkRequestForm"
          onSubmit={(event) => {
            event.preventDefault();
            apply({
              type: 'edit',
              patch: Object.fromEntries(Object.entries(fields).filter(([field]) => enabled[field])),
            });
          }}
        >
          <h3>Editar selecionadas</h3>
          <p className="muted">
            Marque somente os campos que deseja substituir nas solicitações selecionadas.
          </p>
          <div className="formGrid">
            {[
              ['supplier', 'Fornecedor'],
              ['seller', 'Vendedor'],
              ['client', 'Cliente'],
              ['date', 'Data da solicitação'],
            ].map(([field, label]) => (
              <div key={field}>
                <label className="checkLabel">
                  <input
                    type="checkbox"
                    checked={!!enabled[field]}
                    onChange={(event) =>
                      setEnabled((previous) => ({ ...previous, [field]: event.target.checked }))
                    }
                  />
                  Alterar {label.toLowerCase()}
                </label>
                {field === 'supplier' || field === 'seller' ? (
                  <select
                    aria-label={`${label} das selecionadas`}
                    disabled={!enabled[field]}
                    value={fields[field]}
                    onChange={(event) =>
                      setFields((previous) => ({ ...previous, [field]: event.target.value }))
                    }
                  >
                    <option value="">Selecione</option>
                    {(field === 'supplier' ? suppliers : sellers).map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label={`${label} das selecionadas`}
                    disabled={!enabled[field]}
                    type={field === 'date' ? 'date' : 'text'}
                    value={fields[field]}
                    onChange={(event) =>
                      setFields((previous) => ({ ...previous, [field]: event.target.value }))
                    }
                  />
                )}
              </div>
            ))}
          </div>
          <div className="actions">
            <button className="secondary" type="button" onClick={() => setPanel('')}>
              Cancelar
            </button>
            <button className="primary" type="submit">
              Salvar alterações em massa
            </button>
          </div>
        </form>
      )}
      {panel === 'status' && (
        <form
          className="bulkRequestForm"
          onSubmit={(event) => {
            event.preventDefault();
            apply(
              buying
                ? {
                    type: 'purchase',
                    mode: status === 'Parcial' ? 'partial' : 'full',
                    quantities,
                    prices,
                    operationId,
                    confirmed: true,
                  }
                : { type: 'status', status },
            );
          }}
        >
          <h3>Alterar status das selecionadas</h3>
          <label>
            Status
            <select
              aria-label="Status das selecionadas"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setError('');
                setOperationId(makeId());
              }}
            >
              <option value="">Selecione</option>
              <option value="Comprado">Comprado</option>
              <option value="Parcial">Parcialmente comprado</option>
              <option value="Pendente">Pendente</option>
              <option value="Cancelado">Cancelado</option>
            </select>
          </label>
          {status === 'Pendente' && (
            <p className="muted">
              A quantidade comprada será zerada. Os lançamentos anteriores serão mantidos como
              desfeitos para correção, sem entrar nos gastos.
            </p>
          )}
          {status === 'Cancelado' && (
            <p className="muted">
              Os dados anteriores serão preservados, e as selecionadas deixarão de contar como
              gasto.
            </p>
          )}
          {buying && (
            <>
              {status === 'Parcial' && (
                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Ainda pendente</th>
                        <th>Quantidade desta compra</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eligible.map((row, index) => (
                        <tr key={row.id}>
                          <td className="productCell">{row.sku}</td>
                          <td>{Number(row.quantity) - boughtQuantity(row)}</td>
                          <td>
                            <input
                              aria-label={`Quantidade desta compra ${index + 1}`}
                              type="number"
                              min="1"
                              max={Number(row.quantity) - boughtQuantity(row)}
                              step="1"
                              value={quantities[row.id] ?? ''}
                              onChange={(event) =>
                                setQuantities((previous) => ({
                                  ...previous,
                                  [row.id]: event.target.value,
                                }))
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="reportTotals purchaseOperationSummary">
                <strong>{rows.length} produto(s) selecionado(s)</strong>
                <span>{plan.units || 0} unidade(s) nesta compra</span>
                <strong>Total da operação: {currency(plan.total)}</strong>
              </div>
              <p className="muted">
                Fornecedor, descrição, cliente e vendedor serão mantidos. A data e hora atuais serão
                registradas ao confirmar. Compras anteriores não serão repetidas.
              </p>
              {!!plan.skipped.length && (
                <p className="muted">
                  {plan.skipped.length} produto(s) já comprado(s) integralmente ou cancelado(s) não
                  terão novo lançamento.
                </p>
              )}
              <details className="purchasePriceAdjust">
                <summary>Ajustar preço pago (opcional)</summary>
                <p className="muted">
                  A alteração vale somente para esta nova compra. As parcelas anteriores mantêm seus
                  preços.
                </p>
                {eligible.map((row, index) => (
                  <label key={row.id}>
                    {row.sku}
                    <input
                      aria-label={`Preço pago nesta compra ${index + 1}`}
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={prices[row.id] ?? (registeredPrice(row) || '')}
                      onChange={(event) =>
                        setPrices((previous) => ({ ...previous, [row.id]: event.target.value }))
                      }
                    />
                  </label>
                ))}
              </details>
              {!!plan.errors.length && (
                <p role="alert" className="bulkError">
                  {plan.errors.join('\n')}
                </p>
              )}
            </>
          )}
          <div className="actions">
            <button className="secondary" type="button" onClick={() => setPanel('')}>
              Cancelar
            </button>
            <button
              className="primary"
              type="submit"
              disabled={!status || (buying && (!!plan.errors.length || !plan.items.length))}
            >
              {buying ? 'Confirmar compra' : 'Aplicar status'}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="bulkError" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
