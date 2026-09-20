# Playvision — Log de Sessão 16–17/09/2026 (Motor Comercial, Modelo 2)

**Foco:** transformar o pricing feito à mão na planilha Plusmo v5 num
comando. Custo do dia vindo da Lapak por snapshot, benchmarks e
elegibilidade em banco, e um gerador que produz a planilha interna e o
Annex A do parceiro.
**Modo:** MVP, com modo cuidado nos pontos marcados — custo de fornecedor e
margem são dado sensível, e as tabelas novas nascem fechadas para o browser.
**Repo:** `admin-pv/recargagames-frontend` · **Branch:** `feat/commercial-engine`
· **PR:** #5, rascunho (o disparador temporário ainda está dentro).
**Motivador:** a Lapak reprecifica todo dia em IDR. Sem custo do dia não há
proposta comercial, e a proposta é o que destrava cash-in.

> **Estrutura:** §1 é o que mudou. §2 o que a API real desmentiu do brief —
> é a parte que mais mexeu no desenho. §3 a migration e o seed. §4 o
> snapshot e a retenção. §5 o gerador e o Annex. §6 os erros desta sessão.
> §7 os checkpoints. §8 o que ficou em aberto.

---

## Resumo executivo

- **C1 fechado e em produção.** Seis tabelas `com_*`, RLS ligada, nenhuma
  policy, `REVOKE ALL` de `anon`/`authenticated`/`PUBLIC`. Conferência:
  C-3 e C-4 com zero linha. Seed da Plusmo aplicado: 1 oportunidade, 54
  itens, 162 linhas de DE>PARA, 66 benchmarks.
- **C2 parte 1 fechado.** Primeira execução real do snapshot no Deploy
  Preview: **21.329 linhas, 11 de 11 países, 14,6 s**, nenhum país falhou.
  O risco de timeout do C4 saiu do caminho crítico.
- 🔴 **O FX falhou com 401** — o valor de `PROXY_ADMIN_KEY` no contexto
  Deploy Preview diverge do que o proxy aceita. Diagnóstico em §4.3.
  Bloqueia o C3 até a env ser corrigida.
- **Três premissas do brief não sobreviveram ao contato com a API real**
  (§2), e as três mudariam o resultado em silêncio se não tivessem sido
  conferidas.
- **A retenção do brief estourava o plano Free** em 340 MB de regime
  estável. Refeita com o volume medido: 14 dias inteiros + segundas
  filtradas, ~60 MB (§4.2).
- **70 testes**, sem framework, incluindo um que gera o Annex A, abre de
  volta e varre célula por célula atrás de custo, margem, SKU e IDR.
- **Gasto: zero.** Nenhuma chamada de criação de pedido, nenhum serviço
  novo, nenhuma dependência no site (o `exceljs` vive só em `scripts/`).

---

## 1. O que mudou

```
supabase/migrations/0004_commercial_engine.sql   NOVO — aplicada 16/09 (C1)
docs/vendor/seed-comercial-plusmo.sql            NOVO — fora do git (dado comercial)
netlify/lib/supply.mjs                           NOVO — núcleo do snapshot
netlify/functions/supply-snapshot.mjs            NOVO — Scheduled, 07:00 UTC
netlify/functions/supply-snapshot-run.mjs        NOVO — TEMPORÁRIO, sai antes do merge
netlify.toml / _redirects / gate.ts              rota do disparador + schedule
scripts/lib/decimal.mjs                          NOVO — decimal exato em BigInt
scripts/lib/pricing.mjs                          NOVO — as 7 regras da v5, puras
scripts/lib/workbook.mjs                         NOVO — planilha interna e Annex A
scripts/lib/db.mjs / env.mjs / csv.mjs           NOVO — leitura, .env, CSV
scripts/lib/benchmark.mjs                        NOVO — validação e diff do CSV
scripts/opportunity-export.mjs                   NOVO — o comando da proposta
scripts/benchmark-import.mjs                     NOVO — export/dry-run/import
scripts/test/*                                   NOVO — 70 testes
.gitignore                                       .env, out/, node_modules/
```

---

## 2. O que a API real desmentiu do brief

As três foram conferidas ao vivo em 16/09, pelo proxy. Nenhuma daria erro:
todas produziriam número errado com cara de número certo.

### 2.1 A regex de `product_code` estava errada

O brief mandava extrair grupo e provider do código com `-S\d+`.
`/all-products` **já devolve `group_product_code` e `provider_code` como
campos próprios**, e a regex erraria **1218 dos 5042 produtos do BR**:
`S110AB2C`, `S11AUTO`, `S50A`, `S98M`, `S121M` não são só dígitos.

