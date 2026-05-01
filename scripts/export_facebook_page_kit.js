'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const puppeteer = require('puppeteer');

const DEFAULT_SOURCE_DIR = '/Users/Lenovo/Documents/2026/Chatbot Whatsapp/facebook/uploads';
const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'artifacts', 'facebook-page');
const DEFAULT_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function ensureFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required asset: ${filePath}`);
  }
  return filePath;
}

function wrapHtml(body, extraStyles = '') {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      --bg: #edf1f8;
      --card: #ffffff;
      --green: #4caf50;
      --green-dark: #2f8f3a;
      --text: #2c3e50;
      --muted: #68809f;
      --blue: #4b5fc2;
      --blue-dark: #231b67;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    ${extraStyles}
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}

async function screenshotPage(browser, name, html, viewport, outDir) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({
    path: path.join(outDir, name),
    type: 'png',
  });
  await page.close();
}

function buildCoverHtml(logoUrl, cardUrl) {
  return wrapHtml(
    `
      <main class="cover">
        <section class="cover-panel">
          <div class="brand-row">
            <img class="brand-logo" src="${logoUrl}" alt="Blink Premium" />
            <span class="brand-badge">Concu au Maroc pour les pharmaciens marocains</span>
          </div>

          <div class="eyebrow">BLINK PREMIUM</div>
          <h1>La gestion de votre pharmacie,<br /><span>reinventee pour le Maroc.</span></h1>
          <p>
            Stocks, ventes, caisse, fournisseurs et inventaire mobile
            dans une experience simple, fiable et moderne.
          </p>

          <div class="metric-row">
            <div class="metric-chip">13+ modules integres</div>
            <div class="metric-chip">300+ pharmacies</div>
            <div class="metric-chip">Support 7j/7</div>
          </div>
        </section>

        <aside class="visual-shell">
          <div class="orb orb-a"></div>
          <div class="orb orb-b"></div>
          <div class="visual-card">
            <img class="visual-shot" src="${cardUrl}" alt="Apercu Blink Premium" />
          </div>
        </aside>
      </main>
    `,
    `
      .cover {
        width: 1640px;
        height: 624px;
        overflow: hidden;
        background:
          radial-gradient(circle at 15% 18%, rgba(76, 175, 80, 0.16), transparent 30%),
          radial-gradient(circle at 85% 78%, rgba(38, 198, 218, 0.12), transparent 26%),
          linear-gradient(135deg, #eef2f8 0%, #ffffff 62%, #eefaf0 100%);
        display: grid;
        grid-template-columns: 1.15fr 0.85fr;
        gap: 32px;
        padding: 56px 68px;
      }
      .cover-panel {
        position: relative;
        z-index: 2;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding-right: 24px;
      }
      .brand-row {
        display: flex;
        align-items: center;
        gap: 18px;
        margin-bottom: 28px;
      }
      .brand-logo {
        width: 300px;
        height: auto;
        display: block;
      }
      .brand-badge {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 10px 18px;
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid rgba(76, 175, 80, 0.2);
        color: var(--green-dark);
        font-size: 18px;
        font-weight: 700;
      }
      .eyebrow {
        color: var(--green);
        font-weight: 800;
        letter-spacing: 0.18em;
        font-size: 17px;
        margin-bottom: 18px;
      }
      h1 {
        margin: 0 0 18px;
        font-size: 72px;
        line-height: 0.98;
        letter-spacing: -0.04em;
        font-weight: 900;
        color: #31455f;
      }
      h1 span {
        color: var(--green);
      }
      p {
        margin: 0;
        max-width: 680px;
        font-size: 28px;
        line-height: 1.45;
        color: var(--muted);
      }
      .metric-row {
        display: flex;
        gap: 14px;
        flex-wrap: wrap;
        margin-top: 34px;
      }
      .metric-chip {
        padding: 12px 18px;
        border-radius: 999px;
        background: rgba(76, 175, 80, 0.12);
        border: 1px solid rgba(76, 175, 80, 0.16);
        color: var(--green-dark);
        font-size: 18px;
        font-weight: 700;
      }
      .visual-shell {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .orb {
        position: absolute;
        border-radius: 50%;
        filter: blur(8px);
      }
      .orb-a {
        width: 420px;
        height: 420px;
        right: 90px;
        top: 60px;
        background: radial-gradient(circle, rgba(76, 175, 80, 0.22), transparent 72%);
      }
      .orb-b {
        width: 340px;
        height: 340px;
        right: 0;
        bottom: 20px;
        background: radial-gradient(circle, rgba(63, 81, 181, 0.14), transparent 72%);
      }
      .visual-card {
        position: relative;
        z-index: 2;
        width: 590px;
        padding: 18px;
        border-radius: 36px;
        background: rgba(255, 255, 255, 0.72);
        backdrop-filter: blur(16px);
        box-shadow: 0 26px 80px rgba(49, 69, 95, 0.18);
        transform: rotate(2deg);
      }
      .visual-shot {
        width: 100%;
        height: auto;
        display: block;
        border-radius: 28px;
      }
    `,
  );
}

function buildProfileHtml() {
  return wrapHtml(
    `
      <main class="profile-wrap">
        <div class="mark">
          <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <path d="M22 14h12c8 0 14 6 14 14v8c0 8-6 14-14 14H22V14z" fill="white" opacity="0.96"/>
            <path d="M22 14h8c4 0 7 3 7 7c0 4-3 7-7 7h-8V14z" fill="#43a047"/>
          </svg>
        </div>
      </main>
    `,
    `
      body {
        background: linear-gradient(135deg, #4caf50 0%, #2f8f3a 100%);
      }
      .profile-wrap {
        width: 800px;
        height: 800px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .mark {
        width: 640px;
        height: 640px;
        border-radius: 168px;
        background: linear-gradient(135deg, #4caf50 0%, #2f8f3a 100%);
        border: 20px solid rgba(255, 255, 255, 0.82);
        box-shadow: 0 28px 96px rgba(0, 0, 0, 0.22);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      svg {
        width: 280px;
        height: 280px;
        display: block;
      }
    `,
  );
}

async function main() {
  const sourceDir = process.argv[2] || DEFAULT_SOURCE_DIR;
  const outDir = process.argv[3] || DEFAULT_OUTPUT_DIR;

  fs.mkdirSync(outDir, { recursive: true });

  const logoPath = ensureFile(path.join(sourceDir, 'logo Blinkpremium.png'));
  const heroCardPath = ensureFile(path.join(sourceDir, 'pasted-1777098129011-0.png'));

  const logoUrl = pathToFileURL(logoPath).href;
  const heroCardUrl = pathToFileURL(heroCardPath).href;

  const launchOptions = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };

  const configuredChromePath =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROME_PATH ||
    (fs.existsSync(DEFAULT_CHROME_PATH) ? DEFAULT_CHROME_PATH : '');

  if (configuredChromePath) {
    launchOptions.executablePath = configuredChromePath;
  }

  const browser = await puppeteer.launch(launchOptions);

  try {
    await screenshotPage(
      browser,
      'facebook-cover.png',
      buildCoverHtml(logoUrl, heroCardUrl),
      { width: 1640, height: 624, deviceScaleFactor: 1 },
      outDir,
    );

    await screenshotPage(
      browser,
      'facebook-profile.png',
      buildProfileHtml(),
      { width: 800, height: 800, deviceScaleFactor: 1 },
      outDir,
    );
  } finally {
    await browser.close();
  }

  console.log(`Facebook kit exported to ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
