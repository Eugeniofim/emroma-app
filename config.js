/* Identidade deste app: o UNICO lugar que sabe qual banco usar e de quem
   e o app. cloud.js, auth.js, store.js e app.js leem daqui e nao trazem
   nenhum endereco, nome ou marca fixos.

   Vazio em supabaseUrl = o app roda so no aparelho, sem nuvem. E como a
   Ingrid ve o app antes de existir banco no nome dela.

   Para ligar a nuvem: criar o projeto no Supabase NA CONTA DELA, rodar
   SEGURANCA.sql no editor SQL e preencher os dois campos abaixo. */
var APP_CONFIG = {
  /* NUVEM LIGADA em 02/10/2026: projeto "emroma" (Supabase, org Ti Artes do Eugênio,
     Irlanda). SEGURANCA.sql rodado. A chave abaixo é a "publishable" (pública por
     desenho — quem protege os dados é a RLS). Quando o projeto passar para a
     conta da Ingrid, basta trocar estes dois campos. */
  supabaseUrl: 'https://wayyctstytbjjissqsnp.supabase.co',
  supabaseKey: 'sb_publishable_GugBRA81omXmlqbbS6wJcw_6pUWAnh4',

  /* App zerado para a Ingrid trabalhar: começa sem clientes, reservas, guias
     e parceiros de exemplo. O catálogo de passeios, os preços e os pontos de
     encontro (dados reais dela) continuam. false = volta a demonstração cheia. */
  semExemplos: true,

  /* Cofre (repositorio guia-cofre, no Supabase do Eugenio): o assistente
     "ao vivo" usa o Claude de verdade por ali, com limite por dia, sem a
     Ingrid colar chave nenhuma. Vazio = o assistente roda so com os pedidos
     prontos (modo demonstracao). Na entrega, troca pela chave dela. */
  cofre: 'https://uopfqlogjzuqpabptxkb.supabase.co/functions/v1/cofre',
  clienteCofre: 'ingrid',

  guia: {
    nome: 'Ingrid',
    negocio: 'EmRoma',
    cidade: 'Roma, Itália',
    whats: '+393515631485',
    /* o link curto do WhatsApp dela (Beacons), reserva se o numero sumir */
    whatsLink: 'https://wa.me/message/7OEQNA5R5RMYG1',
    insta: 'em_roma',
    /* O selo dela. Dois arquivos: o claro para fundo escuro, o escuro para
       fundo claro. Sem isto o app desenha um anel com a inicial do negocio. */
    logo:       'arte/logo-ingrid.png',
    logoEscuro: 'arte/logo-ingrid-escuro.png',
    badge: 'Acompanhante Turística Habilitada',   /* as palavras dela, do Instagram */
    prefixo: 'ER',                 /* codigo da reserva: ER-4821 */
    /* As secoes do portfolio dela. O catalogo de Roma esta pronto; as
       outras cidades ela mesma acrescenta pelo painel, sem nos. */
    regioes: [
      ['roma',      'Roma',              'Rome'],
      ['forade',    'Fora de Roma',      'Out of Rome'],
      ['transfer',  'Transfers',         'Transfers'],
      ['italia',    'Outras cidades',    'Other cities'],
    ],
  },
};