Os campos da API viraram a fonte; a regex ficou como fallback para código
órfão. E o fallback tem uma sutileza que custou um bug (§6.1): sem o flag
`i`, porque `ML40_4-S50A-sg` parte errado quando o sufixo de país minúsculo
casa como provider.

### 2.2 O par de câmbio é `USD→IDR`, não `IDR→USD`

`IDR→USD` responde `NOT_FOUND`. `USD→IDR` responde
`{buy_rate: 17663, sell_rate: 17663}`. Custo em dólar é `price_idr / rate`.

A Lapak também tem `USD→ARS`, `USD→PEN`, `USD→COP` e `USD→PHP`, e **não
tem** `BRL`, `MXN`, `SGD` nem `INR`. Por isso o mercado MX da Plusmo
continua dependendo do `fx_overrides` da oportunidade.

Quando `buy_rate` e `sell_rate` divergirem, fica o **menor**: divisor menor
= custo em dólar maior = proposta conservadora. Cotar caro se conserta numa
conversa; cotar barato come margem sem aparecer.

### 2.3 A lista de países não cobria o que a Plusmo cota

Teste de cobertura dos 54 grupos contra os 9 países originais: **42 com
supply, 12 sem**. Os 6 PUBG UC estavam em `sa` (o `-S113-sa` que o brief
suspeitava), e `VPUBGM60` e `XBOXUSD50` em `id`. Com `sa` e `id` na lista,
sobram só os 4 ZZZ, que o próprio seed já marca `BLOCKED` desde 17/08 —
não existem em nenhum dos 11 países.

`tw` e `hk` respondem `SUCCESS` com zero produto. `in` responde com 81
produtos e **zero** available.

---

## 3. Migration 0004 e o seed (C1)

### 3.1 As tabelas nascem fechadas

Lição da 0003 (achado P1): tabela nova no Supabase nasce com **todos** os
privilégios para `anon` e `authenticated`, e o que segura é só a RLS. Aqui
são duas trancas em cada uma das seis `com_*`: RLS ligada **sem nenhuma
policy** (nega tudo, inclusive leitura) e `REVOKE ALL`.

A migration **confere a si mesma** antes do `COMMIT`: privilégio de tabela,
privilégio de coluna, policy criada por engano e RLS desligada. Qualquer um
dos quatro dá `RAISE EXCEPTION` e desfaz tudo. `PUBLIC` entrou na conta
junto com `anon`/`authenticated` — privilégio dado a `PUBLIC` é herdado por
todo mundo e passaria por uma checagem que só olha os dois nomes.

### 3.2 Dois defeitos no seed, um deles silencioso

O seed veio com a planilha v5 e foi conferido contra a 0004 antes de rodar:

1. 🔴 `fulfillment` vinha `'Top-up'`/`'PIN'` contra um
   `CHECK (fulfillment IN ('topup','pin'))`. **Falharia alto** — o INSERT
   dos 54 itens inteiro. Resolvido com de-para por `CASE` na projeção, sem
   `ELSE`: modo desconhecido vira `NULL` e bate no `NOT NULL`.
2. 🔴 `fx_overrides` vinha `{"ARS_USD": 1428.57, ...}`. Os números estavam
   certos (1428,57 ARS por 1 USD); o **nome da chave** é que estava
   invertido. **Não falharia em nada**: passa no `CHECK`, roda, e o gerador
   divide pelo lado errado. Renomeado para `USD_ARS`/`USD_MXN`/`USD_PEN`, a
   convenção única do motor (`BASE_QUOTE`, valor = unidades de QUOTE por 1
   BASE), a mesma de `com_fx_rates`.

O segundo é o tipo de erro que esta sessão inteira tentou caçar: o que não
acende luz nenhuma.

O seed também ganhou asserções antes do `COMMIT` (1 oportunidade, 54 itens,
≥162 DE>PARA, ≥66 benchmarks, zero item sem DE>PARA) e conferência S-1 a
S-5. Ele vive em `docs/vendor/`, que está no `.gitignore`: termo comercial
de cliente não entra no git.

### 3.3 O FX defasado do seed

O `fx_overrides` da Plusmo é de 24/07 e **vence** o câmbio do dia por
desenho — taxa negociada é decisão, não cotação. Só que em 16/09 a Lapak
marcava `USD→ARS` 1514,75 contra os 1428,57 do seed: ~6% direto na margem
em ARS. O gerador levanta FLAG acima de 5%, e o cabeçalho do seed registra.

---

## 4. O snapshot diário

### 4.1 Grava só `status = available`

**Decisão registrada aqui porque muda o que dá para responder depois.**

Medido: 40.557 produtos/dia nos 9 países originais, dos quais 8.616
available; com `sa` e `id`, 21.329 available. Gravar tudo custaria ~7,7
MB/dia com índice — 30 dias já seriam ~230 MB de um banco Free de 500 MB
que ainda guarda a loja.

