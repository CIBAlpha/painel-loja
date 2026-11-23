// Ouvinte de pedidos do iFood — Painel da Loja
//
// Fica ligado o tempo todo no PC da loja e usa o Gestor iFood Kit
// (C:\pc-loja\vendor\gestor-ifood-kit) para ouvir o Gestor de Pedidos:
//   - cada pedido novo vai para a tabela pedidos_ifood (SEM dados do cliente:
//     passa sempre pelo pedidoLimpo do kit);
//   - cada mudança de situação (confirmado, saiu, entregue, cancelado...) vai
//     para pedidos_ifood_eventos e atualiza a situação do pedido;
//   - se cada loja está aberta ou fechada vai para lojas_ifood_status;
//   - a cada 5 min grava em robo_status (id 2) se está ouvindo ou não.
//
// O token do iFood fica só dentro do kit, em memória. Este programa nunca lê,
// grava nem mostra o token. Ele só fala com o Supabase.
//
// Isto NÃO é a API oficial do iFood: se parar de funcionar, avise o Claude.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ESPERA_RECONEXAO_MS = 30000;
const INTERVALO_SITUACAO_MS = 5 * 60000;
const LIMITE_FILA = 2000;
const ID_STATUS = 2;   // robo_status: 1 = robô do Gcom, 2 = este ouvinte

export function carregarKit(pasta = process.env.KIT_DIR || path.join(AQUI, 'vendor', 'gestor-ifood-kit')) {
  const require = createRequire(import.meta.url);
  return require(path.join(pasta, 'src', 'index.js'));
}

const dataOuNulo = v => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);

// ------------------------------------------------ formato das linhas do banco --
export function linhaPedido(p, agora = new Date()) {
  return {
    id: p.id, numero: p.numero || null, merchant_id: p.merchantId || null, loja: p.merchantNome || null,
    criado_em: dataOuNulo(p.criadoEm), tipo: p.tipo || null, agendado: p.agendado,
    subtotal: p.subtotal, taxa_entrega: p.taxaEntrega, descontos: p.descontos, total: p.total,
    pagamento: p.pagamento || null, itens: p.itens, atualizado_em: agora.toISOString()
  };
}
export function linhaEvento(e) {
  return { pedido_id: e.pedido, merchant_id: e.merchantId || null, codigo: e.codigo, quando: dataOuNulo(e.quando), motivo: e.motivo || null };
}
export function linhaStatus(s, agora = new Date()) {
  return { merchant_id: s.merchantId, estado: s.estado || null, disponivel: s.disponivel, codigos: s.codigos, motivo: s.motivo || null, atualizado_em: agora.toISOString() };
}

