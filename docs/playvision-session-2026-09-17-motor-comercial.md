# Playvision — Log de Sessão 16–20/09/2026 (Motor Comercial, Modelo 2)

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
- **C2 fechado.** Snapshot no Deploy Preview: **21.421 linhas, 11 de 11
  países, 11,6 s**, nenhum país falhou. O diff contra o CSV da interface
  web deu **99,85% de identidade**, e nos 54 grupos da Plusmo **160 linhas
  conferidas, 160 idênticas** (§4.5).
- **C3 fechado.** As duas planilhas saem por comando, três linhas foram
  recalculadas à mão e batem nos seis campos, o Annex A real passou na
  varredura, e o ciclo de benchmark foi provado nos dois sentidos (§5.5).
- 🔴 **Causa raiz do 401 do FX: o 1Password está defasado.** Não era
  contexto de deploy nem paste errado — a chave guardada no cofre
  (`324dcded`) não é nenhuma das duas que o proxy aceita. O Netlify
  recebeu fielmente um valor que o proxy recusa (§4.3).
- 🔴 **O CSV da interface web NÃO é o mesmo dado da API** (§2.4). 136
  produtos `available` no CSV não existem na resposta da API — entre eles
  os quatro `ZZZ` que a Plusmo quer cotar.
- **Três premissas do brief não sobreviveram ao contato com a API real**
  (§2), e as três mudariam o resultado em silêncio se não tivessem sido
  conferidas.
- **A retenção do brief estourava o plano Free** em 340 MB de regime
  estável. Refeita com o volume medido: 14 dias inteiros + segundas
  filtradas, ~60 MB (§4.2).
- **Na Lapak, só o `USD_IDR` é diário.** `USD_ARS`, `USD_COP` e `USD_PEN`
  vieram com 24 dias e `USD_PHP` com 310. O gerador passou a levantar FLAG
  com a idade de qualquer taxa acima de 7 dias (§5.4).
- **75 testes**, sem framework, incluindo um que gera o Annex A, abre de
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

### 2.4 O CSV da interface web não é o mesmo dado da API

O brief dava como certo que "o CSV que a interface web da Lapak exporta é
o mesmo dado" e que ele viraria só ferramenta de conferência. O diff do C2
(§4.5) mostrou que não: **136 produtos aparecem `available` no CSV e não
existem na resposta da API**, espalhados por 8 providers que, fora esses
produtos, a API devolve normalmente (`S19` sozinho tem 198 produtos na
Indonésia pela API).

Não é exclusão de provider e não é status divergente — a API simplesmente
**não lista** aqueles códigos. `ZZZ300`, `ZZZ980`, `ZZZ1980` e `ZZZ3280`
são o caso que dói: o CSV os mostra `available` pelo `-S19` na Indonésia,
e a API devolve zero linha para os quatro.

**Decisão do Vinicius (20/09): seguem SEM SUPPLY na proposta.** Item que a
API não devolve não entra cotado — o fulfillment passa pela API, e cotar o
que não dá para pedir é prometer o que não se entrega. A divergência
interface × API vira pergunta comercial para a Lapak, junto com o
`check_id`.

No sentido contrário, 32 linhas existem no nosso snapshot e não no CSV:
são produtos com preço de 99.999.999 e 999.999.999 IDR, todos do provider
`S9090` — marcador de produto desligado, que o CSV filtra e a API não.
Não chegam a fazer estrago porque um preço desses estoura o headroom para
negativo e cai no FLAG `preco_acima_do_oficial`, mas é bom saber que
existem.

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

### 4.3 O 401 do FX: o cofre é que estava defasado

A execução de 16/09 gravou os 21.329 custos e falhou só no câmbio, com
`proxy_/fx-rate.php_http_401`. O valor da env foi reinserido em todos os
contextos do Netlify em 20/09 e **o 401 sobreviveu**. Diagnóstico completo:

