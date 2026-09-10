// Shared product catalog for Recarga Games prototype (both branding versions).
// type: 'direct' = needs in-game player ID, 'code' = redeem code by email, 'giftcard' = gift card by email
window.RECARGA_PRODUCTS = [
  {
    "id": "mobile-legends",
    "name": "Mobile Legends",
    "short": "MLBB",
    "category": "Recarga direta",
    "type": "direct",
    "platform": "mobile",
    "color": "#F5700A",
    "popular": true,
    "status": null,
    "teaserPrice": "R$ 4,90",
    "art": "generic",
    "search": "mobile legends diamantes mlbb recarga direta",
    "redemption": {
      "fields": [
        {
          "key": "playerId",
          "label": "ID do jogador",
          "placeholder": "Ex: 123456789",
          "pattern": "^\\d{6,12}$",
          "help": "Encontre seu ID no jogo em Perfil, abaixo do seu nome."
        },
        {
          "key": "zoneId",
          "label": "ID da zona (servidor)",
          "placeholder": "Ex: 2151",
          "pattern": "^\\d{3,5}$",
          "help": "Aparece ao lado do seu ID de jogador, entre parênteses."
        }
      ]
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "mlbb-56",
        "label": "56 Diamantes",
        "detail": "Pacote inicial",
        "price": 4.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "mlbb-278",
        "label": "278 Diamantes",
        "detail": "250 + 28 bônus",
        "price": 20.9,
        "originalPrice": null,
        "tag": "Bônus ativo",
        "tagClass": "lime"
      },
      {
        "id": "mlbb-571",
        "label": "571 Diamantes",
        "detail": "520 + 51 bônus",
        "price": 39.9,
        "originalPrice": 44.9,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "mlbb-1163",
        "label": "1163 Diamantes",
        "detail": "1060 + 103 bônus",
        "price": 79.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "mlbb-2398",
        "label": "2398 Diamantes",
        "detail": "2180 + 218 bônus",
        "price": 159.9,
        "originalPrice": 179.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      },
      {
        "id": "mlbb-weekly",
        "label": "Passe Semanal",
        "detail": "Recompensas diárias por 7 dias",
        "price": 19.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      }
    ],
    "related": [
      "free-fire",
      "pubg-mobile",
      "arena-breakout",
      "blood-strike"
    ]
  },
  {
    "id": "free-fire",
    "name": "Free Fire",
    "short": "FF",
    "category": "Recarga direta",
    "type": "direct",
    "platform": "mobile",
    "color": "#F0B429",
    "popular": true,
    "status": "bonus",
    "teaserPrice": "R$ 3,99",
    "art": "freefire",
    "search": "free fire diamantes recarga direta bonus",
    "redemption": {
      "fields": [
        {
          "key": "playerId",
          "label": "ID do jogador",
          "placeholder": "Ex: 123456789",
          "pattern": "^\\d{6,15}$",
          "help": "Encontre seu ID no perfil do jogo, abaixo do seu avatar."
        }
      ]
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "ff-110",
        "label": "110 Diamantes",
        "detail": "100 + 10 bônus",
        "price": 4.9,
        "originalPrice": 5.9,
        "tag": "Bônus ativo",
        "tagClass": "lime"
      },
      {
        "id": "ff-341",
        "label": "341 Diamantes",
        "detail": "310 + 31 bônus",
        "price": 13.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "ff-572",
        "label": "572 Diamantes",
        "detail": "520 + 52 bônus",
        "price": 20.9,
        "originalPrice": 24.9,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "ff-1166",
        "label": "1166 Diamantes",
        "detail": "1060 + 106 bônus",
        "price": 44.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "ff-2398",
        "label": "2398 Diamantes",
        "detail": "2180 + 218 bônus",
        "price": 87.9,
        "originalPrice": 99.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      },
      {
        "id": "ff-6160",
        "label": "6160 Diamantes",
        "detail": "5600 + 560 bônus",
        "price": 209.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      }
    ],
    "related": [
      "free-fire-weekly",
      "free-fire-monthly",
      "mobile-legends",
      "pubg-mobile",
      "valorant"
    ]
  },
  {
    "id": "pubg-mobile",
    "name": "PUBG Mobile",
    "short": "PUBG",
    "category": "Recarga direta",
    "type": "direct",
    "platform": "mobile",
    "color": "#F0B429",
    "popular": true,
    "status": null,
    "teaserPrice": "R$ 9,90",
    "art": "generic",
    "search": "pubg mobile uc recarga direta",
    "redemption": {
      "fields": [
        {
          "key": "playerId",
          "label": "ID do personagem",
          "placeholder": "Ex: 5123456789",
          "pattern": "^\\d{6,15}$",
          "help": "Encontre seu ID no jogo, na tela inicial abaixo do seu nome."
        }
      ]
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "pubgm-60",
        "label": "60 UC",
        "detail": "Pacote inicial",
        "price": 9.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "pubgm-325",
        "label": "325 UC",
        "detail": "300 + 25 bônus",
        "price": 44.9,
        "originalPrice": null,
        "tag": "Bônus ativo",
        "tagClass": "lime"
      },
      {
        "id": "pubgm-660",
        "label": "660 UC",
        "detail": "600 + 60 bônus",
        "price": 84.9,
        "originalPrice": 94.9,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "pubgm-1800",
        "label": "1800 UC",
        "detail": "1500 + 300 bônus",
        "price": 219.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "pubgm-3850",
        "label": "3850 UC",
        "detail": "3000 + 850 bônus",
        "price": 429.9,
        "originalPrice": 469.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      }
    ],
    "related": [
      "mobile-legends",
      "free-fire",
      "arena-breakout",
      "marvel-rivals"
    ]
  },
  {
    "id": "honkai-star-rail",
    "name": "Honkai Star Rail",
    "short": "HSR",
    "category": "Recarga direta",
    "type": "direct",
    "platform": "mobile",
    "color": "#F5F4F0",
    "popular": true,
    "status": null,
    "teaserPrice": null,
    "art": "generic",
    "search": "honkai star rail recarga direta",
    "redemption": {
      "fields": [
        {
          "key": "playerId",
          "label": "UID do Astral Express",
          "placeholder": "Ex: 601234567",
          "pattern": "^\\d{6,10}$",
          "help": "Encontre seu UID no jogo, em Perfil no canto superior esquerdo."
        }
      ]
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "hsr-60",
        "label": "60 Oniritos",
        "detail": "Pacote inicial",
        "price": 5.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "hsr-330",
        "label": "330 Oniritos",
        "detail": "300 + 30 bônus",
        "price": 29.9,
        "originalPrice": null,
        "tag": "Bônus ativo",
        "tagClass": "lime"
      },
      {
        "id": "hsr-680",
        "label": "680 Oniritos",
        "detail": "600 + 80 bônus",
        "price": 59.9,
        "originalPrice": 66.9,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "hsr-1980",
        "label": "1980 Oniritos",
        "detail": "1600 + 380 bônus",
        "price": 169.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "hsr-3280",
        "label": "3280 Oniritos",
        "detail": "2800 + 480 bônus",
        "price": 269.9,
        "originalPrice": 299.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      }
    ],
    "related": [
      "genshin-impact",
      "zzz",
      "valorant"
    ]
  },
  {
    "id": "valorant",
    "name": "Valorant",
    "short": "VAL",
    "category": "Recarga direta",
    "type": "direct",
    "platform": "pc",
    "color": "#E0379A",
    "popular": true,
    "status": null,
    "teaserPrice": null,
    "art": "generic",
    "search": "valorant vp recarga direta pc",
    "redemption": {
      "fields": [
        {
          "key": "riotId",
          "label": "Riot ID (nome#tag)",
          "placeholder": "Ex: Jogador#BR1",
          "pattern": "^.{3,24}#[A-Za-z0-9]{2,5}$",
          "help": "Encontre seu Riot ID completo em Configurações da conta."
        }
      ]
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "val-475",
        "label": "475 VP",
        "detail": "Pacote inicial",
        "price": 24.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "val-1000",
        "label": "1000 VP",
        "detail": "1000 + 0 bônus",
        "price": 49.9,
        "originalPrice": null,
        "tag": "Bônus ativo",
        "tagClass": "lime"
      },
      {
        "id": "val-2050",
        "label": "2050 VP",
        "detail": "1950 + 100 bônus",
        "price": 99.9,
        "originalPrice": 109.9,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "val-3650",
        "label": "3650 VP",
        "detail": "3450 + 200 bônus",
        "price": 169.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "val-5350",
        "label": "5350 VP",
        "detail": "5000 + 350 bônus",
        "price": 249.9,
        "originalPrice": 279.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      }
    ],
    "related": [
      "marvel-rivals",
      "league-of-legends",
      "honkai-star-rail"
    ]
  },
  {
    "id": "genshin-impact",
    "name": "Genshin Impact",
    "short": "GI",
    "category": "Recarga direta",
    "type": "direct",
    "platform": "mobile",
    "color": "#F5F4F0",
    "popular": true,
    "status": null,
    "teaserPrice": null,
    "art": "generic",
    "search": "genshin impact genesis crystals recarga direta",
    "redemption": {
      "fields": [
        {
          "key": "playerId",
          "label": "UID do viajante",
          "placeholder": "Ex: 801234567",
          "pattern": "^\\d{6,10}$",
          "help": "Encontre seu UID no jogo, tocando no seu avatar no canto superior esquerdo."
        }
      ]
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "gi-60",
        "label": "60 Cristais",
        "detail": "Pacote inicial",
        "price": 5.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "gi-330",
        "label": "330 Cristais",
        "detail": "300 + 30 bônus",
        "price": 29.9,
        "originalPrice": null,
        "tag": "Bônus ativo",
        "tagClass": "lime"
      },
      {
        "id": "gi-1090",
        "label": "1090 Cristais",
        "detail": "980 + 110 bônus",
        "price": 94.9,
        "originalPrice": 104.9,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "gi-2240",
        "label": "2240 Cristais",
        "detail": "1980 + 260 bônus",
        "price": 179.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "gi-3880",
        "label": "3880 Cristais",
        "detail": "3280 + 600 bônus",
        "price": 299.9,
        "originalPrice": 329.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      },
      {
        "id": "gi-welkin",
        "label": "Bênção da Lua",
        "detail": "Recompensa diária por 30 dias",
        "price": 19.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      }
    ],
    "related": [
      "honkai-star-rail",
      "zzz",
      "mobile-legends"
    ]
  },
  {
    "id": "arena-breakout",
    "name": "Arena Breakout",
    "short": "AB",
    "category": "Recarga direta",
    "type": "direct",
    "platform": "mobile",
    "color": "#F5700A",
    "popular": false,
    "status": "new",
    "teaserPrice": null,
    "art": "generic",
    "search": "arena breakout recarga direta mobile",
    "redemption": {
      "fields": [
        {
          "key": "playerId",
          "label": "ID do jogador",
          "placeholder": "Ex: 123456789",
          "pattern": "^\\d{6,15}$",
          "help": "Encontre seu ID no jogo, na tela de perfil."
        }
      ]
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "ab-60",
        "label": "60 COD",
        "detail": "Pacote inicial",
        "price": 5.9,
        "originalPrice": null,
        "tag": "Novo",
        "tagClass": "orange"
      },
      {
        "id": "ab-300",
        "label": "300 COD",
        "detail": "270 + 30 bônus",
        "price": 27.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "ab-680",
        "label": "680 COD",
        "detail": "600 + 80 bônus",
        "price": 59.9,
        "originalPrice": 66.9,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "ab-1980",
        "label": "1980 COD",
        "detail": "1700 + 280 bônus",
        "price": 159.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "ab-3280",
        "label": "3280 COD",
        "detail": "2800 + 480 bônus",
        "price": 259.9,
        "originalPrice": 289.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      }
    ],
    "related": [
      "pubg-mobile",
      "mobile-legends",
      "blood-strike"
    ]
  },
  {
    "id": "zzz",
    "name": "Zenless Zone Zero",
    "short": "ZZZ",
    "category": "Recarga direta",
    "type": "direct",
    "platform": "mobile",
    "color": "#F5F4F0",
    "popular": false,
    "status": "event",
    "teaserPrice": null,
    "art": "generic",
    "search": "zenless zone zero zzz recarga direta mobile",
    "redemption": {
      "fields": [
        {
          "key": "playerId",
          "label": "UID do agente",
          "placeholder": "Ex: 130012345",
          "pattern": "^\\d{6,10}$",
          "help": "Encontre seu UID no jogo, no menu de perfil."
        }
      ]
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "zzz-60",
        "label": "60 Policromos",
        "detail": "Pacote inicial",
        "price": 5.9,
        "originalPrice": null,
        "tag": "Live Drop",
        "tagClass": "pink"
      },
      {
        "id": "zzz-330",
        "label": "330 Policromos",
        "detail": "300 + 30 bônus",
        "price": 29.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "zzz-1090",
        "label": "1090 Policromos",
        "detail": "980 + 110 bônus",
        "price": 94.9,
        "originalPrice": 104.9,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "zzz-2240",
        "label": "2240 Policromos",
        "detail": "1980 + 260 bônus",
        "price": 179.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "zzz-3880",
        "label": "3880 Policromos",
        "detail": "3280 + 600 bônus",
        "price": 299.9,
        "originalPrice": 329.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      }
    ],
    "related": [
      "genshin-impact",
      "honkai-star-rail",
      "blood-strike"
    ]
  },
  {
    "id": "blood-strike",
    "name": "Blood Strike",
    "short": "BS",
    "category": "Recarga direta",
    "type": "direct",
    "platform": "mobile",
    "color": "#E0379A",
    "popular": false,
    "status": null,
    "teaserPrice": null,
    "art": "generic",
    "search": "blood strike recarga direta mobile",
    "redemption": {
      "fields": [
        {
          "key": "playerId",
          "label": "ID do jogador",
          "placeholder": "Ex: 123456789",
          "pattern": "^\\d{6,15}$",
          "help": "Encontre seu ID no jogo, na tela de perfil."
        }
      ]
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "bs-60",
        "label": "60 Ouro",
        "detail": "Pacote inicial",
        "price": 5.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "bs-300",
        "label": "300 Ouro",
        "detail": "270 + 30 bônus",
        "price": 26.9,
        "originalPrice": null,
        "tag": "Bônus ativo",
        "tagClass": "lime"
      },
      {
        "id": "bs-680",
        "label": "680 Ouro",
        "detail": "600 + 80 bônus",
        "price": 57.9,
        "originalPrice": 64.9,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "bs-1980",
        "label": "1980 Ouro",
        "detail": "1700 + 280 bônus",
        "price": 149.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "bs-3280",
        "label": "3280 Ouro",
        "detail": "2800 + 480 bônus",
        "price": 249.9,
        "originalPrice": 279.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      }
    ],
    "related": [
      "arena-breakout",
      "pubg-mobile",
      "zzz"
    ]
  },
  {
    "id": "marvel-rivals",
    "name": "Marvel Rivals",
    "short": "MR",
    "category": "Recarga direta",
    "type": "direct",
    "platform": "pc",
    "color": "#F5700A",
    "popular": false,
    "status": null,
    "teaserPrice": null,
    "art": "generic",
    "search": "marvel rivals recarga direta pc",
    "redemption": {
      "fields": [
        {
          "key": "playerId",
          "label": "ID do jogador",
          "placeholder": "Ex: 123456789",
          "pattern": "^\\d{6,15}$",
          "help": "Encontre seu ID no jogo, no menu de perfil."
        }
      ]
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "mr-300",
        "label": "300 Lattice",
        "detail": "Pacote inicial",
        "price": 24.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "mr-1000",
        "label": "1000 Lattice",
        "detail": "1000 + 0 bônus",
        "price": 49.9,
        "originalPrice": null,
        "tag": "Bônus ativo",
        "tagClass": "lime"
      },
      {
        "id": "mr-2100",
        "label": "2100 Lattice",
        "detail": "2000 + 100 bônus",
        "price": 99.9,
        "originalPrice": 109.9,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "mr-5600",
        "label": "5600 Lattice",
        "detail": "5000 + 600 bônus",
        "price": 249.9,
        "originalPrice": 279.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      }
    ],
    "related": [
      "valorant",
      "pubg-mobile",
      "mobile-legends"
    ]
  },
  {
    "id": "league-of-legends",
    "name": "League of Legends",
    "short": "LoL",
    "category": "Código digital",
    "type": "code",
    "platform": "pc",
    "color": "#F0B429",
    "popular": true,
    "status": null,
    "teaserPrice": "R$ 20",
    "art": "generic",
    "search": "league of legends lol rp codigo de resgate codigo digital pc",
    "redemption": {
      "fields": []
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "lol-20",
        "label": "R$ 20 em RP",
        "detail": "Código de resgate",
        "price": 20.0,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "lol-35",
        "label": "R$ 35 em RP",
        "detail": "Código de resgate",
        "price": 35.0,
        "originalPrice": null,
        "tag": "Bônus ativo",
        "tagClass": "lime"
      },
      {
        "id": "lol-50",
        "label": "R$ 50 em RP",
        "detail": "Código de resgate",
        "price": 50.0,
        "originalPrice": null,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "lol-100",
        "label": "R$ 100 em RP",
        "detail": "Código de resgate",
        "price": 100.0,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "lol-200",
        "label": "R$ 200 em RP",
        "detail": "Código de resgate",
        "price": 200.0,
        "originalPrice": 219.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      }
    ],
    "related": [
      "valorant",
      "marvel-rivals",
      "roblox"
    ]
  },
  {
    "id": "roblox",
    "name": "Roblox",
    "short": "Rbx",
    "category": "Código digital",
    "type": "code",
    "platform": "app",
    "color": "#F5F4F0",
    "popular": true,
    "status": null,
    "teaserPrice": "R$ 25",
    "art": "generic",
    "search": "roblox codigo de resgate robux app codigo digital",
    "redemption": {
      "fields": []
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "rbx-400",
        "label": "400 Robux",
        "detail": "Código de resgate",
        "price": 25.0,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "rbx-800",
        "label": "800 Robux",
        "detail": "Código de resgate",
        "price": 49.9,
        "originalPrice": null,
        "tag": "Bônus ativo",
        "tagClass": "lime"
      },
      {
        "id": "rbx-1700",
        "label": "1700 Robux",
        "detail": "Código de resgate",
        "price": 99.9,
        "originalPrice": 109.9,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "rbx-4500",
        "label": "4500 Robux",
        "detail": "Código de resgate",
        "price": 249.9,
        "originalPrice": 269.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      },
      {
        "id": "rbx-10000",
        "label": "10000 Robux",
        "detail": "Código de resgate",
        "price": 499.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      }
    ],
    "related": [
      "league-of-legends",
      "candy-crush",
      "google-play"
    ]
  },
  {
    "id": "candy-crush",
    "name": "Candy Crush",
    "short": "Candy",
    "category": "Código digital",
    "type": "code",
    "platform": "app",
    "color": "#F0B429",
    "popular": false,
    "status": null,
    "teaserPrice": null,
    "art": "generic",
    "search": "candy crush codigo de resgate codigo digital app",
    "redemption": {
      "fields": []
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "cc-25",
        "label": "25 Barras de ouro",
        "detail": "Código de resgate",
        "price": 14.9,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "cc-60",
        "label": "60 Barras de ouro",
        "detail": "Código de resgate",
        "price": 29.9,
        "originalPrice": null,
        "tag": "Bônus ativo",
        "tagClass": "lime"
      },
      {
        "id": "cc-140",
        "label": "140 Barras de ouro",
        "detail": "Código de resgate",
        "price": 59.9,
        "originalPrice": 64.9,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "cc-330",
        "label": "330 Barras de ouro",
        "detail": "Código de resgate",
        "price": 129.9,
        "originalPrice": 139.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      }
    ],
    "related": [
      "roblox",
      "google-play",
      "apple-gift-card"
    ]
  },
  {
    "id": "steam",
    "name": "Steam",
    "short": "Steam",
    "category": "Gift card",
    "type": "giftcard",
    "platform": "pc",
    "color": "#F5F4F0",
    "popular": false,
    "status": null,
    "teaserPrice": "R$ 20",
    "art": "generic",
    "search": "steam gift card codigo digital pc",
    "redemption": {
      "fields": []
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "steam-20",
        "label": "R$ 20",
        "detail": "Gift card digital",
        "price": 20.0,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "steam-30",
        "label": "R$ 30",
        "detail": "Gift card digital",
        "price": 30.0,
        "originalPrice": null,
        "tag": "Bônus ativo",
        "tagClass": "lime"
      },
      {
        "id": "steam-50",
        "label": "R$ 50",
        "detail": "Gift card digital",
        "price": 50.0,
        "originalPrice": null,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "steam-100",
        "label": "R$ 100",
        "detail": "Gift card digital",
        "price": 100.0,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "steam-200",
        "label": "R$ 200",
        "detail": "Gift card digital",
        "price": 200.0,
        "originalPrice": 219.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      }
    ],
    "related": [
      "playstation",
      "xbox-gift-card",
      "razer-gold"
    ]
  },
  {
    "id": "playstation",
    "name": "PlayStation",
    "short": "PSN",
    "category": "Gift card",
    "type": "giftcard",
    "platform": "console",
    "color": "#F5F4F0",
    "popular": false,
    "status": null,
    "teaserPrice": "R$ 30",
    "art": "generic",
    "search": "playstation psn gift card codigo digital console",
    "redemption": {
      "fields": []
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "psn-30",
        "label": "R$ 30",
        "detail": "Gift card digital",
        "price": 30.0,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "psn-50",
        "label": "R$ 50",
        "detail": "Gift card digital",
        "price": 50.0,
        "originalPrice": null,
        "tag": "Bônus ativo",
        "tagClass": "lime"
      },
      {
        "id": "psn-100",
        "label": "R$ 100",
        "detail": "Gift card digital",
        "price": 100.0,
        "originalPrice": 109.9,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "psn-200",
        "label": "R$ 200",
        "detail": "Gift card digital",
        "price": 200.0,
        "originalPrice": 219.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      }
    ],
    "related": [
      "steam",
      "xbox-gift-card",
      "google-play"
    ]
  },
  {
    "id": "google-play",
    "name": "Google Play",
    "short": "G.Play",
    "category": "Gift card",
    "type": "giftcard",
    "platform": "app",
    "color": "#2ECC8A",
    "popular": false,
    "status": null,
    "teaserPrice": "R$ 15",
    "art": "generic",
    "search": "google play gift card codigo digital app android",
    "redemption": {
      "fields": []
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "gplay-15",
        "label": "R$ 15",
        "detail": "Gift card digital",
        "price": 15.0,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "gplay-30",
        "label": "R$ 30",
        "detail": "Gift card digital",
        "price": 30.0,
        "originalPrice": null,
        "tag": "Bônus ativo",
        "tagClass": "lime"
      },
      {
        "id": "gplay-60",
        "label": "R$ 60",
        "detail": "Gift card digital",
        "price": 60.0,
        "originalPrice": 64.9,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "gplay-100",
        "label": "R$ 100",
        "detail": "Gift card digital",
        "price": 100.0,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      }
    ],
    "related": [
      "apple-gift-card",
      "candy-crush",
      "roblox"
    ]
  },
  {
    "id": "nintendo-eshop",
    "name": "Nintendo eShop",
    "short": "Nintendo",
    "category": "Gift card",
    "type": "giftcard",
    "platform": "console",
    "color": "#F5700A",
    "popular": false,
    "status": null,
    "teaserPrice": null,
    "art": "generic",
    "search": "nintendo eshop gift card codigo digital console switch",
    "redemption": {
      "fields": []
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "nsw-30",
        "label": "R$ 30",
        "detail": "Gift card digital",
        "price": 30.0,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "nsw-50",
        "label": "R$ 50",
        "detail": "Gift card digital",
        "price": 50.0,
        "originalPrice": null,
        "tag": "Bônus ativo",
        "tagClass": "lime"
      },
      {
        "id": "nsw-100",
        "label": "R$ 100",
        "detail": "Gift card digital",
        "price": 100.0,
        "originalPrice": 109.9,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "nsw-200",
        "label": "R$ 200",
        "detail": "Gift card digital",
        "price": 200.0,
        "originalPrice": 219.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      }
    ],
    "related": [
      "steam",
      "playstation",
      "xbox-gift-card"
    ]
  },
  {
    "id": "xbox-gift-card",
    "name": "Xbox Gift Card",
    "short": "Xbox",
    "category": "Gift card",
    "type": "giftcard",
    "platform": "console",
    "color": "#2ECC8A",
    "popular": false,
    "status": null,
    "teaserPrice": "R$ 30",
    "art": "generic",
    "search": "xbox gift card codigo digital console",
    "redemption": {
      "fields": []
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "xbox-30",
        "label": "R$ 30",
        "detail": "Gift card digital",
        "price": 30.0,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "xbox-50",
        "label": "R$ 50",
        "detail": "Gift card digital",
        "price": 50.0,
        "originalPrice": null,
        "tag": "Bônus ativo",
        "tagClass": "lime"
      },
      {
        "id": "xbox-100",
        "label": "R$ 100",
        "detail": "Gift card digital",
        "price": 100.0,
        "originalPrice": 109.9,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "xbox-200",
        "label": "R$ 200",
        "detail": "Gift card digital",
        "price": 200.0,
        "originalPrice": 219.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      }
    ],
    "related": [
      "playstation",
      "steam",
      "nintendo-eshop"
    ]
  },
  {
    "id": "apple-gift-card",
    "name": "Apple Gift Card",
    "short": "Apple",
    "category": "Gift card",
    "type": "giftcard",
    "platform": "app",
    "color": "#F5F4F0",
    "popular": false,
    "status": null,
    "teaserPrice": null,
    "art": "generic",
    "search": "apple gift card codigo digital app",
    "redemption": {
      "fields": []
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "apple-25",
        "label": "R$ 25",
        "detail": "Gift card digital",
        "price": 25.0,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "apple-50",
        "label": "R$ 50",
        "detail": "Gift card digital",
        "price": 50.0,
        "originalPrice": null,
        "tag": "Bônus ativo",
        "tagClass": "lime"
      },
      {
        "id": "apple-100",
        "label": "R$ 100",
        "detail": "Gift card digital",
        "price": 100.0,
        "originalPrice": 109.9,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "apple-200",
        "label": "R$ 200",
        "detail": "Gift card digital",
        "price": 200.0,
        "originalPrice": 219.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      }
    ],
    "related": [
      "google-play",
      "steam",
      "candy-crush"
    ]
  },
  {
    "id": "razer-gold",
    "name": "Razer Gold",
    "short": "Razer",
    "category": "Gift card",
    "type": "giftcard",
    "platform": "pc",
    "color": "#F0B429",
    "popular": false,
    "status": null,
    "teaserPrice": null,
    "art": "generic",
    "search": "razer gold gift card codigo digital pc",
    "redemption": {
      "fields": []
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "razer-20",
        "label": "R$ 20",
        "detail": "Gift card digital",
        "price": 20.0,
        "originalPrice": null,
        "tag": null,
        "tagClass": null
      },
      {
        "id": "razer-50",
        "label": "R$ 50",
        "detail": "Gift card digital",
        "price": 50.0,
        "originalPrice": null,
        "tag": "Bônus ativo",
        "tagClass": "lime"
      },
      {
        "id": "razer-100",
        "label": "R$ 100",
        "detail": "Gift card digital",
        "price": 100.0,
        "originalPrice": 109.9,
        "tag": "Mais vendido",
        "tagClass": "orange"
      },
      {
        "id": "razer-200",
        "label": "R$ 200",
        "detail": "Gift card digital",
        "price": 200.0,
        "originalPrice": 219.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      }
    ],
    "related": [
      "steam",
      "google-play",
      "xbox-gift-card"
    ]
  },
  {
    "id": "free-fire-weekly",
    "name": "Free Fire Passe Semanal",
    "short": "FF",
    "category": "Recarga direta",
    "type": "direct",
    "platform": "mobile",
    "color": "#F5700A",
    "popular": false,
    "status": null,
    "teaserPrice": "Pacote popular",
    "art": "generic",
    "search": "free fire passe semanal",
    "redemption": {
      "fields": [
        {
          "key": "playerId",
          "label": "ID do jogador",
          "placeholder": "Ex: 123456789",
          "pattern": "^\\d{6,15}$",
          "help": "Encontre seu ID no perfil do jogo, abaixo do seu avatar."
        }
      ]
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "ffw-1",
        "label": "Passe Semanal",
        "detail": "Recompensas diárias por 7 dias",
        "price": 9.9,
        "originalPrice": null,
        "tag": "Popular",
        "tagClass": "orange"
      }
    ],
    "related": [
      "free-fire",
      "free-fire-monthly",
      "mobile-legends"
    ]
  },
  {
    "id": "free-fire-monthly",
    "name": "Free Fire Passe Mensal",
    "short": "FF",
    "category": "Recarga direta",
    "type": "direct",
    "platform": "mobile",
    "color": "#F0B429",
    "popular": false,
    "status": null,
    "teaserPrice": "Melhor recorrência",
    "art": "generic",
    "search": "free fire passe mensal",
    "redemption": {
      "fields": [
        {
          "key": "playerId",
          "label": "ID do jogador",
          "placeholder": "Ex: 123456789",
          "pattern": "^\\d{6,15}$",
          "help": "Encontre seu ID no perfil do jogo, abaixo do seu avatar."
        }
      ]
    },
    "paymentFees": {
      "pix": 1.0,
      "boleto": 1.0,
      "card": 1.03,
      "operadora": 1.05
    },
    "packages": [
      {
        "id": "ffm-1",
        "label": "Passe Mensal",
        "detail": "Recompensas diárias por 30 dias",
        "price": 34.9,
        "originalPrice": 39.9,
        "tag": "Melhor valor",
        "tagClass": "gold"
      }
    ],
    "related": [
      "free-fire",
      "free-fire-weekly",
      "pubg-mobile"
    ]
  }
];
