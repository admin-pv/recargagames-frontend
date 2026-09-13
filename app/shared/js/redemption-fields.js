/* ──────────────────────────────────────────────────────────────────────────
   redemption-fields.js — campos de resgate vindos do catálogo (Fase 2)

   O catálogo (/api/catalog) entrega cada campo como a Lapak descreve,
   com a regra já derivada no servidor:
     { name, type, inputMode, pattern, minLength, maxLength, options? }

   Este arquivo faz duas coisas, e só duas:
     1. valida no browser com a MESMA regra que veio do servidor, para dar
        feedback. Quem decide é o orders-create, que reaplica a regra;
     2. dá RÓTULO e dica ao campo. A Lapak não manda texto nenhum, e texto
        é copy: fica fora do servidor e do store.js.

   Os textos estão indexados por locale (market.js). Hoje só pt-BR; i18n
   de verdade é a Fase 1b. Um locale sem tabela usa a de pt-BR em vez de
   mostrar o `name` cru ("user_id") para o cliente.

   Carregado depois de market.js.
   ────────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  var COPY = {
    'pt-BR': {
      user_id: { label: 'ID do jogador', placeholder: 'Ex: 123456789', help: 'Encontre seu ID no perfil, dentro do jogo.' },
      additional_id: { label: 'Servidor / Zona', placeholder: 'Ex: 2151', help: 'Aparece junto do seu ID no perfil do jogo.' },
      additional_information: { label: 'Informação adicional', placeholder: '', help: 'Informação pedida pelo jogo para completar a recarga.' },
      _fallback: { label: 'Dado da conta do jogo', placeholder: '', help: '' },
      _choose: 'Selecione'
    }
  };

  function copyTable() {
    var locale = (global.RecargaMarket && global.RecargaMarket.locale) || 'pt-BR';
    return COPY[locale] || COPY['pt-BR'];
  }

  /* Campo do catálogo → forma que as páginas renderizam.
     `key` = `name` da Lapak: é a chave que vai em redemptionFields no
     pedido e em linked_accounts[].fields no perfil. */
  function toFormField(field) {
    var t = copyTable();
    var c = t[field.name] || t._fallback;
    return {
      key: field.name,
      type: field.type,
      inputMode: field.inputMode || 'text',
      label: c.label,
      placeholder: c.placeholder,
      help: c.help,
      chooseLabel: t._choose,
      pattern: field.pattern || null,
      minLength: field.minLength,
      maxLength: field.maxLength,
      options: field.options || null
    };
  }

  function toFormFields(product) {
    return ((product && product.fields) || []).map(toFormField);
  }

  /* Espelho de isFieldValueValid() em netlify/lib/catalog.mjs. As duas
     leem as mesmas propriedades; a regra em si (4–20 dígitos, 1–64
     caracteres, valor da lista) vive só no servidor. */
  function isValid(field, raw) {
    var value = typeof raw === 'string' ? raw.trim() : '';
    if (field.type === 'option') {
      return (field.options || []).some(function (o) { return o.value === value; });
    }
    if (field.minLength !== null && field.minLength !== undefined && value.length < field.minLength) return false;
    if (field.maxLength !== null && field.maxLength !== undefined && value.length > field.maxLength) return false;
    if (field.pattern && !new RegExp(field.pattern).test(value)) return false;
    return true;
  }

  global.RecargaFields = {
    toFormField: toFormField,
    toFormFields: toFormFields,
    isValid: isValid
  };
})(window);
