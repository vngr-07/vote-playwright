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
        try {
          await el.click({ force: true });
          await page.waitForTimeout(1000);
        } catch {}
      }
    }

    // Espera candidato visível
    await page.waitForSelector(`text="${CANDIDATO}"`, { state: 'visible', timeout: 20000 });
    const candidatoEl = await page.$(`text="${CANDIDATO}"`);
    if (!candidatoEl) throw new Error('Candidato não encontrado');

    // Votos
    for (let i = 1; i <= VOTOS; i++) {
      await candidatoEl.scrollIntoViewIfNeeded();
      await candidatoEl.click({ force: true });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(screenshotsDir, `vote_${i}.png`) });
    }

    // Clicar no botão Votar
    const votarBtn = await page.$(`button:has-text("Votar")`);
    if (!votarBtn) throw new Error('Botão "Votar" não encontrado');
    await votarBtn.click({ force: true });
    await page.screenshot({ path: path.join(screenshotsDir, 'after_click_votar.png') });

    // Fallback para Turnstile (máx 3 tentativas)
    let iframeElement;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        iframeElement = await page.waitForSelector('iframe[src*="turnstile"]', { timeout: 15000 });
        if (iframeElement) break;
      } catch {
        console.log(`⚠️ Turnstile não encontrado, retry ${attempt + 1}`);
      }
    }

    if (iframeElement) {
      const src = await iframeElement.getAttribute('src');
      if (src) {
        const match = src.match(/k=([a-zA-Z0-9_-]+)/);
        if (match) {
          const captchaToken = await solveTurnstile(match[1], URL);
          await page.evaluate((token) => {
            const input = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
            if (input) input.value = token;
          }, captchaToken);
          console.log('✅ CAPTCHA resolvido via 2Captcha');
        }
      }
    } else {
      console.log('⚠️ Turnstile não apareceu, pulando CAPTCHA');
    }

    // Confirmar envio
    const confirmBtn = await page.$('button#close-modal.close.register-votes[type="submit"]');
    if (confirmBtn) await confirmBtn.click({ force: true });
    await page.screenshot({ path: path.join(screenshotsDir, 'after_submit.png') });

    // Verificar sucesso
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
