import type { Dict } from './en'

/** Tutte le parole del sito, in italiano. Stessa forma di `en.ts`. */
export const it: Dict = {
  meta: {
    title: 'Greenlit · Revisione video e pubblicazione social self-hosted per studi',
    description:
      'Revisione video e pubblicazione social open source e self-hosted per studi: note sul fotogramma, un editor dal vivo e post su Instagram, TikTok, YouTube e Facebook.',
    ogAlt: 'Greenlit: il marchio a semaforo, blocchi pieni di verde, ambra e blu, e il logotipo.',
    twitterAlt: 'Greenlit: revisione video e pubblicazione social self-hosted.',
    locale: 'it_IT',
  },
  chrome: {
    skip: 'Vai al contenuto',
    home: 'Greenlit, pagina iniziale',
    nav: [
      ['Libreria', 'library'],
      ['Editor', 'editor'],
      ['Revisione', 'review'],
      ['Pubblicazione', 'publishing'],
      ['Agenti', 'agents'],
      ['Self-host', 'self-host'],
    ],
    sections: 'Sezioni',
    site: 'Sito',
    overview: 'Panoramica',
    start: 'Inizia',
    docs: 'Docs',
    menu: 'Menu',
    github: 'Greenlit su GitHub',
    language: 'Lingua',
    switchTo: { code: 'EN', name: 'English', label: 'Read the site in English' },
    foot: 'Greenlit è software libero con licenza GPL-3.0-or-later. Realizzato da',
    footNav: 'Piè di pagina',
    source: 'Codice sorgente',
    licence: 'Licenza',
    contact: 'Contatti',
    film: 'Il film di Greenlit',
    filmClose: 'Chiudi il film',
    soundOn: 'Attiva l’audio',
    copy: 'Copia',
    copied: 'Copiato',
    selectCopy: 'Seleziona e copia',
  },
  schema: {
    filmName: 'Greenlit: il film',
    filmDescription:
      'Cinquanta secondi dentro Greenlit: la libreria, i formati, l’editor dal vivo, le note sul fotogramma, l’approvazione e la pubblicazione su quattro piattaforme.',
    subCategory: 'Revisione video e pubblicazione sui social',
    features: [
      'Libreria media con formati, versioni e tracce audio',
      'Revisione video con note appuntate sul fotogramma e timecode',
      'Link di condivisione monouso per la revisione dei clienti dal telefono',
      'Editor video nel browser che gira dal vivo, senza render',
      'Pubblicazione e programmazione su Instagram, Facebook, TikTok e YouTube',
      'Server MCP con 67 strumenti per agenti AI come Claude Code, Codex e Cursor',
      'API REST con documento OpenAPI',
      'Brand kit, mappa e globo, grafo di produzione, cronologia delle versioni',
    ],
  },
  home: {
    hero: {
      sr: 'Greenlit: girato, revisione e pubblicazione per studi',
      lede: 'Girato, revisione e pubblicazione per gli studi che filmano il proprio lavoro. Self-hosted, open source, e pensato perché persone e agenti AI lavorino fianco a fianco.',
      start: 'Inizia',
      film: 'Guarda il film · 0:50',
      facts: ['Gratuito e open source', 'Gira sul tuo server', '67 strumenti MCP per agenti AI'],
    },
    stage: {
      label: 'La libreria di Greenlit, registrata nell’app',
      caption:
        'La libreria: progetti, formati e anteprime che scorrono sotto il mouse. Registrata in Greenlit, niente mockup.',
    },
    statementLabel: 'Perché Greenlit',
    statement:
      'Il girato sta in un’app. Le note arrivano in chat. I montaggi vivono altrove, e i post escono da altre quattro. Greenlit mette il lavoro, le decisioni e la pubblicazione in un’unica stanza silenziosa, sul tuo server.',
    library: {
      state: 'Il girato entra',
      title: 'Una ripresa. Ogni formato.',
      lede: 'Un elemento contiene ogni forma dello stesso contenuto: il film 16:9, il reel 9:16, il post 1:1. Le versioni si combinano, come italiano o inglese con o senza watermark, e tracce audio in più viaggiano insieme per un voice-over in un’altra lingua.',
      formats: ['Principale', 'Verticale', 'Quadrato'],
      points: [
        [
          'I formati viaggiano insieme',
          'Ogni post sceglie la forma che vuole la sua piattaforma, così niente viene tagliato per sbaglio.',
        ],
        [
          'Una ricerca che ti capisce',
          'Scrivi <span class="tok">status:approved</span>, <span class="tok">#drone</span> o <span class="tok">project:</span> e scegli tra i suggerimenti.',
        ],
        ['Pronto appena carichi', 'Miniature, anteprime sotto il mouse, forme d’onda, date EXIF e luoghi.'],
        [
          'Tasto destro su tutto',
          'Trascina i file ovunque per caricarli, rinomina sul posto, agisci su una selezione.',
        ],
      ],
    },
    editor: {
      state: 'Al montaggio',
      title: 'Il montaggio gira dal vivo. Niente render.',
      lede: 'Una timeline dove le composizioni girano nel browser mentre le costruisci: video, foto, audio, testo, forme e livelli di codice che eseguono qualsiasi animazione HTML, CSS o JavaScript, fotogramma per fotogramma.',
      video: 'L’editor riproduce un teaser di 15 secondi, poi passa tra i formati 16:9, 9:16 e 1:1.',
      term: 'Un agente AI che usa gli strumenti MCP di Greenlit',
      prompt: 'Fai un taglio verticale del teaser di Coastline.',
      tools: [
        'editor_get  Coastline · teaser da 15 s',
        'editor_apply  4 operazioni · riquadro 9:16',
        'editor_frames  0:02  0:07  0:12',
      ],
      done: 'Fatto. Il formato 9:16 è pronto da controllare.',
      points: [
        [
          'Gli agenti montano con te',
          'Lo stesso documento, via MCP. Ogni editor aperto si aggiorna all’istante.',
        ],
        [
          'Keyframe e transizioni',
          'Su qualsiasi proprietà: posizione, scala, opacità, sfocatura, colore, dimensione del testo.',
        ],
        [
          'Un montaggio, ogni formato',
          'Riquadra ogni formato, o lascia che segua il soggetto dal 16:9 al 9:16.',
        ],
        [
          'Esportazioni al fotogramma',
          'Arrivano in libreria come formati di un solo elemento, collegati alle loro fonti.',
        ],
      ],
    },
    review: {
      state: 'In revisione',
      title: 'Le note finiscono sul fotogramma.',
      lede: 'Chi rivede clicca l’immagine nel momento esatto per lasciare una nota, o trascina per segnare un’area. Allega media, file o immagini incollate, e chiede modifiche come una checklist che non si può mandare vuota.',
      video:
        'Giulia trova fatte le sue note precedenti, appunta un’ultima nota sul fotogramma e approva il montaggio.',
      waiting: 'In attesa di Giulia',
      greenlit: 'Approvato da Giulia',
      meta: 'Coastline · Film principale · 0:12',
      points: [
        [
          'Con timecode, sul punto',
          'Ogni nota tiene il suo momento e il suo posto, e compare sulla barra di avanzamento.',
        ],
        [
          'Modifiche come checklist',
          'Gli admin spuntano le note, rimandano il lavoro in revisione o lo approvano da sé.',
        ],
        [
          'Revisione dal telefono',
          'Un link monouso fa entrare il tuo cliente in un solo elemento, con una scadenza.',
        ],
        [
          'Non si perde niente',
          'Titoli, note, file, post e montaggi hanno una cronologia da confrontare e ripristinare.',
        ],
      ],
    },
    moment: {
      line: 'Un clic di chi rivede, e il montaggio passa alla pubblicazione. Tutti lo vedono, nessuno deve rincorrerlo.',
      cue: 'Continua a scorrere',
    },
    publishing: {
      state: 'Programmato',
      title: 'Programmato dove c’è il tuo pubblico.',
      lede: 'Un post, quattro piattaforme, ognuna con la sua didascalia, titolo, copertina, musica e opzioni. Le programmazioni restano sulle piattaforme stesse. Accedi con gli account che usi già: niente app per sviluppatori.',
      phones: [
        ['ig', 'Reel di Instagram', '2 dic · 18:30'],
        ['fb', 'Reel di Facebook', '2 dic · 18:30'],
        ['tt', 'TikTok', '2 dic · 19:00'],
        ['yt', 'YouTube', '2 dic · 17:00'],
      ],
      calendar:
        'Il calendario dei post di novembre 2026: post programmati e pubblicati con le icone delle piattaforme.',
      points: [
        [
          'Anteprime come nelle app',
          'Guarda il reel, il post nel feed e lo short come li mostrerà ogni app.',
        ],
        [
          'La musica della piattaforma',
          'Scegli i brani dalla libreria di ogni piattaforma. Restano collegati lì.',
        ],
        [
          'Codificato per ogni posizionamento',
          'Ogni file viene ricodificato con le impostazioni che quel posizionamento preferisce.',
        ],
        [
          'Modifiche nei due sensi',
          'Cambia un post programmato in Greenlit o sulla piattaforma: restano allineati.',
        ],
      ],
    },
    more: {
      title: 'E tutto quello che sta intorno al lavoro.',
      lede: 'Le cose che uno studio usa ogni settimana, integrate e non aggiunte dopo.',
      map: [
        'Mappa e globo',
        'Progetti e media dove sono stati girati, letti dai tag GPS o posizionati a mano. La ricerca capisce <span class="tok">place:</span>.',
        'Il globo di Greenlit con le foto su Europa, Africa e Asia.',
      ],
      phone: [
        'Revisione dal telefono',
        'Il tuo cliente apre un link e decide mentre è in giro.',
        'La coda di revisione su un telefono, cinque elementi in attesa.',
      ],
      graph: [
        'Il grafo di produzione',
        'Ogni foto, still, clip e film, disposti per processo: cosa è stato girato, cosa ne è nato, dove è stato pubblicato.',
        'Il grafo di produzione per processo: riprese col drone e foto confluiscono nel film principale, nel teaser da 15 secondi e nel post.',
      ],
      brand: [
        'Brand kit',
        'Trascina la cartella di un kit. Greenlit ne legge colori, font e loghi, e lo mostra come un manuale del brand.',
        'Il brand kit di un laboratorio di ceramica: il marchio su argilla, cinque colori e i caratteri.',
      ],
      history: [
        'Una cronologia da ripristinare',
        'Chi ha cambiato cosa, dall’app o dall’API, e la strada per tornare indietro.',
        'La cronologia di un video: modifiche di stato e di formato di Giulia e Alex.',
      ],
      also: 'E poi',
      list: [
        'Link di condivisione che fanno entrare una persona in un post, elemento o progetto, e scadono',
        'Uno spazio di archiviazione che mette da parte da solo i media vecchi, un file alla volta',
        'Codice, Markdown, HTML e PDF nel visualizzatore, e i design FigCraft, dal vivo',
        'Mappe di profondità per foto e video, fatte da Greenlit o portate da te',
        'Pacchetti di temi, i tuoi loghi, italiano e inglese',
      ],
    },
    agents: {
      title: 'Pensato per persone e agenti AI.',
      lede: 'Ogni parte di Greenlit è un’API REST documentata e un server MCP. Qualsiasi agente che parla MCP può cercare in libreria, montare un video nell’editor mentre guardi, lasciare note e preparare post, con i tuoi permessi.',
      stats: [
        ['67', 'strumenti MCP'],
        ['REST', 'con un documento OpenAPI'],
        ['Live', 'API dell’editor per agenti nel browser'],
      ],
      code: 'Collega qualsiasi client MCP',
      asks: [
        'Fai un teaser verticale da 15 secondi con le riprese col drone di Coastline.',
        'Quali montaggi aspettano ancora Giulia? Riassumi le sue note.',
        'Prepara i post di venerdì per Instagram e TikTok dai reel approvati.',
      ],
    },
    self: {
      title: 'Il tuo server. Il tuo girato.',
      lede: 'Un solo progetto Docker Compose fa girare l’app, il suo database, un dispositivo Android per ciò che solo l’app di una piattaforma sa fare, e un Cloudflare Tunnel opzionale. Niente resta in ascolto su una porta pubblica.',
      points: [
        ['GPL-3.0-or-later', 'Software libero: tuo da usare, leggere e modificare.'],
        ['Fatto a moduli', 'Aggiungi, cambia o togli una parte senza toccare il resto.'],
      ],
      code: 'Avvio rapido',
      envNote: '# imposta GREENLIT_SECRET e l’URL pubblico',
      after:
        'Poi apri Greenlit, crea il primo admin con il codice di setup e invita le persone da Impostazioni → Persone. La <a class="link" href="{start}">guida per iniziare</a> ha tutti i dettagli.',
    },
    faq: {
      title: 'Domande e risposte.',
      lede: 'In breve: gratuito, self-hosted, quattro piattaforme, e pensato per lavorare con gli agenti AI.',
    },
    contact: {
      title: 'Vuoi farlo girare nel tuo studio?',
      lede: 'Greenlit è gratuito e open source. Se ti serve una mano per installarlo, una funzione pensata per il tuo team, o vuoi solo salutare, scrivimi.',
    },
  },
  faq: [
    {
      q: 'Cos’è Greenlit?',
      a: 'Greenlit è uno spazio di lavoro self-hosted e open source per gli studi che filmano il proprio lavoro: una libreria media, una stanza di revisione dove le note si appuntano sul fotogramma, un editor video nel browser che gira senza render e una scrivania di pubblicazione per Instagram, Facebook, TikTok e YouTube.',
    },
    {
      q: 'Greenlit è gratuito?',
      a: 'Sì. Greenlit è software libero con licenza GPL-3.0-or-later. Lo fai girare sul tuo server, senza abbonamento e senza prezzo per utente.',
    },
    {
      q: 'I clienti possono rivedere i video senza creare un account?',
      a: 'Sì. Un link di condivisione monouso fa entrare una persona in un elemento, un post o un progetto, con una scadenza. Funziona dal telefono: chi rivede clicca il fotogramma per lasciare una nota e approva il montaggio o chiede modifiche.',
    },
    {
      q: 'Su quali social può pubblicare Greenlit?',
      a: 'Instagram, Facebook, TikTok e YouTube: reel, post nel feed, storie, caroselli, short e video, ognuno con la sua didascalia, titolo, copertina, musica e opzioni. Le programmazioni restano sulle piattaforme stesse, e un calendario le mostra tutte.',
    },
    {
      q: 'Servono app per sviluppatori o chiavi API per le piattaforme?',
      a: 'No. Accedi con gli account che usi già. Greenlit invia le stesse richieste delle piattaforme, e per ciò che solo l’app Android di una piattaforma sa fare usa un suo dispositivo Android in Docker.',
    },
    {
      q: 'Come lavora Greenlit con gli agenti AI?',
      a: 'Greenlit ha un server MCP con 67 strumenti e un’API REST documentata, così qualsiasi client MCP (Claude Code, Codex, Cursor e altri) può cercare in libreria, montare un video nell’editor dal vivo mentre guardi, lasciare note e preparare post, con i permessi del token che gli dai.',
    },
    {
      q: 'Cosa serve per far girare Greenlit?',
      a: 'Un computer con Docker. Un solo progetto Docker Compose avvia l’app, il suo database Postgres e un emulatore Android; un Cloudflare Tunnel opzionale lo rende raggiungibile da ovunque senza aprire porte.',
    },
    {
      q: 'Greenlit sostituisce uno strumento di revisione video e uno scheduler per i social?',
      a: 'Per molti studi, sì. Spesso i team mettono insieme uno strumento di revisione come Frame.io, uno scheduler come Later o Buffer e un drive condiviso. Greenlit tiene girato, revisione, montaggio e programmazione in un’unica app self-hosted, così il lavoro approvato esce dallo stesso posto in cui è stato rivisto.',
    },
  ],
  start: {
    title: 'Installa Greenlit con Docker · Inizia',
    description:
      'Installa Greenlit, l’app open source per la revisione video e la pubblicazione social, sul tuo server con Docker Compose, poi collega il tuo agente AI.',
    h1: 'Inizia.',
    lede: 'Greenlit gira su un computer che controlli tu: un server di casa, una macchina dello studio o un piccolo VPS. Un solo progetto Docker Compose avvia tutto quello che serve.',
    terminal: 'Terminale',
    mcp: 'Configurazione del client MCP',
    steps: [
      [
        'Scarica il codice e imposta due valori',
        'Ti serve Docker con Compose. Il segreto firma le sessioni e cifra gli account collegati; l’URL pubblico è l’indirizzo che useranno le persone.',
        'Clona il repository, copia .env.example in .env e imposta GREENLIT_SECRET e GREENLIT_PUBLIC_URL.',
      ],
      [
        'Avvialo',
        'L’app, il suo database e il dispositivo Android di Greenlit partono insieme e si riavviano da soli. Aggiungi un token di Cloudflare Tunnel a <span class="tok">.env</span> per raggiungerlo da ovunque senza aprire porte.',
        'Esegui docker compose up -d --build. L’app, il suo database e un dispositivo Android partono insieme.',
      ],
      [
        'Crea il primo admin',
        'Finché non c’è un admin, il server stampa un codice di setup monouso. Apri Greenlit, inseriscilo e invita il tuo team e chi rivede da Impostazioni → Persone.',
        'Leggi il codice di setup monouso con docker compose logs app, apri Greenlit e crea l’account admin.',
      ],
      [
        'Collega un agente AI',
        'Crea un token in Impostazioni → API e MCP, poi aggiungi Greenlit al tuo client MCP: Claude Code, Codex, Cursor o qualsiasi altro. Chiedi un teaser e guarda l’editor.',
        'Crea un token in Impostazioni → API e MCP e aggiungi Greenlit a qualsiasi client MCP come server Streamable HTTP su /api/mcp.',
      ],
      [
        'Lavora su Greenlit',
        'Node 24 e pnpm. Postgres gira in Docker; l’API e l’app web girano sulla tua macchina con l’hot reload.',
        '',
      ],
    ],
    again: 'Dopo un aggiornamento, esegui di nuovo lo stesso comando.',
    devComments: ['# Postgres su :54329', '# API :4310, web :4300'],
    howTo: {
      name: 'Come installare Greenlit con Docker',
      description:
        'Fai girare Greenlit sul tuo server con Docker Compose, crea il primo admin e collega un agente AI via MCP.',
      tool: 'Docker con Compose',
    },
    more: 'Per approfondire',
    docsNote: 'La documentazione è in inglese.',
    docs: [
      ['DOCKER.md', 'Farlo girare con Docker', 'Compose, il tunnel, aggiornamenti e backup.'],
      [
        'CONNECTORS.md',
        'Collegare gli account social',
        'Come Greenlit accede a Instagram, Facebook, TikTok e YouTube.',
      ],
      ['MCP.md', 'Agenti AI e MCP', 'I token, il server MCP e cosa sanno fare gli strumenti.'],
      ['ARCHITECTURE.md', 'Com’è fatto', 'Moduli, funzioni, servizi, eventi e slot dell’interfaccia.'],
      ['DESIGN.md', 'Design system', 'Il segnale, i ruoli dei colori, i caratteri, il movimento e i testi.'],
    ],
    repo: 'Apri il repository',
    help: 'Chiedi aiuto',
  },
  lost: {
    title: 'Niente su questo fotogramma · Greenlit',
    description: 'Questa pagina non esiste. Torna a Greenlit.',
    signal: 'Un segnale che chiede modifiche',
    h1: 'Niente su questo fotogramma.',
    lede: 'La pagina che cercavi non è qui. Forse è stata spostata, o al link manca una lettera.',
    back: 'Torna a Greenlit',
  },
}
