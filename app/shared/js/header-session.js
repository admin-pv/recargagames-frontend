/* ──────────────────────────────────────────────────────────────────────────
   header-session.js — o botão de conta do header, em TODAS as páginas

   O PROBLEMA QUE ELE RESOLVE (achado no reteste do C2, 11/09):
   o `.account-btn` do header dizia "Cadastre-se / Entrar" em HTML fixo, em
   15 páginas. Quem estava logado via um convite para criar conta que já
   tinha. A Fase 1 trocou a sessão por Supabase Auth, mas o header nunca
   soube disso — ele não lia sessão nenhuma, nem do jeito antigo.

   Não existe template compartilhado neste projeto (sem build step; o
   HANDOVER do fornecedor registra que header e footer são copiados em cada
   arquivo). Então o componente compartilhado não é o MARKUP, é o
   COMPORTAMENTO: este arquivo encontra o botão que já está em cada página
   e o coloca em dia com a sessão.

   Consequência prática: acrescentar uma página nova ao site é copiar o
   header como sempre e incluir a tag deste script. Se esquecer, a página
   volta a mentir sobre a sessão — e é por isso que isso está escrito aqui.

   Dependências, nesta ordem:
     supabase-js (CDN) → market.js → supabase-client.js → store.js → este.
   ────────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  var PROFILE_PAGE = 'account-profile.html';

  /* Nome a mostrar, em ordem de confiança:
       1. full_name do perfil (customer_profiles) — é o que o usuário editou
       2. full_name do metadata da sessão — o que ele digitou no cadastro
       3. parte local do e-mail — sempre existe
     Truncado porque o botão do header é estreito e um nome comprido
     quebraria o layout do nav em telas médias. */
  function displayName(profile, sessionUser) {
    var name =
      (profile && profile.full_name) ||
      (sessionUser && sessionUser.user_metadata && sessionUser.user_metadata.full_name) ||
      '';
    name = String(name).trim();

    if (!name) {
      var email = (profile && profile.email) || (sessionUser && sessionUser.email) || '';
      name = String(email).split('@')[0];
    }
    if (!name) return 'Minha conta';

    /* Só o primeiro nome: "Vinicius Esteves" vira "Vinicius". O nome
       completo fica no perfil, que é para onde o botão leva. */
    var first = name.split(/\s+/)[0];
    return first.length > 18 ? first.slice(0, 17) + '…' : first;
  }

  function paintLoggedIn(btn, label) {
    var strong = btn.querySelector('strong');
    var small = btn.querySelector('small');
    if (strong) strong.textContent = label;
    if (small) small.textContent = 'Minha conta';
    btn.setAttribute('aria-label', 'Minha conta — ' + label);

    /* Sobrescreve o destino. Quase todas as páginas já apontam para o
       perfil, mas coming-soon.html manda para account-login.html — correto
       deslogado, errado para quem já entrou. Atribuir .onclick substitui o
       onclick inline do HTML.

       index.html é o caso diferente: o botão de lá não tem onclick, é
       capturado por um listener delegado em [data-modal]. Esse listener
       continua rodando e também vai para o perfil, então os dois caminhos
       concordam e não há conflito. */
    btn.onclick = function () { global.location.href = PROFILE_PAGE; };
  }

  async function init() {
    var btn = document.querySelector('.account-btn');
    /* Sem botão: account-login.html (header enxuto de propósito) e
       campaign.html (stub de redirect). Nada a fazer. */
    if (!btn) return;

    if (!global.RecargaStore || !global.RecargaStore.getSession) {
      /* Falta a camada de dados nesta página. Deslogado é o estado seguro
         de exibir: no pior caso oferecemos login a quem já tem conta, que
         é o bug de antes — mas nunca afirmamos uma sessão que não
         verificamos. */
      return;
    }

    var session = await global.RecargaStore.getSession();
    if (!session) return;   // deslogado: o HTML já está certo

    /* Primeira pintura sem rede. getSession() lê do storage, então o
       rótulo aparece imediatamente. Esperar o perfil aqui devolveria o
       mesmo bug em miniatura: um "Cadastre-se" piscando para quem está
       logado, por 100–300ms. */
    paintLoggedIn(btn, displayName(null, session.user));

    /* Refino: o full_name do perfil é a fonte que o usuário edita. Se ele
       trocou o nome depois do cadastro, o metadata da sessão está velho.
       Assíncrono e sem bloquear — se falhar, fica o rótulo da sessão. */
    try {
      var profile = await global.RecargaStore.getUser();
      if (profile) paintLoggedIn(btn, displayName(profile, session.user));
    } catch (e) { /* o rótulo da sessão já serve */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
