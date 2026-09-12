# Templates de e-mail do Supabase Auth — pt-BR

Os templates do Supabase vêm em inglês por padrão. Estes são as versões
pt-BR para colar em **Authentication → Emails → Templates** no painel do
projeto `ashmirzgyuhspymldpfv`.

**Nada aqui é aplicado por deploy.** São arquivos de referência; a fonte da
verdade é o painel. Se editar no painel, atualize aqui também — senão o
próximo a mexer não sabe qual versão está no ar.

| Arquivo | Template no painel | Formato | Quando dispara |
|---|---|---|---|
| `confirm-signup.html` | Confirm signup | **código de 6 dígitos** | `signUp()` |
| `reset-password.html` | Reset password | **código de 6 dígitos** | `resetPasswordForEmail()` |
| `change-email.html` | Change email address | link | `updateUser({email})` — dormente, ver abaixo |
| `magic-link.html` | Magic Link | link | não usado; o painel já o tem ativo e em inglês |

---

## Por que código e não link

**Em 12/09 o primeiro cadastro real falhou com 504 na confirmação.** O Auth
Log mostrou o que aconteceu: o scanner de links do Gmail
(`remote_addr 172.253.15.227`, Google) abriu o `/verify` **antes do
usuário**, recebeu `303` e registrou `user_signedup`. O token é de uso
único — quando a pessoa clicou, ele já tinha sido gasto. A conta ficou
confirmada no banco e a tela deu erro.

Isso não é caso de borda: **todo provedor de e-mail corporativo faz
pré-varredura de links**, e o mesmo mecanismo afeta o link de redefinição
de senha. Não há como pedir ao scanner que não clique.

A saída é não mandar link nenhum nesses dois fluxos. Com um código de 6
dígitos, um scanner que "abre" o e-mail não consome nada — o token só é
gasto quando alguém digita os dígitos na aba do site.

**Por isso `{{ .ConfirmationURL }}` foi REMOVIDO desses dois templates, e
não pode voltar.** Se ele aparecer junto de `{{ .Token }}`, o Supabase
gera o link, o scanner o visita, e o código digitado depois falha como
"inválido" — o bug volta, agora mais difícil de diagnosticar, porque a
tela terá um caminho que funciona e outro que não.

### Os outros dois templates ainda usam link

`change-email.html` e `magic-link.html` continuam com
`{{ .ConfirmationURL }}` e têm **a mesma vulnerabilidade**. Estão assim
porque nenhum dos dois é alcançável hoje: não há tela de troca de e-mail
(o `updateEmail()` do store existe e ninguém chama) e magic link não é
usado. **Antes de expor qualquer um dos dois, converter para OTP** —
`verifyOtp` aceita `type: 'email_change'` e `type: 'magiclink'`.

### Expiração

Os templates dizem "1 hora", que é o default do Supabase para código de
e-mail. Confira em **Authentication → Providers → Email → Email OTP
Expiration** e ajuste o texto se o valor for outro — um e-mail que promete
1 hora e expira em 10 minutos vira chamado de suporte.

## O detalhe do redirect (ainda vale para os dois templates com link)

O **Site URL** do projeto é `https://recargagames.com` — compartilhado com
o login do admin, e por isso não foi alterado. Consequência: `{{ .ConfirmationURL }}`
cai na **landing da raiz**, não na loja, a menos que a chamada passe
redirect explícito.

Com cadastro e reset em OTP, isso deixou de importar para eles — não há
link para redirecionar. Continua valendo para `change-email` e
`magic-link`, e o código segue passando o redirect nessas chamadas.

Por isso todo ponto do código que dispara e-mail passa:

```js
{ emailRedirectTo: RecargaMarket.pagePath('account-login.html') }
```

(`redirectTo` no caso do `resetPasswordForEmail`.)

`pagePath()` monta `origin + '/' + key + '/' + page` usando `key` (`'br'`,
minúsculo), não `country` (`'BR'`). Montar à mão com `country` e esquecer o
`toLowerCase()` produz `/BR/account-login.html`, que não casa com nenhuma
Redirect URL cadastrada e falha com `redirect_to is not allowed`. É por isso
que o endereço é montado num lugar só, em `app/shared/js/market.js`.

Os templates em si **não precisam saber disso** — `{{ .ConfirmationURL }}`
já honra o redirect passado na chamada. Está registrado aqui porque, se um
dia um e-mail cair na landing da raiz, a causa é uma chamada sem
`emailRedirectTo`, não o template.

## Redirect URLs permitidas (Authentication → URL Configuration)

```
https://recargagames.com/br/**
https://deploy-preview-*--gleeful-entremet-47b89b.netlify.app/br/**
http://localhost:8888/br/**
```

Um mercado novo (`/mx/`, `/ph/`, `/ng/`) precisa da linha correspondente
aqui **antes** de o path existir, senão o link do e-mail é rejeitado com
`redirect_to is not allowed`.

## Variáveis disponíveis

`{{ .ConfirmationURL }}`, `{{ .Token }}` (código de 6 dígitos),
`{{ .TokenHash }}`, `{{ .SiteURL }}`, `{{ .Email }}`, `{{ .NewEmail }}`
(só no change-email), `{{ .RedirectTo }}`.

## Estilo

HTML de e-mail, não de página: tabelas, estilo inline, sem `<style>` em
`<head>` (Gmail descarta), sem web font (fallback para system stack), sem
imagem externa (muitos clientes bloqueiam por padrão — o logo é texto).
Paleta da loja: `#F5700A` laranja, `#0D0F1A` fundo, `#F5F4F0` texto claro.
Largura 600px, que é o que sobrevive no Outlook.
