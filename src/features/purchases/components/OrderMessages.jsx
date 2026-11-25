import React, { useRef, useState } from 'react';

export default function OrderMessages({ groups, onClose, onConfirm }) {
  const [messages, setMessages] = useState(groups);
  const [feedback, setFeedback] = useState('');
  const fields = useRef([]);
  const confirming = useRef(false);
  async function confirmOrders() {
    if (confirming.current) return;
    confirming.current = true;
    try {
      await onConfirm(messages);
    } catch (error) {
      setFeedback(error.message);
    } finally {
      confirming.current = false;
    }
  }
  async function copy(index) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(messages[index].text);
      else {
        fields.current[index].select();
        if (!document.execCommand('copy')) throw new Error('Cópia indisponível');
      }
      setFeedback(`Mensagem de ${messages[index].title} copiada.`);
    } catch {
      fields.current[index].focus();
      fields.current[index].select();
      setFeedback('Não foi possível copiar automaticamente. O texto está selecionado; use Ctrl+C.');
    }
  }
  return (
    <section className="orderMessages" aria-labelledby="order-title">
      <div className="panelHead">
        <h3 id="order-title">Pedidos por fornecedor</h3>
        <button type="button" className="secondary" onClick={onClose}>
          Fechar pedido
        </button>
      </div>
      <p className="muted">
        Uma mensagem por fornecedor com os produtos selecionados desta solicitação. Confira, edite e
        copie. Gerar ou copiar não registra uma compra.
      </p>
      {messages.map((group, index) => (
        <div className="supplierMessage" key={group.id}>
          <label>
            {group.title}
            <textarea
              ref={(element) => {
                fields.current[index] = element;
              }}
              aria-label={`Pedido para ${group.title}`}
              rows={Math.min(9, Math.max(3, group.text.split('\n').length + 1))}
              value={group.text}
              onChange={(e) =>
                setMessages((previous) =>
                  previous.map((entry, i) =>
                    i === index ? { ...entry, text: e.target.value } : entry,
                  ),
                )
              }
            />
          </label>
          {group.missingPrice && (
            <p className="muted">
              Há itens sem preço informado. Substitua “[informar valor]” antes de enviar.
            </p>
          )}
          <button
            type="button"
            className="primary"
            aria-label={`Copiar mensagem ${group.title}`}
            disabled={!group.text.trim()}
            onClick={() => copy(index)}
          >
            Copiar mensagem
          </button>
        </div>
      ))}
      {feedback && <p role="status">{feedback}</p>}
      {onConfirm && (
        <div className="importSummary">
          <p className="muted">
            Confirmar marca os{' '}
            {messages.reduce((sum, message) => sum + (message.requestIds?.length || 1), 0)} produtos
            selecionados como Pedido gerado, mantendo-os neste lote. Não registra compra nem
            comprova envio ao fornecedor.
          </p>
          <button
            type="button"
            className="primary"
            disabled={messages.some((message) => !message.text.trim())}
            onClick={confirmOrders}
          >
            Confirmar pedido gerado
          </button>
        </div>
      )}
    </section>
  );
}