Não se perde nada do cálculo: a regra de custo é "menor preço entre
providers com status available", e **grupo sem nenhuma linha no dia É o
'SEM SUPPLY' da v5** — a ausência já é o sinal, e é ela que sustenta o
rastreio do que foi cotado. O que se perde é o histórico de "existia, mas
estava empty", que não entra em conta nenhuma. A coluna `status` continua
na tabela: se um dia valer a pena guardar `empty`, muda uma constante.

### 4.2 Retenção: a regra do brief estourava o plano

Com o volume real (21.329 linhas/dia, das quais o `id` sozinho é 12.556), a
regra "30 dias + segundas preservadas" chega a **340 MB** em regime estável
contra uma régua de 150 MB. O furo é a segunda preservada **para sempre**:
4,1 MB por semana que nunca saem, 213 MB só no primeiro ano.

E dos 54 grupos da Plusmo, o dia inteiro produz **165 linhas** — 0,8% do
volume. Estávamos guardando 21 mil linhas por dia para consultar 165.

Regra nova: **14 dias corridos inteiros + segundas guardadas por 12 meses
só com os grupos que estão em `com_sku_markets`** → ~60 MB de regime
estável, com o histórico longo exatamente onde importa.

A varredura da poda tem uma armadilha que só aparece em regime: andar pela
"data mais velha fora da janela" pulando as segundas faz a rotina
reencontrar as mesmas 52 segundas todo dia, gastar o orçamento de 10 datas
nelas e **nunca** chegar na data que acabou de vencer — a janela cresceria
para sempre, calada. A consulta pergunta pela data mais velha **que ainda
tem linha de grupo não rastreado**: a segunda já filtrada some sozinha do
resultado. Tem teste com 14 segundas guardadas provando.

Duas saídas de emergência apontam para guardar dado demais, nunca para
apagar: `com_sku_markets` vazia ou com mais de 400 grupos desliga a
filtragem e preserva a segunda **inteira**, com aviso no log.

### 4.3 🔴 O 401 do FX (aberto)

A execução de 16/09 gravou os 21.329 custos e falhou só no câmbio, com
`proxy_/fx-rate.php_http_401`. Diagnóstico em três degraus:

| Teste | Resultado |
|---|---|
| Chave do próprio servidor, URL pública, header `x-proxy-key` | **200** |
| Mesma chamada sem o header | **401** |
| `snapshotFx()` real, chave do servidor, Supabase apontado pro vazio | atravessou o proxy |

Não é código, não é o nome do header (`x-proxy-key`, `server.js` linha 70),
e não é ausência da env — se estivesse vazia, `snapshotEnv()` teria
devolvido `misconfigured` em 500 e nem os custos entrariam. **É o valor no
contexto Deploy Preview que diverge.** O Netlify permite valor por contexto.

Impressões digitais das duas chaves que o proxy aceita (sha256, 8 primeiros
caracteres): `7b5fe62d` (`PROXY_ADMIN_KEY`) e `6d6152ca`
(`PROXY_RELOAD_KEY`, mesmo escopo). Conferência sem expor a chave:
`pbpaste | tr -d '\n' | shasum -a 256 | cut -c1-8`.

O caminho é alinhar o Netlify ao proxy, não o contrário: mexer na chave do
proxy afeta o app de resgate, que também a usa.

### 4.4 A deduplicação não era teórica

O `id` veio com `duplicates: 2` na primeira execução: a Lapak repetiu dois
`product_code` na mesma resposta. Sem a deduplicação, o Postgres recusaria
o lote inteiro daquele país com 21000 (`ON CONFLICT ... cannot affect row a
second time`). É por isso que `id` gravou 12.556 e não os 12.558 medidos
direto na API.

---

## 5. O gerador e o Annex A

### 5.1 Dinheiro não passa por float

Todo valor é BigInt em escala fixa de 8 casas, e `toFixed()` é a única
porta de arredondamento, chamada só quando a célula é escrita. A cadeia
custo → markup → fee → headroom acumularia erro justamente nos números que
o parceiro confere na mão.

### 5.2 O Annex é lista positiva, e o teste prova

`ANNEX_COLUMNS` é a lista inteira do que existe no arquivo, e cada linha é
montada campo a campo a partir dela. Não existe "pega a linha interna e
apaga o que é sensível" — esse desenho falha **aberto** no dia em que
alguém acrescenta uma coluna à planilha interna.

O teste gera o arquivo, abre de volta e varre cada célula, cada nome de aba
e os metadados atrás de custo, margem, SKU de provider, `group_code` da
Lapak, nota interna de benchmark e a palavra IDR. Para não ser decorativo,
uma coluna `Our cost (USD)` foi injetada de propósito: **dois testes
independentes falharam** (vocabulário no cabeçalho e contagem de colunas).

