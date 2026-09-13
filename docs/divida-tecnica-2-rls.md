# Dívida técnica #2 — RLS permissiva nas tabelas de conteúdo

**Status:** aberta. **Onde se resolve:** repo do admin
(`admin-pv/recargagames-admin`), sessão própria. **Bloqueia:** Fase 4
(abertura do site ao público).

---

## 🔴 Achado de 11/09 — caminho de auto-promoção a admin

Encontrado na introspecção que antecedeu a migration da Fase 1. **Não é
uma dívida genérica de RLS: é um caminho de escalação de privilégio com
nome e sobrenome.**

### O mecanismo

Duas peças que, sozinhas, parecem razoáveis:

1. As quatro policies de escrita `admin write games`, `admin write
   banners`, `admin write game_packages` e `admin write site_content`
   decidem quem é admin assim:

   ```sql
   EXISTS (SELECT 1 FROM profiles
            WHERE id = auth.uid() AND user_type = 'admin')
   ```

2. A policy `profiles_update_own` permite ao usuário editar **a própria
   linha em `profiles`, sem restrição de coluna**.

Juntas: quem tem linha em `profiles` faz `UPDATE profiles SET user_type =
'admin' WHERE id = auth.uid()` e passa a escrever nas quatro tabelas —
catálogo, banners, pacotes e a copy do site.

O default da coluna é `'regular'`, o que impede que alguém nasça admin.
Não impede que se promova depois.

### Por que a Fase 1 não piora nada

- **`auth.users` não tem nenhum trigger** (confirmado no pré-voo de
  11/09). Cadastrar-se na loja **não cria linha em `profiles`**.
- `profiles` não tem policy de `INSERT` para `authenticated`, então o
  cliente também não consegue criar a própria linha.
- O trigger novo da Fase 1 escreve **só** em `customer_profiles`, e nunca
  toca `user_type`.

Ou seja: o cliente do storefront não tem a linha que a escalação exige, e
não tem como obtê-la. **A superfície é exatamente quem já tem linha em
`profiles` hoje — e continua sendo.** A Fase 1 não abre porta nova.

Vale dizer o que isso NÃO significa: a porta existente continua aberta.
Ela só não foi alargada.

### O conserto (repo do admin)

Trocar as quatro policies por `is_admin()`, que é a função que o resto do
banco já usa (`bonus_vouchers`, todas as `pv_*`) e que lê de
`admin_users` — uma tabela que o usuário **não** edita:

```sql
-- Para cada uma das 4:
ALTER POLICY "admin write games" ON public.games
  USING (is_admin()) WITH CHECK (is_admin());
```

Isso alinha as quatro com o padrão do resto do banco e corta a ligação
entre "uma coluna que o usuário edita" e "quem é admin".

Complemento recomendado, para fechar a classe do problema e não só a
instância: restringir `profiles_update_own` por coluna, com
`GRANT UPDATE (col, col, …)`, do mesmo jeito que a migration 0002 fez em
`customer_profiles`. Uma policy controla QUAIS LINHAS; ela não diz nada
sobre QUAIS COLUNAS, e foi essa lacuna que criou o caminho.

---

## O que é

As tabelas de conteúdo do storefront — `banners`, `featured_games`,
`site_content` e as de catálogo (`games`, `product_groups`,
`product_group_skus`, `price_benchmarks`) — têm policy de leitura
`USING (true)`. Qualquer um com a publishable key lê tudo.

Para leitura de conteúdo público isso é, em boa parte, o desenho: banner e
nome de jogo são para aparecer. O problema é o outro lado — **essas mesmas
tabelas precisam ser escritas pelo admin, e o admin escreve com a anon key
via `fetch` cru**, não como `authenticated`. Apertar a policy de escrita
hoje quebra o painel.

## Por que não se resolve neste repo

O storefront (este repo) só lê. Quem escreve é o painel, em
`admin-pv/recargagames-admin`. A correção é uma sequência que tem que
acontecer *lá*, nesta ordem:

