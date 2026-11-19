// The same supplier catalog is used by the app, importer and save validation.
export const DEFAULT_SUPPLIERS = ['Master', 'Potencial', 'Imprime', 'FA Print', 'RHB'];
export function getSuppliers(db) {
  return Array.isArray(db.suppliers) ? db.suppliers : DEFAULT_SUPPLIERS;
}
export function addSupplier(db, value) {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Informe o nome do fornecedor.');
  const key = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
  if (getSuppliers(db).some(supplier => key(supplier) === key(name))) throw new Error('Já existe um fornecedor com esse nome.');
  return {...db, suppliers: [...getSuppliers(db), name]};
}
