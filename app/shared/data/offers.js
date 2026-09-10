// Seed "rewarded traffic" offers for the Offerwall / Página de Campanha (prototype).
// Real offers come from a rewarded-traffic partner (TyrAds, per Vinícius) — this
// seed exists only so the page has something real to render before that
// integration exists. See shared/js/store.js for getOffers()/completeOffer(),
// and claude/campaign-offerwall-context.md in the project for background on
// why this page exists and what it maps to.
//
// `segment` is an internal note only — never shown to the user. The TyrAds
// "rewarded traffic" model splits users into personas (Reward Hunter / Casual
// User / Gambler) and expects reward structures to be tested per segment
// rather than fixed. Keeping this data-driven (not hardcoded HTML) is what
// leaves room for that experimentation later.
window.RECARGA_SEED_OFFERS = [
  {
    id: "offer-001",
    provider: "TyrAds",
    title: "Baixe e teste um app parceiro",
    description: "Instale o app indicado e abra pelo menos uma vez.",
    estimatedTime: "2 min",
    rewardLabel: "R$ 5 em créditos",
    rewardAmount: 5.00,
    segment: "reward_hunter"
  },
  {
    id: "offer-002",
    provider: "TyrAds",
    title: "Responda uma pesquisa rápida",
    description: "Algumas perguntas sobre seus hábitos de jogo.",
    estimatedTime: "5 min",
    rewardLabel: "R$ 8 em créditos",
    rewardAmount: 8.00,
    segment: "casual"
  },
  {
    id: "offer-003",
    provider: "TyrAds",
    title: "Alcance o nível 5 em um jogo parceiro",
    description: "Jogue até o marco indicado dentro do app parceiro.",
    estimatedTime: "~30 min",
    rewardLabel: "R$ 25 em créditos",
    rewardAmount: 25.00,
    segment: "gambler"
  }
];
