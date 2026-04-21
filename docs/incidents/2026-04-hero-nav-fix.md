# Fix: Hero carousel manual navigation — post-mortem

**Data:** 19–21 Abril 2026
**Severidade:** Baixa (auto-advance do carrossel continuou funcionando; só navegação manual quebrada)
**Tempo até resolver em produção:** ~2 dias (inclui descoberta do bug + saga de infraestrutura)

## Bug original

Em `br/index.html:421`, a função `heroNav(dir)` referenciava um identificador inexistente `otalSlides` (faltando o `t`):

```js
goSlide((currentSlide+dir+totalSlides)%otalSlides);  // typo
goSlide((currentSlide+dir+totalSlides)%totalSlides); // fix
```

Fix em produção: commit `c98ed15` na `main`, deployado via Netlify em 21/Abril 10:06 AM.

### Impacto

- Ao clicar nas setas prev/next do hero banner, `heroNav` lançava `ReferenceError: otalSlides is not defined`.
- O clique efetivamente "não fazia nada" — o banner não trocava.
- Só se manifestava com **2+ banners ativos** no Supabase (caso contrário as setas ficam ocultas por `if(totalSlides>1)`).
- Auto-advance (a cada 4.5s, linha 411) não foi afetado pois usa o nome correto.

### Como foi descoberto

O Claude Code detectou o typo espontaneamente ao rodar `/init` no projeto, como parte da análise inicial do repo. Fix foi validado antes de aplicar verificando as outras 5 ocorrências de `totalSlides` no arquivo (linhas 351, 387, 401, 411, 420), confirmando que era um caso único.

---

## A saga de infraestrutura (o que tomou tempo)

O fix em si é de 1 caractere. Mas o deploy ficou travado por problemas em cadeia:

### 1. Conexão Netlify ↔ GitHub quebrada desde 14/Abril

Durante a migração da conta Netlify para `admin@playvision.world`, o token OAuth do GitHub associado à conta antiga foi invalidado. A UI do Netlify não refletia isso (mostrava "Active"), mas qualquer deploy falhava em `"preparing repo"` com **"Unable to access repository"**.

Sintomas enganosos durante o diagnóstico:
- Banner vermelho "unrecognized Git contributor" na lista de deploys → era lixo de tentativas antigas, **não era a causa raiz**.
- Deploys manuais via **Trigger deploy** não geravam nenhum item novo na lista — o Netlify simplesmente não conseguia iniciar.

### 2. Identidade Git local não configurada

Primeiros commits saíram com autor `viniciusesteves@Viniciuss-MacBook-Air-2.local` (default derivado do hostname). Corrigido com:

```bash
git config --global user.name "Vinicius Esteves"
git config --global user.email "274894766+viniciusesteves-lab@users.noreply.github.com"
```

O formato `{ID}+{username}@users.noreply.github.com` mantém atribuição correta no GitHub sem expor email pessoal — encontrado em [GitHub Settings → Emails → Keep my email addresses private](https://github.com/settings/emails).

### 3. O que destravou

Transferência do ownership do repo de `viniciusesteves-lab/recargagames-frontend` → `admin-pv/recargagames-frontend` (GitHub → Settings → Danger Zone → Transfer).

Isso forçou no Netlify:
- **Manage repository → Link to a different repository**
- OAuth fresh com GitHub (instalação nova da Netlify GitHub App)
- Novo token, acesso restaurado, deploys voltaram

---

## Auditoria de segurança (bônus feito no caminho)

Antes de tornar o repo público, passamos scan de secrets e auditoria de RLS no Supabase.

### Secrets — nada crítico encontrado

Varredura completa do código e `git log --all`:
- Nenhuma chave privada, token, JWT, credencial, `.env`, `.pem`, etc.
- Chave `sb_publishable_*` do Supabase é pública por design (RLS protege os dados).
- Gmail pessoal aparece em 3 commits antigos (pré-sessão). Aceito como tradeoff pragmático — migração completa para Org PlayVision fica como tarefa futura.

### RLS no Supabase — 4 policies corrigidas

Quatro tabelas estavam com policies `admin write` configuradas com `Target Role: public` em vez de `authenticated`:

| Tabela | Policy |
|---|---|
| `banners` | `admin write banners` |
| `game_packages` | `admin write packages` |
| `games` | `admin write games` |
| `site_content` | `admin write site_content` |

**Nota:** Risco prático era baixo pois a cláusula `USING` checava `auth.uid()` + `user_type = 'admin'`, bloqueando anon na prática. Mas corrigir é boa higiene (consistência com as outras 10+ policies, defense in depth, evita falsos alertas de scanners).

---

## Estado final

### Infraestrutura

- **Repo:** `admin-pv/recargagames-frontend` (público)
- **Netlify project:** `gleeful-entremet-47b89b` (recargagames.com)
- **Netlify team:** `vinicius-esteves's team`
- **Netlify login:** `admin@playvision.world`
- **Auto-deploy:** main → produção via GitHub App OAuth (restaurado)

### Local dev

- **Path:** `~/Developer/recargagames-frontend`
- **Git remote:** `https://github.com/admin-pv/recargagames-frontend.git`
- **Git identity global:** noreply do GitHub

---

## Dívida técnica (pra fazer em outra sessão)

- [ ] Criar GitHub Organization `playvision` e migrar o repo de `admin-pv` pra lá (setup "correto" de longo prazo).
- [ ] Reescrever histórico dos 3 commits antigos pra remover Gmail pessoal (ex: `git filter-repo --email-callback`).
- [ ] Adicionar um linter simples no repo (ex: `html-validate` ou `eslint` no JS inline) pra pegar typos como `otalSlides` automaticamente antes do commit — sem quebrar a filosofia "sem build step" (pode ser um pre-commit hook local, opcional).
- [ ] Considerar uma branch `staging` com deploy preview separado pra testar fixes antes de ir pra main (hoje main = produção direto).

## Runbook: "deploy não está rodando, o que checar"

Próxima vez que isso acontecer, na ordem:

1. **Aba Deploys no Netlify** — algum item recente? Se sim, status?
2. **Se não aparecer nada** após push/trigger manual → provavelmente OAuth quebrado. Histórico de deploys vai mostrar "Unable to access repository" ou deploys pulados silenciosamente.
3. **Solução rápida:** Project configuration → Build & deploy → Manage repository → **Link to a different repository** (força OAuth novo, resolve mesmo religando o mesmo repo).
4. **Se quiser validar o que o site está servindo** (sem precisar do DevTools):
```js
   // Cole no Console do browser na página em questão
   fetch(location.pathname + '?cb=' + Date.now(), {cache:'no-store'})
     .then(r => r.text())
     .then(h => console.log('ETag change?', h.slice(0, 100)));
```