// ----------------------------------------------------------------- Supabase --
export function criarSupabase({ url, chave, buscar = fetch }) {
  const base = String(url || '').trim().replace(/\/$/, '');
  chave = String(chave || '').trim();
  if (!/^https:\/\//.test(base) || !chave) throw new Error('Falta SUPABASE_URL ou SUPABASE_SERVICE_KEY no config.env.');
  return async function gravar(tabela, linhas, { conflito = '', ignorarRepetidos = false } = {}) {
    const r = await buscar(`${base}/rest/v1/${tabela}${conflito ? '?on_conflict=' + conflito : ''}`, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: {
        apikey: chave,
        ...(chave.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + chave }),
        'Content-Type': 'application/json',
        Prefer: (ignorarRepetidos ? 'resolution=ignore-duplicates' : 'resolution=merge-duplicates') + ',return=minimal'
      },
      body: JSON.stringify(linhas)
    });
    if (!r.ok) throw new Error(`Supabase ${tabela}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  };
}

// ---------------------------------------------------- recebe e grava em fila --
// Tudo que chega do Gestor entra numa fila e é gravado em ordem. Se o Supabase
// falhar, a fila guarda e tenta de novo depois (nada se perde numa queda curta).
export function criarGravador({ kit, gravar, log = () => {}, agora = () => new Date() }) {
  const fila = [];
  const eventosVistos = new Set();
  const situacaoAtual = new Map();   // pedido -> horário da última situação gravada
  const lojas = new Map();           // merchantId -> resumo do último status gravado
  let gravando = false;

  const colocar = (tabela, linhas, opcoes) => {
    if (fila.length >= LIMITE_FILA) { fila.shift(); log('Fila cheia: a gravação mais antiga foi descartada.'); }
    fila.push({ tabela, linhas, opcoes });
  };

  return {
    pedido(bruto) {
      const p = kit.pedidoLimpo(bruto);   // aqui o nome, telefone e endereço do cliente ficam para trás
      if (!p) return;
      colocar('pedidos_ifood', [linhaPedido(p, agora())]);
      log(`Pedido ${p.numero} | ${p.merchantNome} | R$ ${p.total}`);
    },
    eventos(lista) {
      const novos = [];
      for (const bruto of Array.isArray(lista) ? lista : []) {
        const e = kit.eventoLimpo(bruto);
        if (!e || !e.codigo) continue;
        const linha = linhaEvento(e);
        if (!linha.quando) continue;
        const chave = `${linha.pedido_id}|${linha.codigo}|${linha.quando}`;
        if (eventosVistos.has(chave)) continue;   // o Gestor repete eventos: grava uma vez só
        if (eventosVistos.size > 20000) eventosVistos.clear();
        eventosVistos.add(chave);
        novos.push(linha);
      }
      if (!novos.length) return;
      colocar('pedidos_ifood_eventos', novos, { conflito: 'pedido_id,codigo,quando', ignorarRepetidos: true });
      // A situação do pedido só anda para frente no tempo (evento velho não sobrescreve novo).
      for (const linha of [...novos].sort((a, b) => Date.parse(a.quando) - Date.parse(b.quando))) {
        const anterior = situacaoAtual.get(linha.pedido_id);
        if (anterior && Date.parse(anterior) > Date.parse(linha.quando)) continue;
        situacaoAtual.set(linha.pedido_id, linha.quando);
        if (situacaoAtual.size > 20000) situacaoAtual.delete(situacaoAtual.keys().next().value);
        colocar('pedidos_ifood', [{ id: linha.pedido_id, merchant_id: linha.merchant_id, situacao: linha.codigo, situacao_em: linha.quando, atualizado_em: agora().toISOString() }]);
        log(`Pedido ${linha.pedido_id.slice(0, 8)}… → ${linha.codigo}${linha.motivo ? ' (' + linha.motivo + ')' : ''}`);
      }
    },
    status(merchantId, dados) {
      const s = kit.statusLimpo(merchantId, dados);
      if (!s) return;
      const resumo = JSON.stringify([s.estado, s.disponivel, s.codigos, s.motivo]);
      if (lojas.get(s.merchantId) === resumo) return;   // só grava quando muda
      lojas.set(s.merchantId, resumo);
      colocar('lojas_ifood_status', [linhaStatus(s, agora())]);
      log(`Loja ${s.merchantId.slice(0, 8)}… ${s.disponivel ? 'ABERTA' : 'FECHADA'}${s.motivo ? ' — ' + s.motivo : ''}`);
    },
    situacao(ok, mensagem) {
      colocar('robo_status', [{ id: ID_STATUS, ultima_execucao: agora().toISOString(), ok, mensagem: String(mensagem).slice(0, 300) }]);
    },
    // Grava o que está na fila. Para no primeiro erro e tenta de novo na próxima vez.
    async descarregar() {
      if (gravando) return;
      gravando = true;
      try {
        while (fila.length) {
          const item = fila[0];
          try { await gravar(item.tabela, item.linhas, item.opcoes); fila.shift(); }
          catch (e) { log('Não gravei no Supabase (tento de novo): ' + e.message); return; }
        }
      } finally { gravando = false; }
    },
    tamanhoFila: () => fila.length
  };
}

// ------------------------------------------------------------ laço principal --
export async function ouvir({ kit, gravar, log = () => {}, esperar = ms => new Promise(ok => setTimeout(ok, ms)), continuar = () => true, agora = () => new Date() }) {
  const g = criarGravador({ kit, gravar, log, agora });
  let ultimaSituacao = 0;
  const marcarSituacao = (ok, msg, forcar = false) => {
    if (forcar || Date.now() - ultimaSituacao >= INTERVALO_SITUACAO_MS) { ultimaSituacao = Date.now(); g.situacao(ok, msg); }
  };
  while (continuar()) {
    let escuta;
    try {
      escuta = await kit.conectar({ log, aoPedido: o => g.pedido(o), aoEventos: l => g.eventos(l), aoStatus: (id, d) => g.status(id, d) });
    } catch (e) {
      log('Gestor indisponível: ' + e.message);
      marcarSituacao(false, 'Gestor de Pedidos fechado ou deslogado');
      await g.descarregar();
      await esperar(ESPERA_RECONEXAO_MS);
      continue;
    }
    log('Ouvindo o Gestor de Pedidos.');
    marcarSituacao(true, 'Ouvindo o Gestor de Pedidos', true);
    while (continuar() && escuta.ligada()) {
      await g.descarregar();
      marcarSituacao(true, 'Ouvindo o Gestor de Pedidos');
      await esperar(5000);
    }
    escuta.fechar();
    if (continuar()) {
      log('A conexão com o Gestor caiu. Tentando de novo...');
      marcarSituacao(false, 'Conexão com o Gestor caiu', true);
      await g.descarregar();
      await esperar(5000);   // pausa curta para não ficar tentando sem parar
    }
  }
  await g.descarregar();
  return g;
}

// ------------------------------------------------- log com tamanho limitado --
function criarLog(arquivo) {
  return texto => {
    const linha = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + '  ' + texto;
    console.log(linha);
    try {
      if (fs.existsSync(arquivo) && fs.statSync(arquivo).size > 2 * 1024 * 1024) fs.renameSync(arquivo, arquivo + '.antigo');
      fs.appendFileSync(arquivo, linha + '\n');
    } catch (_) { /* log é só ajuda: nunca derruba o programa */ }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const log = criarLog(path.join(AQUI, 'pedidos-ifood-log.txt'));
  try {
    const kit = carregarKit();
    const gravar = criarSupabase({ url: process.env.SUPABASE_URL, chave: process.env.SUPABASE_SERVICE_KEY });
    log('Ouvinte de pedidos iFood iniciado.');
    await ouvir({ kit, gravar, log });
  } catch (e) {
    log('ERRO: ' + e.message);
    process.exitCode = 1;
  }
}
