# Playvision — Log de Sessão 2026-09-10 (Frontend / Fase 0)

**Foco:** subir o frontend v2 do fornecedor em `/br/`, atrás do gate, com tudo
que não tem backend escondido e as URLs antigas redirecionadas.
**Modo:** MVP — nada de dinheiro, auth ou Supabase nesta fase.
**Repo:** `admin-pv/recargagames-frontend`. **PR:** #2. **Merge:** `481f3f9`.
**Motivador:** o `/br/` era uma SPA com router lendo `games` do Supabase. O
fornecedor entregou 18 páginas estáticas com uma camada `shared/` simulando
tudo em `localStorage`. Esta fase troca um pelo outro sem prometer nada que
não existe.

> **Estrutura:** §1–§6 são a entrega. §7 são os desvios do brief. §8 os bugs.
> §9 o bloqueio do `/docs/`. §10–§13 fecham.

---

## Resumo executivo

- **Entregue e em produção.** Frontend v2 no ar em `recargagames.com/br/`,
  atrás do gate. PR #2, merge `481f3f9`.
- **Os arquivos moram em `/app/`, não em `/br/`.** Um conjunto só, N mercados:
  o mercado é o path da requisição, não o path do arquivo. `/br/*` reescreve
  para `/app/:splat`; `/mx/` está a uma linha descomentada de existir.
- **O gate não foi tocado** e continua funcionando. `gate.ts` intacto,
  `br/_gate.html` no mesmo caminho, `/br/` devolve 401 com a página do gate.
- **`/app/` foi selado atrás do gate** com um 301 forçado. Isto **não estava no
  brief** e sem isso a Fase 0 teria publicado a loja inteira sem senha (§3).
- **`/mx/` ficou comentado**, por decisão do Vinicius durante a sessão, pelo
  mesmo motivo (§4).
- **Nada que não existe aparece na tela:** só Pix, só e-mail, sem cupom, sem
  badge de contagem, sem WhatsApp. Escondido com CSS **e** trava em JS — CSS
  sozinho deixaria caminho por teclado e por query param (§5).
- **Três desvios do brief**, todos por premissa do brief que não se sustentou
  no repo real (§7).
- **Dois bugs do fornecedor** encontrados e corrigidos, ambos com dano real:
  um fazia o comprador pagar pelo produto errado (§8.1).
- **`/docs/` era público** e servia o handover do fornecedor — um mapa do que
  não está construído. Fechado com 404 forçado, commit `6264441` (§9).
- **Zero console error** nas 18 páginas, fluxo completo navegável.
- **Gasto: zero.** Nada de pagamento, nada de Supabase escrito, nada de Lapak.
- **Rollback testado de verdade**, não só escrito. O comando óbvio conflita;
  a sequência que funciona está em §11.

---

## 1. O que mudou

```
app/                        NOVO — 18 páginas + shared/ (data + store.js)
app/shared/js/market.js     NOVO — resolução de mercado (não consumida ainda)
br/index.html               REMOVIDO — a SPA antiga; histórico fica no git
br/_gate.html               INTOCADO
netlify/edge-functions/     INTOCADO
_redirects                  reescrito: /app/ selado, 23 slugs 301, /br/ → /app/
netlify.toml                idem, mantido em sync
docs/frontend-v2-handover.md        movido de incoming/HANDOVER.md
docs/frontend-v2-landing-page.html  preservado (§7.1)
.gitignore                  NOVO — .DS_Store
```

O fornecedor entregou em `incoming/` (sem underscore, o brief dizia
`_incoming/`). Removido ao final.

---

## 2. A decisão central: `/app/`, não `/br/`

**O problema que ela resolve.** O brief tem uma restrição permanente: loja B2C
global, nada hardcoded como Brasil de forma que impeça MX, PH, NG depois. Se os
arquivos morassem em `/br/`, adicionar o México seria copiar 18 páginas para
`/mx/` e manter dois conjuntos em sync — o mesmo problema que o HANDOVER já
descreve para o header/footer duplicado em cada página, multiplicado por
mercado.

