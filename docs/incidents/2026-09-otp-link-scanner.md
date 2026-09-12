# Scanner de e-mail consumindo token de uso único — troca para OTP

**Data:** 12 de setembro de 2026
**Severidade:** Alta para o fluxo, baixa para o dano. Nenhum usuário real
afetado — o primeiro cadastro do C2 foi o do próprio owner, atrás do gate.
**Estado:** resolvido no código (`feat/customer-auth`); pendente a
atualização dos dois templates no painel do Supabase.

---

## O sintoma

Primeiro cadastro real da Fase 1. O e-mail chegou (Resend, DKIM pass), o
link de confirmação foi clicado, e a tela devolveu **504**. Mesmo assim, o
usuário aparecia **confirmado no banco**.

## A causa raiz

O Auth Log do Supabase mostrou duas chamadas a `/verify` para o mesmo
token, nesta ordem:

1. `remote_addr 172.253.15.227` (Google) → `303`, evento `user_signedup`
2. o clique do usuário → falha

O primeiro endereço é o **scanner de links do Gmail**. Ele abre os links
de um e-mail antes de entregá-lo, para checar se apontam para algo
malicioso. O token de confirmação do Supabase é de **uso único**: quando o
scanner o visitou, ele foi gasto e a conta foi confirmada. O clique real
chegou depois, com o token já queimado.

O 504 é consequência, não causa.

## Por que isso não é caso de borda

- **Todo provedor corporativo de e-mail faz pré-varredura de links.**
  Gmail, Outlook/Defender, Proofpoint, Mimecast. Não há cabeçalho, atributo
  ou convenção que peça "não siga este link".
- **Atinge igualmente o reset de senha**, que usa o mesmo mecanismo de
  token único. Ali o dano seria pior: a pessoa não consegue entrar,
  e o "confirmado no banco" não a ajuda em nada.
- A taxa de ocorrência depende do provedor do destinatário, então o bug se
  manifesta de forma intermitente e "só para alguns usuários" — a pior
  forma de descobrir isso, que é em produção, por chamado de suporte.

## A correção

**Cadastro e redefinição de senha passaram a usar código de 6 dígitos.**

Um scanner que abre o e-mail não consome nada: não há o que visitar. O
token só é gasto quando alguém digita os dígitos na aba do site.

| Onde | O que mudou |
|---|---|
| `docs/email-templates/confirm-signup.html` | `{{ .Token }}` em destaque; `{{ .ConfirmationURL }}` **removido** |
| `docs/email-templates/reset-password.html` | idem |
| `app/shared/js/store.js` | `verifySignupCode()`, `verifyRecoveryCode()`, `resendCode()` |
| `app/account-login.html` | campo de 6 dígitos nas duas telas de "verifique seu e-mail", com reenvio |

### O detalhe que não pode ser desfeito

`{{ .ConfirmationURL }}` **não pode voltar** a esses dois templates. Se ele
convive com `{{ .Token }}`, o Supabase gera o link, o scanner o visita, e
o código digitado depois falha como "inválido" — o bug volta, agora com um
caminho que funciona e outro que não, o que é bem mais difícil de
diagnosticar. Está escrito também no topo do
`docs/email-templates/README.md` e no `store.js`.

### Assimetria do Supabase que o código precisa contornar

`auth.resend()` aceita `signup`, `email_change`, `sms` e `phone_change` —
**mas não `recovery`**. Reenviar um código de redefinição é chamar
`resetPasswordForEmail()` de novo. `resendCode()` encaminha por isso, em
vez de ter uma implementação só.

### O que continua com link

`change-email` e `magic-link` têm **a mesma vulnerabilidade** e seguem com
`{{ .ConfirmationURL }}`. Ficaram porque nenhum dos dois é alcançável hoje:
não há tela de troca de e-mail (o `updateEmail()` do store existe e ninguém
chama) e magic link não é usado. **Converter para OTP antes de expor
qualquer um dos dois** — `verifyOtp` aceita `type: 'email_change'` e
`type: 'magiclink'`.

O tratamento do evento `PASSWORD_RECOVERY` no boot do `account-login.html`
virou caminho morto para o fluxo normal, mas foi **mantido de propósito**:
links antigos ainda podem chegar em alguma caixa de entrada, e o
`change-email` dispara o mesmo evento.

## O que a resposta neutra custou aqui

O reenvio devolve a mesma confirmação para e-mail cadastrado e não
cadastrado, igual ao "esqueci minha senha". A única falha que a tela
distingue é rate limit — que revela "houve tentativas recentes", não
"este e-mail é cliente".

## Verificação

Feita contra o Supabase de produção, sem criar conta:

- `verifyRecoveryCode()` com código errado devolve `otp_invalid` (o GoTrue
  não distingue errado de expirado de já usado, e é melhor assim — "já
  usado" confirmaria que o e-mail existe)
- a tela mostra "Código inválido ou expirado", marca o campo e **não**
  perde o estado
- "Reenviar código" devolve a confirmação neutra
- o campo aceita colar `"12 34-56abc789"` e normaliza para `123456`,
  porque é assim que o texto sai de um e-mail
- `inputmode="numeric"` e `autocomplete="one-time-code"` para o iOS
  oferecer o código sem copiar e colar

## Pendências

- [ ] **Colar os dois templates novos no painel** (Authentication → Emails
      → Templates). Até lá o e-mail chega sem código e o campo não tem o
      que receber — é pré-requisito do C2.
- [ ] Conferir **Authentication → Providers → Email → Email OTP
      Expiration**. Os templates dizem "1 hora", que é o default; um
      e-mail que promete 1 hora e expira em 10 minutos vira chamado.
- [ ] Converter `change-email` e `magic-link` para OTP antes de expor
      qualquer um dos dois.
