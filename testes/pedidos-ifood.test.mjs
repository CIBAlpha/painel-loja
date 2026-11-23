// Testes do ouvinte de pedidos iFood — só dados inventados.
// Não chama o iFood nem o Supabase: o Gestor e o banco são falsos.
// Usa as funções de limpeza de verdade do kit (KIT_DIR aponta para a pasta dele).
import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarKit, criarGravador, criarSupabase, ouvir } from '../pedidos-ifood.mjs';

const kitReal = carregarKit();

const PEDIDO_INVENTADO = {
  id: 'pedido-teste-1', displayId: '4321', merchant: { id: 'loja-teste-1', name: 'Loja Inventada' },
  createdAt: '2026-11-23T18:00:00Z', orderType: 'DELIVERY', orderTiming: 'IMMEDIATE',
  total: { subTotal: 80, deliveryFee: 7, benefits: 10, orderAmount: 77 },
  payments: { methods: [{ method: 'CREDIT', type: 'ONLINE' }] },
  items: [{ name: 'Yakisoba Teste', quantity: 2, totalPrice: 80 }],
  customer: { id: 'cliente-x', name: 'Fulano Inventado', phone: { number: '11999990000' }, documentNumber: '12345678900' },
  delivery: { deliveryAddress: { streetName: 'Rua Inventada', streetNumber: '99' } }
};

function bancoFalso({ falharVezes = 0 } = {}) {
  const gravacoes = [];
  let falhas = falharVezes;
  const gravar = async (tabela, linhas, opcoes = {}) => {
    if (falhas > 0) { falhas--; throw new Error('Supabase fora do ar (falso)'); }
    gravacoes.push({ tabela, linhas, opcoes });
  };
  return { gravar, gravacoes };
}

test('pedido gravado sem nenhum dado do cliente', async () => {
  const banco = bancoFalso();
  const g = criarGravador({ kit: kitReal, gravar: banco.gravar });
  g.pedido(PEDIDO_INVENTADO);
  await g.descarregar();
  assert.equal(banco.gravacoes.length, 1);
  const { tabela, linhas } = banco.gravacoes[0];
  assert.equal(tabela, 'pedidos_ifood');
  assert.equal(linhas[0].id, 'pedido-teste-1');
  assert.equal(linhas[0].numero, '4321');
  assert.equal(linhas[0].total, 77);
  assert.deepEqual(linhas[0].itens, [{ nome: 'Yakisoba Teste', qtd: 2, total: 80 }]);
  const texto = JSON.stringify(banco.gravacoes);
  assert.ok(!/Fulano|11999990000|12345678900|Rua Inventada|cliente-x/.test(texto), 'vazou dado do cliente: ' + texto);
});

test('eventos: grava uma vez só e a situação não volta no tempo', async () => {
  const banco = bancoFalso();
  const g = criarGravador({ kit: kitReal, gravar: banco.gravar });
  const ev = (code, quando) => ({ orderId: 'pedido-teste-1', merchantId: 'loja-teste-1', code, createdAt: quando });
  g.eventos([ev('PLC', '2026-11-23T18:00:00Z'), ev('DSP', '2026-11-23T18:30:00Z')]);
  g.eventos([ev('PLC', '2026-11-23T18:00:00Z')]);             // o Gestor repete: ignorado
  g.eventos([ev('CFM', '2026-11-23T18:05:00Z')]);             // chegou atrasado: não volta a situação
  await g.descarregar();
  const historico = banco.gravacoes.filter(x => x.tabela === 'pedidos_ifood_eventos').flatMap(x => x.linhas);
  assert.deepEqual(historico.map(x => x.codigo), ['PLACED', 'DISPATCHED', 'CONFIRMED']);
  assert.ok(banco.gravacoes.filter(x => x.tabela === 'pedidos_ifood_eventos').every(x => x.opcoes.ignorarRepetidos));
  const situacoes = banco.gravacoes.filter(x => x.tabela === 'pedidos_ifood').map(x => x.linhas[0].situacao);
  assert.deepEqual(situacoes, ['PLACED', 'DISPATCHED']);
});

test('motivo do cancelamento entra, outros dados do evento não', async () => {
  const banco = bancoFalso();
  const g = criarGravador({ kit: kitReal, gravar: banco.gravar });
  g.eventos([{ orderId: 'p2', merchantId: 'm1', code: 'CAN', createdAt: '2026-11-23T19:00:00Z', metadata: { reasonCode: 'SEM_ITEM', phone: '11988887777' } }]);
  await g.descarregar();
  const linha = banco.gravacoes[0].linhas[0];
  assert.equal(linha.codigo, 'CANCELLED');
  assert.equal(linha.motivo, 'SEM_ITEM');
  assert.ok(!JSON.stringify(banco.gravacoes).includes('11988887777'));
});