Com os arquivos em `/app/` e o mercado vindo do path da requisição, adicionar
mercado é uma regra de rewrite, não uma cópia. O `market.js` (§6) lê o primeiro
segmento do path — o browser continua vendo `/br/...`, porque rewrite do
Netlify não muda a URL.

**O que isso custou:** um problema novo, que virou §3.

---

## 3. `/app/` selado atrás do gate — o que não estava no brief

O gate é uma Edge Function cujo `config.path` é `["/br", "/br/*",
"/_gate/auth"]`. Ele gateia **o path da requisição**. Com os arquivos em
`/app/`, `recargagames.com/app/index.html` serviria a loja inteira sem passar
por senha nenhuma — e o objetivo declarado da fase é "atrás do gate".

O brief proibia mexer em `gate.ts`. A saída sem tocar nele:

```
/app/*  /br/:splat  301!
```

Forçada, porque regra não-forçada perde para arquivo que existe — e os arquivos
existem. Quem tenta `/app/` é jogado no path gateado.

**O risco que isso levantou, e como foi descartado.** Se o Netlify reaplicasse
as regras sobre o alvo de um rewrite, `/br/x` → `/app/x` → 301 → `/br/x` seria
loop infinito e o `/br/` inteiro morreria. Verificado no Deploy Preview antes
do merge: `curl -L /app/index.html` = 1 redirect, termina em 401. Rewrite
interno não reentra na cadeia de regras. Sem loop.

---

## 4. `/mx/` ficou comentado — decisão do owner

O brief mandava adicionar `/mx/* /app/:splat 200`. Mesma raiz do §3: o gate só
casa com `/br/*`, então a regra publicaria um protótipo com preços e login
falsos, sem senha e sem `robots.txt` no repo — indexável.

Levado ao Vinicius como A/B durante a sessão. Escolha: **regra comentada nos
dois arquivos**, com a nota de que ativar exige acrescentar `/mx` ao `path` do
`gate.ts`. Estrutura multi-mercado documentada, nada vazando.

Hoje `/mx/` devolve 404, igual a antes da sessão (a regra antiga apontava para
um `mx/index.html` que nunca existiu).

---

## 5. Esconder com CSS **e** com JS, não só CSS

O brief pedia "ocultar via CSS/flag, não removidos". CSS sozinho não basta e
vale registrar por quê:

| Item | Por que CSS sozinho falha |
|---|---|
| Métodos de pagamento | `.pay-opt` tem `tabindex="0"`; `display:none` tira do foco, mas o `checkout.html` **gera** as opções por JS a partir de `PAY_METHODS`, e `?method=card` na URL selecionaria cartão antes de qualquer CSS |
| Entrega por WhatsApp | `setDeliveryMethod('whatsapp')` esconde o campo de e-mail e o torna não-obrigatório. Precisa de trava na função, senão o critério "e-mail obrigatório em todos os produtos" depende de ninguém chamar a função |
| Cupom | O desconto flui para o objeto da order (`couponCode`, `discountAmount`). Esconder o campo sem neutralizar `applyCouponDiscount()` deixaria o desconto aplicável |

Solução: um objeto `PHASE0` por página com a allowlist, mais a regra de CSS
irmã. Cada bloco de CSS aponta para o `PHASE0` correspondente e vice-versa, com
o comentário dizendo o que reabre o item.

```js
const PHASE0 = {
  allowedPayMethods: ['pix'],   // PagBrasil ainda não integrado
  emailOnlyDelivery: true,      // sem número de WhatsApp real
  couponsEnabled: false         // validação de cupom só existe client-side
};
```

**O badge "+N recargas hoje" foi tratado diferente:** o brief mandou remover a
chamada a `getTodayOrderCount`, não escondê-la. Correto — o próprio código do
fornecedor tem um comentário marcando estatística fabricada como risco CDC. Uma
flag deixaria um caminho para o número voltar; a remoção não.

**Os chips `wa.me` também foram removidos, não escondidos.** Os números eram
`55XXXXXXXXXXX` e `5500000000000`. Não há o que reabrir — quando existir número
real, é markup novo.

