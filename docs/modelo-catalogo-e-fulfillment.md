# Modelo de catálogo e fulfillment (Fases 2 e 3)

Definido pelo Vinicius em 13/09/2026. Vale para o storefront, para a
Function de catálogo, para a de pedidos e para o fulfillment da Fase 3.
Mudança neste modelo é decisão do owner, não detalhe de implementação.

---

## 1. Quem é fonte de quê

| Pergunta | Fonte | Não é fonte |
|---|---|---|
| Que produtos existem, nome, estoque (`status`) | Lapak (`/category`, `/product` via proxy) | — |
| **Pode vender no país X?** | **Admin Recarga Games: `price_benchmarks.published` por `country_code`** | O `country_code` da Lapak, o sufixo `-br` do código, o nome da categoria |
| Preço ao cliente | `price_benchmarks.rrp_final` do mercado | Preço Lapak (é custo) |
| Qual mercado o cliente está vendo | Localização da requisição (path hoje, domínio depois — `market.js`) | Escolha do usuário |

**Por que o país da Lapak não decide:** a Lapak marca conteúdo como
Indonésia que é global ou regional, e o contrário também acontece. Em
13/09, a categoria `FFLATAM` ("Free Fire - Latam (exclude Brazil)") volta
em `/category?country_code=br` com `country_code: "br"`, e os produtos
dela têm sufixo `-br`. O campo repete o país da consulta; não descreve a
área de resgate. Quem sabe o que funciona em cada mercado é o operador,
e ele registra isso publicando no admin.

---

## 2. D1 (reescrito) — o que entra no catálogo de um mercado

Um pacote entra no catálogo do mercado `M` se e somente se:

- **(a)** existe linha em `price_benchmarks` com `country_code = M`,
  `published = true` e `auto_paused` diferente de `true`; e
- **(b)** a Lapak devolve o `product_code` com `status = "available"`.

**Só isso.** Nenhuma outra regra de mercado exclui produto.

A única exclusão fora de (a)+(b) não é de mercado, é de segurança: a
categoria que exige `orderdetail` fica fora do catálogo B2C (seção 3).

### Ligação produto → jogo (não exclui nada)

`price_benchmarks` não referencia o jogo. A ligação é feita pelo código:
o produto pertence à categoria Lapak cujo `code` é o **prefixo mais
longo** do `group_product_code` dele, entre as categorias que a Lapak
devolve para o mercado. O jogo é a linha de `games` com esse
`category_code`.

Exemplo: `FFLATAM110` casa com `FF` e com `FFLATAM`; ganha `FFLATAM`. O
produto vai para o jogo cujo `category_code` é `FFLATAM`, e não para o
Free Fire (`FF`).

Isto é necessário porque `/product?category_code=FF` devolve também os
produtos `FFLATAM…`, então filtrar pela consulta não isola a categoria.

Publicado que não casa com nenhum jogo ativo do mercado **não aparece**
(não há página onde mostrá-lo) e **é logado** como
`catalog: published_without_game code=<product_code>`.

### Aviso ao operador (não exclui)

Se um produto publicado cai numa categoria cujo nome diz
`exclude <país do mercado>` (ex: "exclude Brazil" no mercado `br`), ele
**continua no catálogo** e a Function loga:

```
catalog: warn published_but_category_suggests_incompatible market=br code=<product_code> category=<code>
```

Revisar é trabalho do operador no admin, não da loja.

### Pacote canônico (variantes de fornecedor)

Quando mais de um `product_code` elegível pelas regras (a)+(b)
corresponde ao **mesmo jogo + mesmo `face_value`**, a loja mostra um só
pacote: o de **menor `rrp_final`**. Empate: menor `product_code` em
ordem lexicográfica, para o resultado ser estável entre chamadas. O
`product_code` escolhido é o que vai no pedido.

As variantes não canônicas continuam valendo como **alternativas de
fallback** (seções 4 e 5): elegíveis, mesmo jogo, mesmo `face_value`.

Evolução registrada: flag `is_primary` no admin.

### Contagem esperada no C2

`M` = número de pares (jogo, `face_value`) com pelo menos uma variante
que passa em (a)+(b). Em 13/09 muitas variantes publicadas estavam
`empty` na Lapak (Free Fire: 12 de 40 produtos `available`;
`UCPUBGMGLOBAL325-S50-br` `empty`), então `M` fica bem abaixo das 52
linhas publicadas. Isso é esperado.

---

## 3. Campos de resgate

A Lapak descreve os campos por categoria (`forms`) com **só** `name` e
`type`. Não há label, placeholder nem regex. Levantamento de 13/09, nas
264 categorias BR:

| `name` | `type` vistos |
|---|---|
| `user_id` | `text` (146), `tel` (71), `number` (4) |
| `additional_id` | `option` (39), `text` (11), `tel` (7) |
| `additional_information` | `option` (33), `text` (30), `textarea` (1), `tel` (1) |
| `orderdetail` | `text` (31) |

### Validação: derivada do `type`, igual no browser e no servidor

| `type` | Regra |
|---|---|
| `tel`, `number` | só dígitos, 4 a 20 |
| `text`, `textarea` | 1 a 64 caracteres após `trim` |
| `option` | valor exatamente igual a um `options[].value` |

A Function de catálogo devolve a regra pronta (`pattern`, `minLength`,
`maxLength`, `options`). O browser usa para dar feedback; o
`orders-create` **recalcula a partir do catálogo** e é quem decide.

### Rótulo: mapa por `name`, na página

A Function devolve `name`, não texto. O rótulo em pt-BR fica na página
(copy é da página, e i18n é Fase 1b). Nome sem entrada no mapa usa um
rótulo genérico, nunca o `name` cru.

### Ajuste fino futuro