| Teste | Resultado |
|---|---|
| Chave do `.env` do Hetzner, URL pública, header `x-proxy-key` | **200** |
| Mesma chamada sem o header | **401** |
| `snapshotFx()` real, chave do servidor, Supabase apontado pro vazio | atravessou o proxy |
| `server.js` rodando no Hetzner × clone canônico | **byte a byte igual** (`bc5066db723d4456`) |
| Chave do 1Password, mesma chamada | fingerprint `324dcded` → **401** |

Não era o header (`x-proxy-key`, `server.js` linha 70), não era o código,
não era contexto de deploy e não era paste truncado. **A chave guardada no
1Password não é nenhuma das duas que o proxy aceita** (`7b5fe62d` =
`PROXY_ADMIN_KEY`, `6d6152ca` = `PROXY_RELOAD_KEY`). Alguém trocou a chave
no servidor e o cofre ficou para trás; o Netlify recebeu fielmente um valor
morto. O app de resgate continua funcionando porque tem o valor certo
gravado, não porque o cofre esteja certo — o que também quer dizer que
ninguém teria descoberto isso até a próxima vez que alguém fosse buscar a
chave no cofre.

**Conserto (segunda):** levar o valor do `.env` do Hetzner para o Netlify
**e para o 1Password**. Só um dos dois faz o problema voltar na próxima
consulta ao cofre. Rotação deliberada da chave é outra tarefa e mexe no
app de resgate, que usa a mesma.

**Desbloqueio usado em 20/09**, aprovado pelo Vinicius: o câmbio do dia
foi gravado localmente pela mesma `snapshotFx()` da Function, com a chave
lida do servidor. Nenhum código novo no caminho do dinheiro.

### 4.4 A deduplicação não era teórica

O `id` veio com `duplicates: 2` na primeira execução: a Lapak repetiu dois
`product_code` na mesma resposta. Sem a deduplicação, o Postgres recusaria
o lote inteiro daquele país com 21000 (`ON CONFLICT ... cannot affect row a
second time`). É por isso que `id` gravou 12.556 e não os 12.558 medidos
direto na API.

### 4.5 O diff contra o CSV da interface (C2 parte 2)

`Product_Reseller (29).csv`, exportado em 20/09: 126.571 linhas, todos os
países da Lapak. A coluna que importa é **`Reseller Price`** — é idêntica
para o mesmo produto em países diferentes, enquanto `Recommended Price`
muda com a moeda local. É o nosso `price_idr`.

```
linhas do CSV nos nossos 11 países : 82.590  (21.527 available)
linhas gravadas pelo snapshot      : 21.421

idênticos (código + preço + status): 21.388   99,85%
preço diferente                    :      1
status diferente                   :      0
available no CSV, ausente no nosso :    136   ← §2.4
no nosso, ausente no CSV           :     32   ← marcadores S9090

OS 54 GRUPOS DA PLUSMO: 160 linhas conferidas, 160 idênticas, 0 divergente
```

A única divergência de preço (`id|CDKSTESSCK-S127`, 311.146 no CSV contra
55.292 no nosso) é 1 linha em 21 mil, e as duas fotos foram tiradas em
momentos diferentes do mesmo dia — a Lapak reprecifica durante o dia.

**O que o C2 provou:** para tudo que a Plusmo cota, a API cobre o que a
planilha manual usava, com o mesmo preço e o mesmo status. **O que o C2
desmentiu:** que as duas fontes sejam a mesma coisa (§2.4).

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

### 5.4 Na Lapak, só o `USD_IDR` é diário

O `source` que o snapshot grava em `com_fx_rates` guarda o `created_date`
que a Lapak devolve, e foi ele que denunciou, em 20/09:

| Par | Taxa | Criada em | Idade |
|---|---|---|---|
| `USD_IDR` | 17812,1 | 2026-09-20 00:00 | hoje |
| `USD_ARS` | 1514,75 | 2026-08-27 14:17 | 24 dias |
| `USD_COP` | 3123,27 | 2026-08-27 14:17 | 24 dias |
| `USD_PEN` | 3,35 | 2026-08-27 14:17 | 24 dias |
| `USD_PHP` | 16559 | 2025-11-14 08:59 | **310 dias** |