---

## 6. `market.js` — estrutura sem comportamento

`window.RecargaMarket` com `{country, locale, currency}`, resolvido por
hostname (mapa vazio) → primeiro segmento do path → fallback `br`.

**Nenhuma página consome isso.** É deliberado e está escrito no topo do
arquivo: o catálogo, os preços e a copy continuam pt-BR/BRL fixos vindos de
`shared/data/`. Trocar o valor resolvido hoje não muda nada na tela. Quem for
ligar i18n na Fase 1 começa por aqui em vez de espalhar `if (country === 'BR')`.

Carregado antes de `store.js` nas 7 páginas que usam a camada `shared/`, e no
`<head>` das 10 estáticas (a Fase 1 vai precisar do mercado nelas também).
`campaign.html` ficou de fora — virou stub de redirect e não usa `shared/`.

---

## 7. Os três desvios do brief

Todos pela mesma razão: uma premissa do brief não se confirmou no repo real.

### 7.1 `Landing Page.html` não era duplicata

O brief dizia "não mover `Landing Page.html` (fica fora, é duplicata da landing
da raiz)" e mandava remover `incoming/` ao final — o que apagaria o arquivo.

Conferido antes de apagar: a landing da raiz é um placeholder "Em breve" de
12KB; o arquivo do fornecedor é uma landing de waitlist completa de 31KB, com
título e estrutura próprios. O HANDOVER a descreve como campaign asset separado,
deliberadamente fora do nav.

Como `incoming/` nunca foi commitado, apagar seria perda definitiva sem
histórico. Preservado em `docs/frontend-v2-landing-page.html`.

### 7.2 `gratis.recargagames.com` não tem DNS

O brief mandava trocar o `campaign.html` por redirect (meta refresh + link)
para esse subdomínio. `dig +short gratis.recargagames.com` não retorna nada.

Um meta refresh de 0s levaria o "Ganhe créditos" das outras 18 páginas direto
para um erro de navegador, sem caminho de volta — o oposto da regra de não
mostrar coisa que não existe. Implementado com **2s** e um interstitial com dois
links visíveis (ir agora / voltar para a loja). Baixar para 0s é uma linha
quando o subdomínio subir.

### 7.3 Dois bugs do fornecedor corrigidos no caminho

Não estavam no brief como tarefa, mas os critérios de pronto os expunham
("sem console error", "produto não encontrado com `?id=` inválido"). Detalhados
em §8.

**Um quarto item, menor:** o toggle "Status do pedido por WhatsApp" no
`account-profile.html` também foi escondido. O brief escopou a seção de
esconder para `product.html` e `checkout.html`, mas o critério de pronto diz
"nenhuma opção de WhatsApp" sem qualificar página — e é o mesmo canal
inexistente. Reverter é apagar uma regra de CSS.

---

## 8. Bugs

### 8.1 `product.html` vendia o produto errado com `?id=` inválido

**Causa raiz.** Fallback incondicional:

```js
const activeProduct = RecargaStore.getProductById(RecargaStore.getParam('id')) ||
                       RecargaStore.getProductById('free-fire');
```

Qualquer `?id=` que não resolvesse — link velho, typo, produto tirado do
catálogo — carregava Free Fire silenciosamente, **com o título e o preço do
Free Fire**. O comprador que clicasse num link antigo pagaria por outra coisa
sem nenhum sinal de que houve troca.

**Fix.** Separar "sem id" de "id inválido". Sem `?id=`, o fallback continua (é
o comportamento original e nenhum link do site chega assim). Com `?id=` que não
resolve, estado vazio "Produto não encontrado" com link para o catálogo,
espelhando o que o `order-details.html` já fazia para pedido inexistente.

**Severidade:** seria alta em produção com pagamento real. Nesta fase, zero —
não há pagamento.

### 8.2 `account-profile.html` quebrava em todo login real

**Causa raiz.** `RecargaStore.login()` grava só `{name, email, memberSince}`.
Os toggles de notificação liam `user.notifications[key]` direto:

```js
sw.classList.toggle('on', !!user.notifications[key]);
```