`games.redemption_form jsonb` no admin, para sobrescrever label e regex
por jogo. Fora da Fase 2.

### Decisão (13/09): `orderdetail` fica FORA do catálogo B2C no lançamento

31 categorias BR pedem `orderdetail`, que pela doc Lapak são
**credenciais de login do jogo** ("Password : 123 Nickname : … Security
code"). Gravar senha de terceiro em `orders.redemption_fields` é outro
nível de risco: LGPD, vazamento, responsabilidade.

Regra, decidida pelo Vinicius:

- `catalog.mjs` descarta toda categoria cujo `forms` contenha
  `name = "orderdetail"`, **mesmo com pacote publicado e disponível**.
- Cada descarte vai para o log, com a categoria e sem PII:
  `catalog: skip orderdetail_required market=<m> category=<code> published=<n>`
- Como o `orders-create` valida contra o catálogo, pedido para esses SKUs
  cai no mesmo 400 de produto inexistente. Não há um segundo caminho.

**Revisitar** só com consentimento explícito do cliente e armazenamento
transitório cifrado: a credencial existe apenas até o fulfillment e
nunca fica em claro no banco nem no log.

---

## 4. Antes da cobrança — validação de ID (DTU)

```
cliente envia pedido
  └─ SKU tem check de ID disponível?
       ├─ não  → id_validation = 'unsupported' → grava awaiting_payment
       └─ sim  → consulta via proxy
                  ├─ válido   → 'valid'   → grava awaiting_payment → (Fase 3) pagamento → fulfillment
                  ├─ inválido → 'invalid' → tenta as ALTERNATIVAS (seção 2) com o mesmo ID
                  │               ├─ alguma válida → troca o product_code para ela → 'valid' → grava
                  │               └─ nenhuma       → 400 id_not_eligible, com mensagem clara, NADA gravado
                  └─ erro     → 'error'   → grava awaiting_payment (a checagem é conveniência, não trava)
```

Resultado em `orders.id_validation`: `valid` | `invalid` | `unsupported` | `error`.

Uma linha só é gravada com `invalid` se, no futuro, o owner decidir
registrar tentativas recusadas. Hoje o `invalid` sem alternativa devolve
400 e não grava.

### Estado real em 13/09: nenhum SKU nosso tem check de ID

- A doc da Lapak v1.6 (`docs/vendor/lapak-reseller-api.pdf`, fora do
  git) **não tem endpoint de checagem de ID**. A lista de APIs
  suportadas é: categories, products, all-products, balance, order,
  order_status, best product, FX rate e callbacks.
- `/category` traz um campo `check_id`: `inactive` em 261 categorias BR e
  `active` em 3 (`MCGG`, `NEAR`, `SS`). Nenhuma delas é jogo do catálogo.

**Decisão (13/09):** na Fase 2 o gancho existe no `orders-create` e
**sempre grava `unsupported`**. Sem contrato documentado, chamar um
endpoint inventado seria pior do que não chamar.

### 🔴 Pré-requisito COMERCIAL da Fase 3

Conversa com a Lapak, não tarefa de código:

- [ ] Pedir a **ativação do `check_id`** para as categorias de
      **Free Fire, PUBG Mobile e Mobile Legends**.
- [ ] Obter o contrato da checagem (endpoint, parâmetros, resposta, rate
      limit), que não está na doc v1.6.

Só depois disso, tarefa técnica: implementar a chamada no gancho. Até
lá, `unsupported`.

---

## 5. Depois da cobrança — fulfillment (Fase 3)

```
pagamento confirmado (webhook PagBrasil, HMAC validado)
  └─ cria order na Lapak com o product_code do pedido
       ├─ sucesso → completed (DTU) / PIN por e-mail + visível até code_visible_until (D4)
       └─ falha   → fallback: próxima ALTERNATIVA (seção 2), uma vez
                     ├─ sucesso → completed, com o product_code efetivo registrado
                     └─ falha   → alerta no ADMIN para o operador (pedido pago e não entregue)
```

Regras que já valem no reload e continuam valendo aqui: **nunca** retry
automático do mesmo create (a Lapak não deduplica), e falha ambígua
(timeout, 5xx) **não** dispara fallback: vira caso humano, porque a
primeira order pode ter saído.

**Fora de escopo:** tirar o conteúdo da loja automaticamente depois de
falhas. Evolução futura, não mapear agora.

---

## 6. Taxa do meio de pagamento (D2)

Fonte: `payment_methods` do país, linha ativa do método. As colunas
reais (bloco 0, 13/09) são `transaction_cost_percent` (numeric, em %) e
`fixed_cost` (numeric, **em reais**), e não `pct`/`fixed_cost_cents` como
dizia o brief.

```
fee_cents = round(amount_cents * transaction_cost_percent / 100)
          + round(fixed_cost * 100)
```

A conversão de `fixed_cost` para centavos acontece na Function, uma vez;
nada de float sai dela. No lançamento a taxa é **absorvida**: vai para
`orders.fee_cents` como custo e não é somada a `amount_cents`.

---

## 7. Chaves e ambiente

| Function | `PROXY_URL` | `PROXY_ADMIN_KEY` | `LAPAK_ENV` |
|---|---|---|---|
| `catalog.mjs` | sim | **não**: leitura de catálogo no `/gateway` é pública, e esta chave cria pedido na Lapak | sim |
| `orders-create.mjs` | sim | sim, só para o check de ID (seção 4) | sim |
| `orders-expire.mjs` | não | não | não |

`LAPAK_ENV` é **obrigatória e sem default**, e o header `x-env` vai
sempre explícito. O proxy usa `dev` quando o header falta, e catálogo de
dev em produção mostraria estoque e produtos de outro ambiente sem erro
nenhum.
