# Templates de e-mail do Supabase Auth — pt-BR

Os templates do Supabase vêm em inglês por padrão. Estes são as versões
pt-BR para colar em **Authentication → Emails → Templates** no painel do
projeto `ashmirzgyuhspymldpfv`.

**Nada aqui é aplicado por deploy.** São arquivos de referência; a fonte da
verdade é o painel. Se editar no painel, atualize aqui também — senão o
próximo a mexer não sabe qual versão está no ar.

| Arquivo | Template no painel | Quando dispara |
|---|---|---|
| `confirm-signup.html` | Confirm signup | `signUp()` — o usuário precisa clicar antes de ter sessão |
| `reset-password.html` | Reset password | `resetPasswordForEmail()` |
| `change-email.html` | Change email address | `updateUser({email})` — vai para o endereço **novo** |
| `magic-link.html` | Magic Link | não usado hoje; incluído porque o painel já o tem ativo e em inglês |

## O detalhe que faz o link funcionar

O **Site URL** do projeto é `https://recargagames.com` — compartilhado com
o login do admin, e por isso não foi alterado. Consequência: `{{ .ConfirmationURL }}`
cai na **landing da raiz**, não na loja, a menos que a chamada passe
redirect explícito.

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