O `MOCK_USER` do arquivo **tem** o objeto `notifications`; um usuário real não.
`TypeError: Cannot read properties of undefined (reading 'orderEmail')` em
qualquer visita ao perfil depois de qualquer login — e o erro matava o resto do
script da página.

**Por que passou batido no fornecedor:** o HANDOVER registra o bug de
persistência desses mesmos toggles como "**Fixed**". O fix foi real, mas foi
testado no caminho do `MOCK_USER` (sem `RecargaStore`), que é o único onde o
objeto existe.

**Fix.** Default explícito logo após resolver o usuário, com comentário
apontando a origem.

### 8.3 Bug meu, pego na validação

Ao substituir o bloco do badge de contagem, deixei texto fora do comentário
`/* */`, produzindo `SyntaxError: Unexpected number` que matava o script inteiro
do `product.html`. Pego no primeiro `read_console_messages`, não por leitura do
diff. Vale o registro: **num arquivo de 2.400 linhas com todo o JS inline, o
console é o linter.**

---

## 9. `/docs/` era público

Descoberto ao confirmar o deploy de produção: `curl /docs/frontend-v2-handover.md`
devolvia **200**.

O publish directory é a raiz do repo, então tudo em `docs/` sempre foi servido.
O `docs/incidents/2026-04-hero-nav-fix.md` já era público antes desta sessão —
o padrão é anterior ao PR. Mas o handover do fornecedor é qualitativamente pior
de expor: é um documento franco listando **exatamente o que não está
construído** — "No real auth anywhere", passwords nunca verificadas, números de
suporte placeholder, `completeOffer()` sem verificação nenhuma, e o arquivo onde
os cupons válidos estão legíveis.

Não é vazamento de secret. É um mapa, num URL adivinhável, de onde bater.

**Fix.** Commit `6264441`, direto na `main`:

```
/docs/*  /404.html  404!
```

Forçada pelo mesmo motivo do `/app/*`: os arquivos existem e venceriam uma
regra não-forçada. Confirmado em produção — os três arquivos de `docs/` e o
próprio diretório devolvem 404, e `/br/`, `/br/_gate.html`, `/app/*` e a raiz
seguem como estavam.

**Pendência:** `/404.html` não existe na raiz do repo (só `app/404.html`, que
está atrás do gate). O status é 404 de qualquer forma, mas o corpo é o padrão
do Netlify, não uma página nossa. Ver §12.

**Efeito colateral bom:** este log está em `docs/` e portanto não é público.

---

## 10. Validação

**Local** (`python3 -m http.server`, 18 páginas):

- Fluxo completo: catálogo → produto → compra simulada → detalhes do pedido →
  meus pedidos → login → perfil. Compra real do protótipo executada
  (`RG-75921`, Steam, gift card), código de resgate gerado, pedido aparecendo
  na lista.
- **Zero console error** nas 18 páginas depois dos fixes de §8.
- Auditoria de links internos: nenhum `href`/`src` apontando para arquivo
  inexistente.
- Estado escondido conferido por DOM, não por leitura de código:
  `payVisiveis: ["pix"]`, cupom oculto, picker de entrega oculto, campo de
  telefone oculto, e-mail obrigatório, badge oculto, zero links `wa.me`.
- `checkout.html?method=card` seleciona **Pix** — a trava do §5 funcionando.
- `product.html?id=nao-existe` → "Produto não encontrado" com link para o
  catálogo.

**Deploy Preview** (antes do merge):

| Rota | Resultado |
|---|---|
| `/br/` | 401 + `<title>Acesso restrito · Recarga Games</title>` |
| `/br/_gate.html` | 200 — arquivo servido direto, `fetch` interno do gate funciona |
| `/app/index.html` | 301 → `/br/index.html` → 401, **1 redirect, sem loop** |
| `/app/shared/js/market.js` | idem — `/app/` inteiro selado |
| `/mx/` | 404 |
| Netlify | 52 regras processadas, nenhuma rejeitada |

**Produção** (depois do merge): mesmo comportamento, confirmado com artefatos
que só existem no commit novo.

