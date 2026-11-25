import React from 'react';
import {ArrowRight} from 'lucide-react';
import './sidebar.css';

const buyerItems = [
  {id: 'Painel', label: 'Painel'},
  {id: 'Nova solicitação', label: 'Nova solicitação'},
  {id: 'Solicitações', label: 'Solicitações'},
  {id: 'Relatórios', label: 'Relatórios'},
  {id: 'Configurações', label: 'Configurações'},
];
const receivingItems = [
  {id: 'dashboard', label: 'Painel'},
  {id: 'new', label: 'Nova conferência'},
  {id: 'history', label: 'Histórico'},
  {id: 'pending', label: 'Pendências'},
  {id: 'reports', label: 'Relatórios'},
];

export function sidebarOptions(module, role) {
  if (module === 'buyer' && ['comprador', 'administrador'].includes(role)) return buyerItems;
  if (module === 'receiving' && ['conferente', 'administrador'].includes(role)) {
    return role === 'administrador' ? [...receivingItems, {id: 'catalog', label: 'Cadastro fiscal'}] : receivingItems;
  }
  return [];
}

export default function Sidebar({items, active, onNavigate, moduleLabel, roleLabel, accessLabel, switchLabel, onSwitch, onSignOut, disabled = false}) {
  return <aside className="il-sidebar">
    <div className="il-sidebar-brand"><span>IL</span><div><strong>IMPORT LASER</strong><small>Gestão de Compras</small></div></div>
    <nav aria-label={moduleLabel}>
      {items.map(item => <button key={item.id} aria-current={active === item.id ? 'page' : undefined}
        onClick={() => onNavigate(item.id)} disabled={disabled}>{item.label}</button>)}
    </nav>
    <p className="il-sidebar-label">{moduleLabel}</p>
    <div className="il-sidebar-profile">
      {switchLabel && <button className="il-sidebar-switch" onClick={onSwitch} disabled={disabled}>
        {switchLabel}<ArrowRight size={14}/>
      </button>}
      <div><span>{roleLabel}<small>{accessLabel}</small></span>
        {onSignOut && <button onClick={onSignOut} disabled={disabled}>Sair</button>}
      </div>
    </div>
  </aside>;
}