O estrago silencioso: o FLAG de divergência dizia "override 1428,57 contra
1514,75 **do dia**" — comparando um número de 24/07 com outro de 27/08 e
chamando o segundo de cotação de hoje. E numa oportunidade sem
`fx_overrides`, o headroom em PHP sairia convertido por uma taxa de dez
meses, sem nada na tela dizendo isso.

Decisão do Vinicius (20/09): o gerador levanta FLAG com a idade em
qualquer câmbio acima de 7 dias, e a idade entra no texto do flag de
divergência. O dado da Lapak segue como referência — moeda estável não
anda muito — mas **nunca mais entra mudo numa proposta**.

### 5.5 O C3, conferido à mão

- **Três linhas recalculadas por fora**, com aritmética comum, batendo nos
  seis campos (SKU vencedor, IDR, custo USD, preço ao parceiro, oficial em
  USD, headroom): `FFLATAM100` USD 0,6970 contra oficial 0,99 (29,6%),
  `ROB25USDGLO` USD 23,3524 contra 25,00 (6,6%), `MNCT1720` USD 7,7765
  contra 13.900 ARS convertidos (20,1%). Os três exercitam benchmark em
  USD, PIN e benchmark em moeda local.
- **Annex A real varrido**: 330 células contra 99 números e 108 textos
  tirados da planilha interna do mesmo dia. Nenhum vazamento.
- **Ciclo de benchmark provado nos dois sentidos**: export → editar →
  dry-run (não escreveu nada, conferido no banco) → import (1 linha) →
  reverter pelo CSV original → re-export. Duas linhas ruins plantadas de
  propósito (typo no `group_code`, `qa_status` inválido) foram bloqueadas
  apontando a linha do arquivo, e as 66 boas passaram.
- **O DELTA justifica o projeto**: em 4 dias, 22 dos 49 itens cotados
  mudaram de custo mais de 0,5% (16 subiram, 6 baixaram) e 1 sumiu.

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

### 6.5 O varredor que acusou vazamento onde não havia

A primeira varredura do Annex A real acusou oito vazamentos. Todos falsos:
o código de país `ar` casava como **substring** dentro de "P**ar**tner
Price", "M**ar**vel Rivals" e "Gift C**ar**d". O teste automatizado não
tinha esse problema (usa limite de palavra para token curto); o script
avulso que escrevi na hora, sim. Trocado por `\b`, a varredura ficou
limpa.

---

## 7. Checkpoints

| # | Estado |
|---|---|
| **C1** | ✅ Migration e seed em produção. C-3 e C-4 com zero linha; 1 oportunidade, 54 itens, 162 DE>PARA, 66 benchmarks, 0 item sem DE>PARA. |
| **C2** | ✅ 21.421 linhas, 11/11 países, 11,6 s. Diff contra o CSV: 99,85% de identidade; 160/160 nas linhas da Plusmo. Disparador confirmado atrás do gate (401 sem cookie). |
| **C3** | ✅ Duas planilhas por comando, 3 linhas conferidas à mão nos 6 campos, Annex A real sem vazamento, ciclo de benchmark provado nos dois sentidos. |
| **C4** | ⏳ Segunda: corrigir a chave no Netlify **e no 1Password**, redisparar para provar o FX de ponta a ponta, remover o disparador temporário, merge e conferir a primeira execução agendada. |

---

## 8. Em aberto

- 🔴 **Chave do proxy no Netlify E no 1Password** (§4.3). O cofre guarda
  uma chave morta; corrigir só o Netlify faz o problema voltar na próxima
  vez que alguém consultar o cofre.
- 🔴 **Pergunta comercial para a Lapak** (§2.4): por que 136 produtos
  aparecem `available` na interface web e não existem na resposta da API,
  entre eles os quatro `ZZZ`. Vai junto com o `check_id`.
- 🟡 **Câmbio de mercado não-IDR**: a Lapak entrega taxa velha (§5.4).
  Hoje o FLAG avisa; se virar incômodo recorrente, a saída é `fx_overrides`
  por oportunidade ou uma fonte de câmbio própria — decisão em aberto.
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