1. O admin passa a autenticar de verdade (hoje é SHA-256 client-side —
   **dívida #1**, ainda aberta) e a falar com o Supabase como
   `authenticated`, não como `anon`.
2. Só então as policies de escrita dessas tabelas podem virar
   `USING (is_admin()) WITH CHECK (is_admin())`, o mesmo padrão que
   `bonus_vouchers` e as `pv_*` já usam.
3. As policies de **leitura** podem continuar abertas para `anon` no que
   for de fato público (banner, nome de jogo, preço) — mas isso vira uma
   decisão explícita por tabela, não o default atual.

Ou seja: **a dívida #2 depende da #1.** Apertar RLS antes de trocar a auth
do admin derruba o painel.

## O que a Fase 1 fez e não fez

A Fase 1 (auth de cliente) cria o perfil do cliente com RLS restritiva
desde o primeiro dia — `auth.uid()` na policy, nenhuma policy para `anon`,
INSERT só por trigger. **Não toca em nenhuma das tabelas acima.**

O storefront continua lendo catálogo e conteúdo com a publishable key e
`USING (true)`, exatamente como antes. A auth de cliente e a RLS de
conteúdo são problemas separados, e misturá-los nesta fase acoplaria o
login do cliente ao conserto do painel.

## `orders` — Fase 2 (13/09)

A migration `0003_storefront_orders.sql` fecha `orders` para o browser:
`REVOKE ALL` de `anon` e `authenticated`, `SELECT` só por coluna (lista
positiva) para `authenticated`, policy `orders_select_own`
(`user_id = auth.uid() AND channel = 'storefront'`) e nenhuma policy de
escrita. Escrita só pelas Netlify Functions, com a secret key.

### 🔴 Achado do bloco 0 (13/09): `orders` com privilégio total para anon/authenticated

Saída de `docs/fase2-bloco0.sql`:

- **0c:** `anon` e `authenticated` tinham **todos** os privilégios de
  tabela em `orders`: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`,
  `REFERENCES`, `TRIGGER`.
- **0d:** os dois papéis tinham também `INSERT`/`SELECT`/`UPDATE`/`REFERENCES`
  nas 19 colunas.
- **0a/0b:** RLS ligada, com 3 policies, todas para `authenticated` e
  nenhuma com `true`: `orders_admin_read_all` (SELECT `is_admin()`),
  `orders_admin_write` (ALL `is_admin()`) e `orders_read_own` (SELECT
  `auth.uid() = user_id`).

**Leitura:** o que impedia um visitante com a publishable key de
escrever ou apagar pedidos era **só a RLS**. Não houve exposição, porque
nenhuma policy abria para anon e as de escrita exigem `is_admin()`. Mas
era uma tranca só: uma policy permissiva criada por engano, em qualquer
repo, abriria `orders` na hora. É a mesma classe de problema do achado de
11/09 em `profiles`.

**Remediação:** a própria 0003 (decisão do Vinicius). `REVOKE ALL` de
`anon` e `authenticated`, `SELECT` por coluna em lista positiva e troca
de `orders_read_own` por `orders_select_own` com filtro de canal.

**Achado junto (P4):** `orders.user_id` tinha FK para `profiles(id)` (a
identidade do admin) com `ON DELETE CASCADE`. A 0003 troca para
`auth.users(id) ON DELETE SET NULL`; o porquê está na migration.

**Vale conferir nas outras tabelas:** se `orders` herdou o GRANT amplo
padrão do Supabase, as outras tabelas de `public` criadas fora das
migrations deste repo provavelmente também têm. Rodar o 0c por tabela
faz parte da revisão tabela a tabela do checklist abaixo.

### Efeito colateral aceito: aba Pedidos do admin passa a dar 401

O painel lê `orders` com a chave **anon** via `fetch` cru
(`loadPedidos()` em `recargagames-admin/index.html`). Desde a migration
0001 do proxy, `orders` já tem RLS ligada sem policy, então a aba já
volta vazia. Depois do `REVOKE` da 0003, passa a mostrar erro 401.
Nenhum dado se perde, porque ela já não via nada. Aceito pelo Vinicius
em 13/09.

**Conserto é no repo do admin**, e depende da dívida #1: o admin
autentica como `authenticated`, e uma policy de leitura
`USING (is_admin())` abre `orders` para ele.

## Pré-requisito da Fase 4

Abrir o site ao público sem resolver isto significa: qualquer visitante com
o DevTools aberto pega a publishable key do HTML e escreve em `banners` e
`site_content`. Hoje o gate é o que segura — e o gate sai na Fase 4.

**Checklist antes de tirar o gate:**

- [ ] 🔴 **As 4 policies `admin write *` trocadas por `is_admin()`** (ver o
      achado de 11/09 no topo). Este é o item mais urgente da lista e o
      único que não depende da dívida #1 para ser feito.
- [ ] `profiles_update_own` restrita por coluna
- [ ] Dívida #1 fechada: admin autentica como `authenticated`
- [ ] Policies de escrita de `banners`, `featured_games`, `site_content` e
      catálogo migradas para `is_admin()`
- [ ] Policies de leitura revisadas tabela a tabela (o que é público de
      fato continua `anon`; o resto fecha)
- [ ] **Repo do admin:** aba Pedidos lendo `orders` como `authenticated`
      com policy `is_admin()` (hoje 401 depois da 0003, ver seção
      `orders` acima)
- [ ] 🔴 **Repo do admin: publicar SKU falha com 42501 desde julho.**
      Diagnóstico de 13/09 (Claude web): `price_benchmarks` tem a policy
      `admin_write` (ALL, `is_admin()`), que está correta, e o usuário do
      admin está em `admin_users`. Mas as 52 linhas publicadas são todas
      de **13/04**, anteriores ao fechamento das policies em julho. A tela
      de Catálogo ainda escreve com `fetch` cru usando a chave **anon, sem
      sessão**, então `is_admin()` é falso e a escrita é negada.
      **Conserto:** trocar o `fetch` cru por `sb.from('price_benchmarks')`
      com a sessão do admin logado. Consequência: nada foi publicado ou
      despublicado desde julho, e o catálogo reflete o estado de abril.
      Em 13/09 um SKU de Free Fire entrou por SQL para destravar o C3 da
      Fase 2 (`notes` da linha diz isso).
- [ ] **Repo do admin:** tela de jogo com campo "categoria Lapak"
      (dropdown do `/category`) gravando `games.category_code`. Em 13/09,
      3 jogos foram corrigidos por SQL (`AB`, `AOV`, `UCPUBGMGLOBAL`) e 20
      seguem NULL, logo fora da loja. Não é RLS, mas é a mesma superfície:
      hoje o único jeito de corrigir é SQL direto em produção. Ver
      `docs/modelo-catalogo-e-fulfillment.md`, seção 2.
- [ ] `robots.txt` trocado (hoje é `Disallow: /`, ver raiz do repo)
- [ ] Caixas laranja "Para quem for finalizar esta página" removidas das 8
      páginas estáticas
