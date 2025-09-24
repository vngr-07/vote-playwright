import { chromium, Browser, Page } from 'playwright';
import axios from 'axios';

const URL = 'https://vote.breaktudoawards.com/vote/serie-gl-do-ano/';
const CANDIDATO = 'Harmony Secret';
const VOTOS = 5;
const API_KEY_2CAPTCHA = process.env.API_KEY_2CAPTCHA;

async function solveTurnstile(siteKey: string, url: string): Promise<string> {
  const res = await axios.get(
    `http://2captcha.com/in.php?key=${API_KEY_2CAPTCHA}&method=turnstile&sitekey=${siteKey}&pageurl=${url}&json=1`
  );
  if (!res.data || res.data.status !== 1) throw new Error('Erro enviando CAPTCHA');
  const captchaId = res.data.request;

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const result = await axios.get(`http://2captcha.com/res.php?key=${API_KEY_2CAPTCHA}&action=get&id=${captchaId}&json=1`);
    if (result.data.status === 1) return result.data.request;
  }

  throw new Error('Tempo esgotado para resolver CAPTCHA');
}

(async () => {
  let browser: Browser | undefined;
  let page: Page | undefined;

  try {
    browser = await chromium.launch({ headless: true, args: ['--window-size=1680,1050'] });
    const context = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
    page = await context.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded' });

    const dismissSelectors = [
      '#dismiss-button',
      '[aria-label="Fechar anúncio"]',
      '.ad-close',
      '.close-ad',
      '[data-dismiss="modal"]'
    ];

    for (const sel of dismissSelectors) {
      const elements = await page.$$(sel);
      for (const el of elements) try { await el.click(); } catch {}
    }

    const candidatoEl = await page.$(`text="${CANDIDATO}"`);
    if (!candidatoEl) throw new Error('Candidato não encontrado');

    for (let i = 1; i <= VOTOS; i++) {
      await candidatoEl.scrollIntoViewIfNeeded();
      await candidatoEl.click();
      await page.waitForTimeout(1000);
    }

    const votarBtn = await page.$(`button:has-text("Votar")`);
    if (!votarBtn) throw new Error('Botão "Votar" não encontrado');
    await votarBtn.click();

    await page.waitForSelector('.cf-turnstile > div', { timeout: 15000 });
    const iframe = await page.$('iframe[src*="turnstile"]');
    if (!iframe) throw new Error('CAPTCHA Turnstile não encontrado');

    const siteKey = await iframe.getAttribute('src');
    if (!siteKey) throw new Error('Não foi possível obter sitekey do CAPTCHA');
    const match = siteKey.match(/k=([a-zA-Z0-9_-]+)/);
    if (!match) throw new Error('Sitekey não encontrado');

    const captchaToken = await solveTurnstile(match[1], URL);

    await page.evaluate((token) => {
      const input = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
      if (input) input.value = token;
    }, captchaToken);

    const confirmBtn = await page.$('button#close-modal.close.register-votes[type="submit"]');
    if (confirmBtn) await confirmBtn.click();

    const bodyText = await page.textContent('body');
    if (bodyText && /votos enviados|sucesso|obrigado/i.test(bodyText)) console.log('🎉 Votação concluída com sucesso!');
    else console.log('⚠️ Status de envio incerto');

    await page.screenshot({ path: 'votosOk.png', fullPage: true });

  } catch (err) {
    console.error('❌ Erro:', err);
  } finally {
    if (browser) await browser.close();
  }
})();
