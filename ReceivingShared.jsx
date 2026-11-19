import React from 'react';

export function Catalog({api, suppliers, products, run, busy}) {
  function submit(name, keys) {
    return event => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      run(async () => {
        await api.rpc(name, Object.fromEntries(keys.map(key => [key, data.get(key)])));
        form.reset();
      });
    };
  }

  const supplierSelect = name => <select required name={name}><option value="">Selecione</option>
    {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.legal_name}</option>)}
  </select>;

  return <div className="rx-catalog">
    <form className="rx-card" onSubmit={submit('set_supplier_cnpj', ['target', 'document'])}>
      <h2>Fornecedor</h2>
      <label>Fornecedor{supplierSelect('target')}</label>
      <label>CNPJ<input name="document" pattern="[0-9]{14}" placeholder="14 dígitos" required/></label>
      <button className="rx-primary" disabled={busy}>Vincular CNPJ</button>
    </form>
    <form className="rx-card" onSubmit={submit('register_product', ['code', 'description', 'stock_unit'])}>
      <h2>Produto</h2>
      <label>Código interno<input name="code" required/></label>
      <label>Descrição<input name="description" required/></label>
      <label>Unidade<input name="stock_unit" required/></label>
      <button className="rx-primary" disabled={busy}>Cadastrar produto</button>
    </form>
    <form className="rx-card" onSubmit={submit('validate_equivalence', ['product', 'supplier', 'external_code', 'external_unit'])}>
      <h2>Equivalência</h2>
      <label>Produto<select name="product" required><option value="">Selecione</option>
        {products.map(product => <option key={product.id} value={product.id}>{product.internal_code} · {product.name}</option>)}
      </select></label>
      <label>Fornecedor{supplierSelect('supplier')}</label>
      <label>Código no fornecedor<input name="external_code" required/></label>
      <label>Unidade no fornecedor<input name="external_unit" required/></label>
      <button className="rx-primary" disabled={busy}>Validar equivalência</button>
    </form>
  </div>;
}

export function Occurrences({alerts, onResolve}) {
  return <section className="panel"><h2>Ocorrências de conferência</h2>
    {!alerts.length && <p>Nenhuma ocorrência registrada.</p>}
    {alerts.map(alert => <div key={alert.id} className="occurrence-body">
      <p>{alert.description} · {alert.status === 'resolved' ? 'Resolvida' : 'Em aberto'}</p>
      {alert.resolution_notes && <p>{alert.resolution_notes}</p>}
      {alert.status === 'open' && <form onSubmit={event => {
        event.preventDefault();
        onResolve(alert.id, new FormData(event.currentTarget).get('justification'));
      }}>
        <label>Resolução<input name="justification" required/></label><button className="secondary">Registrar resolução</button>
      </form>}
    </div>)}
  </section>;
}