**O que NÃO foi verificado:** o fluxo depois de passar pelo gate. Requer digitar
a senha, e o assistente não digita senhas. Fica em §12 como item do Vinicius.

**Ordem observada:** o gate roda **antes** dos redirects. `/br/free-fire/`
devolve 401, não 301 — os 301 só disparam com o cookie válido. Isso é o
desejado (nenhum redirect vaza a existência de rota antes da senha), mas
significa que os 301 não foram provados de ponta a ponta.

---

## 11. Rollback — testado, não só escrito

O comando óbvio **conflita**:

```bash
git revert -m 1 481f3f9     # CONFLICT em _redirects e netlify.toml
```

Motivo: o commit `6264441` (§9) veio depois do merge e mexeu nos dois mesmos
arquivos. O `app/`, o `br/` e o `docs/` revertem limpos; só os dois arquivos de
redirect conflitam.

**Sequência que funciona** (testada numa branch descartável nesta sessão —
`_redirects` voltou ao original de 2 linhas, `br/index.html` restaurado, `app/`
removido, working tree limpa):

```bash
git revert --no-edit 6264441      # desfaz o bloqueio do /docs/ primeiro
git revert -m 1 --no-edit 481f3f9 # depois o merge do PR #2
git push
```

**Alternativa sem git:** publicar o deploy anterior pela UI do Netlify
(`gleeful-entremet-47b89b` → Deploys → Publish deploy). Mais rápido e não mexe
no histórico; use se o site estiver quebrado e o diagnóstico puder esperar.

**Nota:** reverter só o `6264441` é seguro e independente — devolve o `/docs/`
para público sem tocar no frontend.

---

## 12. Próximos passos

**🔴 Alta**

- **Conferir o fluxo pós-gate em produção.** Único critério de pronto ainda não
  provado. Entrar em `recargagames.com/br/` com a senha e verificar: o
  `index.html` novo carrega; `/br/free-fire/` cai em
  `/br/product.html?id=free-fire`; `/br/lords-mobile/` cai no catálogo.
- **As caixas laranja tracejadas "Para quem for finalizar esta página"** seguem
  visíveis nas 8 páginas estáticas (`about`, `contact`, `faq`, `help-center`,
  `terms`, `privacy-policy`, `cookie-policy`, `refund-policy`). São notas do
  fornecedor para quem for escrever o conteúdo. **Bloqueiam a remoção do gate.**
- **`terms.html` é bloqueador de lançamento**, não polish: o checkbox de cadastro
  é obrigatório e aponta para lá. Hoje a página é esqueleto.

**🟡 Média**

- **Criar um `404.html` na raiz.** A regra do `/docs/*` já aponta para ele; hoje
  o corpo é o padrão do Netlify. Criar o arquivo faz a regra passar a servi-lo
  sem mudança nenhuma. Vale também para qualquer 404 de raiz.
- **Número de WhatsApp real.** Quando existir, os chips voltam como markup novo
  (`product.html`, `index.html`), o toggle do perfil sai do
  `.phase0-hidden`, e a entrega por WhatsApp reabre virando
  `PHASE0.emailOnlyDelivery` para `false`.
- **DNS de `gratis.recargagames.com`.** Enquanto não existir, "Ganhe créditos"
  é um beco sem saída em 18 páginas. Quando subir, baixar o refresh de 2s para
  0s no `campaign.html`.
- **`robots.txt` não existe no repo.** Não é urgente enquanto tudo está atrás do
  gate, mas vira urgente no minuto em que `/mx/` for ativado ou o gate sair.

**🟢 Baixa**

- **Ativar `/mx/` (Fase 1):** descomentar as duas regras nos **dois** arquivos
  **e** acrescentar `/mx` e `/mx/*` ao `path` do `gate.ts`. As duas coisas, ou
  o México nasce sem senha.
- **`market.js` continua sem consumidor.** Ligar na Fase 1 junto com i18n.
- **Header/footer duplicados em 18 páginas** (achado do HANDOVER, não desta
  sessão): mudar o nav hoje é editar 18 arquivos à mão. Sem build step, a saída
  seria um include em JS — decisão para quando doer.

