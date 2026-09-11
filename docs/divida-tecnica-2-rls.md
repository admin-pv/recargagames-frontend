# Dívida técnica #2 — RLS permissiva nas tabelas de conteúdo

**Status:** aberta. **Onde se resolve:** repo do admin
(`admin-pv/recargagames-admin`), sessão própria. **Bloqueia:** Fase 4
(abertura do site ao público).

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

## Pré-requisito da Fase 4

Abrir o site ao público sem resolver isto significa: qualquer visitante com
o DevTools aberto pega a publishable key do HTML e escreve em `banners` e
`site_content`. Hoje o gate é o que segura — e o gate sai na Fase 4.

**Checklist antes de tirar o gate:**

- [ ] Dívida #1 fechada: admin autentica como `authenticated`
- [ ] Policies de escrita de `banners`, `featured_games`, `site_content` e
      catálogo migradas para `is_admin()`
- [ ] Policies de leitura revisadas tabela a tabela (o que é público de
      fato continua `anon`; o resto fecha)
- [ ] `robots.txt` trocado (hoje é `Disallow: /`, ver raiz do repo)
- [ ] Caixas laranja "Para quem for finalizar esta página" removidas das 8
      páginas estáticas