### 5.3 Três regras que o brief deixava em aberto

1. **Empate de preço** → vence o `product_code` alfabeticamente menor.
   Duas execuções no mesmo dia precisam gerar planilha idêntica, senão o
   DELTA acusa variação que não existe.
2. **`sku_override` conflitante entre mercados** (a PK é grupo+mercado, mas
   o custo é um por item) → fica o **mais caro**, com FLAG.
3. **Override sem supply** → não cai de volta no mais barato. O operador
   escolheu aquele provider; trocar calado é decidir por ele. Vira BLOCKED
   com FLAG dizendo que foi o override.

---

## 6. Erros desta sessão

### 6.1 O flag `i` que partia o código no lugar errado

O fallback de `product_code` nasceu como `/^(.+)-(S[0-9A-Z]+)(?:-([a-z]{2}))?$/i`.
Com o flag, `ML40_4-S50A-sg` virava grupo `ML40_4-S50A` e provider `sg` — o
sufixo de país casava como provider (`s` + `g`). Código e provider da Lapak
são maiúsculos, sufixo de país é minúsculo; é o que separa os dois. Pego
rodando o parser contra os payloads reais antes do commit.

### 6.2 A segunda-feira que o freio de segurança apagava

Na primeira versão da poda nova, com a filtragem desligada, o `else`
apagava a segunda **inteira** — exatamente o dado que a regra existe para
guardar, e o oposto do que o comentário ao lado prometia. Apareceu ao
escrever o teste do caso "`com_sku_markets` vazia".

### 6.3 `new Response('', { status: 204 })`

O PostgREST de mentira dos testes de poda devolvia 204 com corpo vazio. No
Node isso estoura, e o erro chegava disfarçado de falha do prune: oito
testes vermelhos apontando para o lugar errado. 204 exige corpo `null`.

### 6.4 Contagem de itens publicada de cabeça

A conferência S-2 do seed saiu com "43 topup + 11 pin" num rascunho, número
que eu não tinha contado. São **36 topup + 18 pin**. Corrigido antes de o
arquivo ir para o SQL Editor.

---

## 7. Checkpoints

| # | Estado |
|---|---|
| **C1** | ✅ Migration e seed em produção. C-3 e C-4 com zero linha; 1 oportunidade, 54 itens, 162 DE>PARA, 66 benchmarks, 0 item sem DE>PARA. |
| **C2 parte 1** | ✅ 21.329 linhas, 11/11 países, 14,6 s, nenhum país falhou. Disparador confirmado atrás do gate (401 sem cookie). 🔴 FX em 401. |
| **C2 parte 2** | ⏳ Diff contra o CSV da interface web da Lapak e cobertura dos 54 grupos. |
| **C3** | ⏳ Bloqueado pelo FX: sem `USD_IDR` do dia o gerador se recusa a cotar. |
| **C4** | ⏳ Remover o disparador temporário, merge, conferir a execução agendada. |

---

## 8. Em aberto

- 🔴 **`PROXY_ADMIN_KEY` por contexto no Netlify** (§4.3). Trava o C3.
- 🔴 **Remover `supply-snapshot-run` antes do merge**: o arquivo, as duas
  rotas (`netlify.toml` e `_redirects`) e as duas entradas do `gate.ts`.
  Mesmo procedimento do `orders-expire-run` (commit `d3a3cf2`).
- 🟡 **Medir bytes/linha real** com `pg_total_relation_size` e refazer a
  projeção de retenção se destoar dos 204 B estimados.
- 🟡 **Benchmarks `COLLECT` e `VERIFY`** da Plusmo continuam pesquisa
  manual. O ciclo export → dry-run → import está pronto e testado.
- 🟢 **UI de oportunidades e benchmarks no admin**, depois da dívida #1.
- 🟢 **Alerta quando item cotado vira SEM SUPPLY** ou o custo passa do
  preço proposto — candidato para depois de observabilidade.

---

## 9. Rollback

Tudo é aditivo. Nenhuma tabela existente foi tocada; loja, admin e proxy
não dependem de nada aqui.

- **Function:** remover o bloco `[functions."supply-snapshot"]` do
  `netlify.toml` e fazer deploy. Para de rodar, nada mais muda.
- **Banco:** `DROP TABLE` das seis `com_*` na ordem inversa das FKs
  (`com_opportunity_items` antes de `com_opportunities`). O bloco pronto
  está no rodapé da própria 0004.
- **Scripts:** são locais, não são deployados e não têm efeito em produção
  além da leitura e do upsert de `com_benchmarks`.
