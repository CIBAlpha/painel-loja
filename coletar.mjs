// Robô do Painel da Loja
// 1) Entra no Gcom pela tela de login normal (como uma pessoa faria)
// 2) Puxa os números de vendas do dia
// 3) Grava no banco do Supabase
import { chromium } from 'playwright';

const env = process.env;
// Limpa espaços e quebras de linha esquecidas no config.env
for (const k of Object.keys(env)) if (/^(GCOM_|SUPABASE_)/.test(k) && typeof env[k] === 'string') env[k] = env[k].trim();

// Loja fechada: das 2h às 10h (horário de Brasília) o robô não faz nada
const horaBR = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
if (horaBR >= 2 && horaBR < 10 && !env.FORCAR) { console.log(`São ${horaBR}h: loja fechada, pulando.`); process.exit(0); }

const obrig = ['GCOM_EMPRESA', 'GCOM_USUARIO', 'GCOM_SENHA', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
for (const k of obrig) if (!env[k]) { console.error(`Falta o segredo ${k}`); process.exit(1); }

const ETB = env.GCOM_ID_ETB || '3606';                 // unidade Alphaville
const MRC = env.GCOM_ID_MRC || '120,187,188,231';      // marcas
const QTD_MRC = MRC.split(',').length;
const API = 'https://www2.gcom.com.br/api/GcomDashboardService/Dashlet/';
const SB = env.SUPABASE_URL.replace(/\/$/, '');

const hojeBR = () => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date()); // dd/mm/aaaa
const iso = (br) => { const [d, m, a] = br.split('/'); return `${a}-${m}-${d}`; };
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

async function loginGcom() {
  // Usa o Google Chrome já instalado no PC; se não achar, usa o navegador do Playwright
  let browser;
  // Abre o Chrome normal, com janela (o Gcom bloqueia o modo escondido)
  const headless = false;
  try { browser = await chromium.launch({ channel: 'chrome', headless }); }
  catch { console.log('Chrome não encontrado, usando o Chromium do Playwright'); browser = await chromium.launch({ headless }); }
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'pt-BR' });
  page.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url().slice(0, 120)); });
  page.on('requestfailed', (r) => console.log('Falha de rede:', r.url().slice(0, 120), r.failure()?.errorText));
  try {
    await page.goto('https://www2.gcom.com.br/novoerp/', { waitUntil: 'domcontentloaded' });
    const senha = page.locator('input[type="password"]').first();
    await senha.waitFor({ state: 'visible', timeout: 60000 });
    // A tela tem 3 campos visíveis, nesta ordem: Empresa, Usuário, Senha
    const campos = page.locator('input:visible:not([type="hidden"]):not([type="checkbox"])');
    const n = await campos.count();
    console.log('Campos visíveis na tela de login:', n);
    await campos.nth(0).fill(env.GCOM_EMPRESA);
    await campos.nth(1).fill(env.GCOM_USUARIO);
    await senha.fill(env.GCOM_SENHA);
    await page.getByRole('button', { name: /login|entrar/i }).first().click();
    await page.waitForFunction(() => !!localStorage.getItem('jwtToken'), null, { timeout: 60000 });
    return await page.evaluate(() => {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      return { token: localStorage.getItem('jwtToken'), emp: u.id_emp_gcom, pes: u.id_pes_usu };
    });
  } catch (e) {
    console.error('Falhou no login. Endereço atual:', page.url());
    try {
      console.error('Título:', await page.title());
      console.error('Texto da tela:', (await page.locator('body').innerText()).slice(0, 600).replace(/\s+/g, ' '));
      console.error('Inputs:', JSON.stringify(await page.$$eval('input', (els) => els.map((e) => [e.type, e.placeholder, e.offsetParent !== null]))));
      const html = await page.content();
      console.error('Tamanho do HTML:', html.length, '| início:', html.slice(0, 300).replace(/\s+/g, ' '));
    } catch {}
    await page.screenshot({ path: 'erro-login.png', fullPage: true }).catch(() => {});
    throw e;
  } finally {
    await browser.close();
  }
}

async function gcom(ctx, endpoint, body) {
  const r = await fetch(API + endpoint, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + ctx.token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gcom ${endpoint} respondeu ${r.status}`);
  return r.json();
}

async function supa(tabela, linhas, upsert = false) {
  const r = await fetch(`${SB}/rest/v1/${tabela}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      // chaves novas (sb_secret_...) vão só no apikey; chaves antigas (JWT) também no Authorization
      ...(env.SUPABASE_SERVICE_KEY.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY }),
      'Content-Type': 'application/json',
      Prefer: upsert ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal',
    },
    body: JSON.stringify(linhas),
  });
  if (!r.ok) throw new Error(`Supabase ${tabela}: ${r.status} ${await r.text()}`);
}

async function status(ok, mensagem) {
  try { await supa('robo_status', [{ id: 1, ultima_execucao: new Date().toISOString(), ok, mensagem }], true); }
  catch (e) { console.error('Não consegui gravar o status:', e.message); }
}

async function main() {
  const ctx = await loginGcom();
  const hoje = hojeBR();
  const base = { ID_EMP_GCOM: ctx.emp, ID_PES_USU: ctx.pes, ID_VISAO: 1, ID_ETB_GCOM: Number(ETB), ID_MRC: MRC, DT_DE: hoje, DT_ATE: hoje };

  const [comparativo, origem, atendimento, pagamento] = await Promise.all([
    gcom(ctx, 'DashletComparativoVendas', { ID_ETB_GCOM: ETB, ID_MRC: MRC, QTD_MRC }),
    gcom(ctx, 'OrigemPedido', { ...base, ID_DASHLET: 15, TIPO_GRAFICO: 'Valor' }),
    gcom(ctx, 'TipoAtendimento', { ...base, ID_DASHLET: 11 }),
    gcom(ctx, 'VendaFormaPagamentoDashlet', { ...base, ID_DASHLET: 10 }),
  ]);

  const diaAtual = comparativo.find((c) => c.data === hoje) || comparativo[0];
  const ontem = comparativo.find((c) => /anterior/i.test(c.titulo) && c.data.length === 10);
  const dia = iso(hoje);

  await supa('vendas_snapshot', [{
    dia, vl_fat: num(diaAtual?.vl_fat), tc: num(diaAtual?.tc), tm: num(diaAtual?.tm),
    dados: { comparativo, origem, atendimento, pagamento },
  }]);

  const linhasDia = [{
    dia, vl_fat: num(diaAtual?.vl_fat), tc: num(diaAtual?.tc), tm: num(diaAtual?.tm),
    origem, atendimento, pagamento, atualizado_em: new Date().toISOString(),
  }];
  await supa('vendas_dia', linhasDia, true);
  // Ontem vai separado (tem menos campos; misturar na mesma gravação dá erro no Supabase)
  if (ontem) await supa('vendas_dia', [{ dia: iso(ontem.data), vl_fat: num(ontem.vl_fat), tc: num(ontem.tc), tm: num(ontem.tm), atualizado_em: new Date().toISOString() }], true);

  await status(true, `FAT R$ ${diaAtual?.vl_fat} | ${diaAtual?.tc} pedidos`);
  console.log('OK', hoje, diaAtual);
}

main().catch(async (e) => {
  console.error('ERRO:', e.message);
  await status(false, e.message.slice(0, 300));
  process.exit(1);
});