---

## 13. Aprendizagens

- **"Atrás do gate" é uma propriedade do path, não do repo.** Mover arquivos
  para uma pasta nova moveu o conteúdo para fora do alcance do `gate.ts` sem
  que nada no `gate.ts` mudasse. Toda vez que uma pasta servida nascer, a
  pergunta é: qual regra a protege? Foi assim com `/app/`, com `/mx/` e — pego
  por acidente — com `/docs/`, que estava aberto desde sempre.
- **Shadowing do Netlify é o que segura o gate.** Regra não-forçada perde para
  arquivo que existe. É por isso que `/br/_gate.html` sobrevive ao
  `/br/* → /app/:splat`. Consequência prática: **nunca** pôr `!` nas regras de
  `/br/*`. Está escrito no cabeçalho do `_redirects` para a próxima pessoa.
- **Esconder no CSS é metade do trabalho** quando o HTML é gerado por JS ou
  quando a URL pode escolher o estado. `?method=card` teria furado o "só Pix".
- **O HANDOVER do fornecedor é bom e ainda assim incompleto** — ele mesmo
  documenta o bug §8.2 como corrigido. Um fix testado só no caminho do mock não
  é um fix. Ler o handover **e** rodar as páginas.
- **Premissa de brief é hipótese, não fato.** Três das instruções ("é
  duplicata", "redireciona para gratis.", "adicione `/mx/`") assumiam um estado
  do mundo que o `ls`, o `dig` e o `gate.ts` desmentiram. Custou três
  verificações de um minuto cada.
- **Testar o rollback muda o rollback.** O comando que eu teria documentado por
  dedução conflita. Rodar numa branch descartável custou dois minutos e é a
  diferença entre um runbook e um palpite.

---

## Referência

| Item | Valor |
|---|---|
| Repo | `admin-pv/recargagames-frontend` |
| Branch de trabalho | `feat/frontend-v2` (deletada no merge) |
| PR | #2 — "feat: frontend v2 (Fase 0, atrás do gate)" |
| Commit da feature | `43c34de` |
| Commit do `.gitignore` | `bfb5b1a` |
| Merge na `main` | `481f3f9` — 2026-09-10 22:04 UTC |
| Bloqueio do `/docs/` | `6264441` |
| Site Netlify | `gleeful-entremet-47b89b` → `recargagames.com` |
| Deploy Preview | `deploy-preview-2--gleeful-entremet-47b89b.netlify.app` |
| Publish directory | raiz do repo |
| Gate | `netlify/edge-functions/gate.ts` — **intocado nesta sessão** |
| Path do gate | `/br`, `/br/*`, `/_gate/auth` (exclui `/br/_gate.html`) |
| Página do gate | `br/_gate.html` — caminho físico não pode mudar |
| Catálogo do frontend v2 | `app/shared/data/products.js` — 22 produtos, estático |
| Slugs do `/br/` antigo | 23, tabela `games` do Supabase |
| Cruzamento de slugs | 13 exatos + 3 mapeados à mão + 7 sem equivalente |
| Regras de redirect | 26 por arquivo, 52 processadas pelo Netlify |
| Preview local | `python3 -m http.server`, abrir `/app/index.html` |

**Mapeamentos manuais de slug** (mesmo produto, id diferente):
`nintendo-e-shop` → `nintendo-eshop`, `steam-voucher` → `steam`,
`zenless-zone-zero` → `zzz`.

**Sem equivalente no catálogo novo** (→ `/br/index.html` 301): `arena-of-valor`,
`bigo-live`, `conquer-online-mobile`, `conquer-online-pc`, `delta-force`,
`farlight84`, `lords-mobile`.

**Secrets:** nenhum nesta sessão. A publishable key do Supabase foi usada para
listar os slugs da tabela `games`; é pública por design (está no HTML, RLS é o
que protege) e **não está reproduzida neste log**. A senha do gate não foi
digitada nem lida — é o motivo pelo qual o fluxo pós-gate ficou em §12.