test('status da loja só é gravado quando muda', async () => {
  const banco = bancoFalso();
  const g = criarGravador({ kit: kitReal, gravar: banco.gravar });
  const aberta = [{ operation: 'DELIVERY', state: 'OK', available: true }];
  const fechada = [{ operation: 'DELIVERY', state: 'CLOSED', available: false, validations: [{ state: 'ERROR', code: 'fora.horario', message: { title: 'Fora do horário' } }] }];
  g.status('loja-teste-1', aberta); g.status('loja-teste-1', aberta); g.status('loja-teste-1', fechada);
  await g.descarregar();
  const linhas = banco.gravacoes.map(x => x.linhas[0]);
  assert.equal(linhas.length, 2);
  assert.equal(linhas[0].disponivel, true);
  assert.equal(linhas[1].disponivel, false);
  assert.match(linhas[1].motivo, /Fora do horário/);
});

test('Supabase fora do ar: guarda na fila e grava depois, na ordem', async () => {
  const banco = bancoFalso({ falharVezes: 2 });
  const avisos = [];
  const g = criarGravador({ kit: kitReal, gravar: banco.gravar, log: t => avisos.push(t) });
  g.pedido(PEDIDO_INVENTADO);
  g.eventos([{ orderId: 'pedido-teste-1', merchantId: 'loja-teste-1', code: 'PLC', createdAt: '2026-11-23T18:00:00Z' }]);
  await g.descarregar(); await g.descarregar();
  assert.equal(banco.gravacoes.length, 0);
  assert.equal(g.tamanhoFila(), 3);
  await g.descarregar();
  assert.deepEqual(banco.gravacoes.map(x => x.tabela), ['pedidos_ifood', 'pedidos_ifood_eventos', 'pedidos_ifood']);
  assert.ok(avisos.some(t => /tento de novo/.test(t)));
});

test('laço: Gestor fechado espera e tenta de novo; conectado entrega pedidos', async () => {
  const banco = bancoFalso();
  let tentativas = 0, voltas = 0;
  const escutaFalsa = { ligada: () => voltas < 2, fechar: () => {}, obterAcesso: () => ({ authorization: 'Bearer TOKEN-SECRETO-FALSO' }) };
  const kitFalso = {
    ...kitReal,
    conectar: async ganchos => {
      tentativas++;
      if (tentativas === 1) throw new Error('Gestor de Pedidos não encontrado na porta 9222.');
      ganchos.aoPedido(PEDIDO_INVENTADO);
      ganchos.aoEventos([{ orderId: 'pedido-teste-1', merchantId: 'loja-teste-1', code: 'PLC', createdAt: '2026-11-23T18:00:00Z' }]);
      ganchos.aoStatus('loja-teste-1', [{ operation: 'DELIVERY', state: 'OK', available: true }]);
      return escutaFalsa;
    }
  };
  const log = [];
  await ouvir({ kit: kitFalso, gravar: banco.gravar, log: t => log.push(t), esperar: async () => { voltas++; }, continuar: () => !(tentativas >= 2 && voltas >= 2) });
  assert.equal(tentativas, 2);
  const tabelas = banco.gravacoes.map(x => x.tabela);
  assert.ok(tabelas.includes('pedidos_ifood') && tabelas.includes('pedidos_ifood_eventos') && tabelas.includes('lojas_ifood_status'));
  const situacao = banco.gravacoes.filter(x => x.tabela === 'robo_status').map(x => x.linhas[0]);
  assert.equal(situacao[0].ok, false);
  assert.equal(situacao[0].id, 2);
  assert.ok(situacao.some(s => s.ok === true));
  // O token nunca aparece em nada que o programa grava ou mostra.
  assert.ok(!JSON.stringify(banco.gravacoes).includes('TOKEN-SECRETO') && !log.join('\n').includes('TOKEN-SECRETO'));
});

test('Supabase: endereço, chave e upsert certos (sem rede)', async () => {
  const chamadas = [];
  const buscar = async (url, opcoes) => { chamadas.push({ url, opcoes }); return { ok: true, text: async () => '' }; };
  const gravar = criarSupabase({ url: 'https://exemplo.supabase.co/', chave: 'sb_secret_inventada', buscar });
  await gravar('pedidos_ifood_eventos', [{ pedido_id: 'p1' }], { conflito: 'pedido_id,codigo,quando', ignorarRepetidos: true });
  assert.equal(chamadas[0].url, 'https://exemplo.supabase.co/rest/v1/pedidos_ifood_eventos?on_conflict=pedido_id,codigo,quando');
  assert.match(chamadas[0].opcoes.headers.Prefer, /ignore-duplicates/);
  assert.equal(chamadas[0].opcoes.headers.Authorization, undefined);
  assert.throws(() => criarSupabase({ url: '', chave: '' }), /config\.env/);
  const erro = criarSupabase({ url: 'https://exemplo.supabase.co', chave: 'x', buscar: async () => ({ ok: false, status: 401, text: async () => 'nao autorizado' }) });
  await assert.rejects(() => erro('pedidos_ifood', [{}]), /401/);
});
