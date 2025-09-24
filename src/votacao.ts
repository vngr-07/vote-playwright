import { chromium, Browser, Page } from 'playwright';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const URL = 'https://vote.breaktudoawards.com/vote/serie-gl-do-ano/';
const CANDIDATO = 'Harmony Secret';
const VOTOS = 5;
const API_KEY_2CAPTCHA = process.env.API_KEY_2CAPTCHA;

const screenshotsDir = path.join(__dirname, '..', 'screenshots');
const videosDir = path.join(__dirname, '..', 'videos');

if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir);
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir);

async function solveTurnstile(siteKey: string, url: string): Promise<string> {
  const res = await axios.get(
    `http://2captcha.com/in.php?key=${API_KEY_2CAPTCHA}&method=turnstile&sitekey=${siteKey}&pageurl=${url}&json=1`
  );
  if (!res.data || res.data.status !== 1) throw new Error('Erro enviando CAPTCHA');
  const captchaId = res.data.request;

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const result = await axios.get(
      `http://2captcha.com/res.php?key=${API_KEY_2CAPTCHA}&action=get&id=${captchaId}&json=1`
    );
    if (result.data.status === 1) return result.data.request;
  }

  throw new Error('Tempo esgotado para resolver CAPTCHA');
}

(async () => {
  let browser: Browser | undefined;
  let page: Page | undefined;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--window-size=1680,1050',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1680, height: 1050 },
      recordVideo: { dir: videosDir, size: { width: 1680, height: 1050 } }
    });

    page = await context.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: path.join(screenshotsDir, 'page_loaded.png') });

    // Fecha anúncios/modais
    const dismissSelectors = [
      '#dismiss-button',
      '[aria-label="Fechar anúncio"]',
      '.ad-close',
      '.close-ad',
      '[data-dismiss="modal"]'
    ];
    for (const sel of dismissSelectors) {
      const elements = await page.$$(sel);
      for (const el of elements) {
        try { await el.click({ force: true }); await page.waitForTimeout(1000); } catch {}
      }
    }

    // Espera candidato visível
    await page.waitForSelector(`text="${CANDIDATO}"`, { state: 'visible', timeout: 20000 });

    // Encontra o botão "votar" associado ao candidato
    const candidatoVoteBtn = await page.locator(`:has-text("${CANDIDATO}") >> xpath=..`).getByRole('button', { name: /votar/i });
    if (!candidatoVoteBtn) throw new Error('Botão "votar" para o candidato não encontrado');

    // Votos
    for (let i = 1; i <= VOTOS; i++) {
      await candidatoVoteBtn.scrollIntoViewIfNeeded();
      await candidatoVoteBtn.click({ force: true });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(screenshotsDir, `vote_${i}.png`) });
    }

    // Encontra o elemento Turnstile e obtém o sitekey diretamente do data-sitekey
    let siteKey;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const turnstileElement = await page.waitForSelector('.cf-turnstile', { timeout: 15000 });
        siteKey = await turnstileElement.getAttribute('data-sitekey');
        if (siteKey) break;
      } catch {
        console.log(`⚠️ Turnstile data-sitekey não encontrado, retry ${attempt + 1}`);
      }
    }

    if (!siteKey) {
      console.log('⚠️ Turnstile não apareceu ou sitekey não encontrado, pulando CAPTCHA');
    } else {
      const captchaToken = await solveTurnstile(siteKey, URL);

      // Insere token dinamicamente
      await page.evaluate((token) => {
        let input = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
        if (!input) {
          input = document.createElement('input');
          input.type = 'hidden';
          input.name = 'cf-turnstile-response';
          document.querySelector('form')?.appendChild(input);
        }
        input.value = token;
      }, captchaToken);

      console.log('✅ CAPTCHA resolvido via 2Captcha');
    }

    // Clicar no botão ENVIAR VOTOS
    const enviarBtn = await page.getByRole('button', { name: 'ENVIAR VOTOS' });
    if (!enviarBtn) throw new Error('Botão "ENVIAR VOTOS" não encontrado');
    await enviarBtn.click({ force: true });
    await page.screenshot({ path: path.join(screenshotsDir, 'after_submit.png') });

    // Verificar sucesso
    await page.waitForTimeout(5000); // Espera um pouco para a resposta
    const bodyText = await page.textContent('body');
    if (bodyText && /votos enviados|sucesso|obrigado/i.test(bodyText))
      console.log('🎉 Votação concluída com sucesso!');
    else
      console.log('⚠️ Status de envio incerto');

    const videoPath = await page.video()?.path();
    if (videoPath) console.log(`📹 Vídeo gravado em: ${videoPath}`);

  } catch (err) {
    console.error('❌ Erro:', err);
  } finally {
    if (browser) await browser.close();
  }
})();