export const DEFAULT_SELLERS = ['Cardoso', 'Luiz', 'João', 'Eduardo', 'Adriana', 'Carioca', 'Alana', 'Jessica', 'Fran', 'Rafael Oliveira'];

export function migrateSellers(db) {
  if (db.sellerNamesVersion === 1) return db;
  const names = Object.fromEntries(DEFAULT_SELLERS.map((name, i) => [`Vendedor ${String(i + 1).padStart(2, '0')}`, name]));
  return {
    ...db,
    sellers: [...new Set([...DEFAULT_SELLERS, ...db.sellers.map(name => names[name] || name)])],
    requests: db.requests.map(request => ({...request, seller: names[request.seller] || request.seller})),
    sellerNamesVersion: 1,
  };
}

export function renameSeller(db, previous, name) {
  const next = name.trim();
  if (!next) throw new Error('Informe o nome do vendedor.');
  if (db.sellers.some(seller => seller !== previous && seller.toLocaleLowerCase('pt-BR') === next.toLocaleLowerCase('pt-BR'))) {
    throw new Error('Já existe um vendedor com esse nome.');
  }
  return {
    ...db,
    sellers: db.sellers.map(seller => seller === previous ? next : seller),
    requests: db.requests.map(request => request.seller === previous ? {...request, seller: next} : request),
  };
}

export function removeSeller(db, name) {
  if (!db.sellers.includes(name)) throw new Error('Vendedor não encontrado.');
  // Remove only the active catalog entry. Historical requests keep their names,
  // purchases and totals, including when the last active seller is removed.
  return {...db, sellers: db.sellers.filter(seller => seller !== name)};
}
