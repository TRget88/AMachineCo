#!/usr/bin/env node
// Pulls the three.js study mockups from each vehicle repository on Nurbly into
// studies/, takes a light and a dark thumbnail of each, and rewrites the list of
// studies in index.html between the studies:begin and studies:end markers.
//
//   node tools/sync.mjs                 pull, take thumbnails, rewrite index.html
//   node tools/sync.mjs --no-thumbs     skip the thumbnails (no browser needed)
//   node tools/sync.mjs --render <png> <name>
//                                       crop a SolidCraft render into assets/renders/<name>.webp
//
// Needs Node 22 or later. Thumbnails need Chrome, Chromium or Edge. Set BROWSER
// to its path if it is not in a usual place.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://nurbly.com/v1/repos";
const WEB = "https://nurbly.com";

// The vehicles whose studies appear on the page, in page order.
// a-bigger-truck has no repository yet. Add it here once it has one.
const PROJECTS = [
  { slug: "a-car", repo: "adminkirk/a-car" },
  { slug: "a-truck", repo: "adminkirk/a-truck" },
];

const THUMB = { width: 720, height: 450, scale: 2, quality: 82 };

// ---------------------------------------------------------------- Nurbly

async function contents(repo, path) {
  const res = await fetch(`${API}/${repo}/contents/${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${repo}/${path}: HTTP ${res.status}`);
  return res.json();
}

async function fileText(repo, path) {
  const d = await contents(repo, path);
  if (!d?.file || d.file.is_lfs_pointer) return null;
  const { content, encoding } = d.file;
  return encoding === "base64" ? Buffer.from(content, "base64").toString("utf8") : content;
}

// Two layouts are supported. a-truck keeps docs/studies/<name>.html next to
// <name>.md. a-car keeps docs/studies/<unit>/mockup.html next to README.md.
async function listStudies(repo) {
  const dir = await contents(repo, "docs/studies");
  const entries = dir?.entries ?? [];
  const names = new Set(entries.map((e) => e.name));
  const found = [];
  for (const e of entries) {
    if (e.name.startsWith("_")) continue;
    if (e.kind === "blob" && e.name.endsWith(".html")) {
      const slug = e.name.slice(0, -5);
      found.push({
        slug,
        mockup: e.path,
        writeup: names.has(`${slug}.md`) ? `docs/studies/${slug}.md` : null,
      });
    } else if (e.kind === "tree") {
      const sub = await contents(repo, e.path);
      const subNames = new Set((sub?.entries ?? []).map((s) => s.name));
      if (!subNames.has("mockup.html")) continue;
      found.push({
        slug: e.name,
        mockup: `${e.path}/mockup.html`,
        writeup: subNames.has("README.md") ? `${e.path}/README.md` : null,
      });
    }
  }
  return { ref: dir?.git_ref ?? "main", studies: found.sort((a, b) => a.slug.localeCompare(b.slug)) };
}

// The title is the write-up's first heading. The summary is the first
// paragraph under its "question" heading, which every study opens with.
function describe(md, html, slug) {
  const htmlTitle = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();
  let title = htmlTitle || slug;
  let question = "";
  if (md) {
    const lines = md.split(/\r?\n/);
    const h1 = lines.find((l) => /^#\s+/.test(l));
    if (h1) title = h1.replace(/^#\s+/, "").trim();
    const qi = lines.findIndex((l) => /^#{2,4}\s+.*question/i.test(l));
    if (qi >= 0) {
      const para = [];
      for (const l of lines.slice(qi + 1)) {
        if (!l.trim()) { if (para.length) break; else continue; }
        if (/^#/.test(l)) break;
        para.push(l.trim());
      }
      question = plain(para.join(" "));
    }
  }
  return { title, question };
}

function plain(md) {
  return md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------- page

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function studyCard(project, s) {
  const thumb = `assets/thumbs/${project.slug}-${s.slug}`;
  const hasThumb = existsSync(join(ROOT, `${thumb}-light.webp`));
  const media = hasThumb
    ? `<picture>
              <source srcset="${thumb}-dark.webp" media="(prefers-color-scheme: dark)">
              <img src="${thumb}-light.webp" alt="" width="${THUMB.width}" height="${THUMB.height}" loading="lazy" decoding="async">
            </picture>`
    : `<span class="study__noshot">${esc(s.title)}</span>`;
  const writeup = s.writeup
    ? `<a href="${WEB}/${project.repo}/tree/${s.writeup}" rel="noopener">Write-up on Nurbly <span aria-hidden="true">↗</span></a>`
    : "";
  return `        <li class="study">
          <a class="study__shot" href="${s.page}" data-viewer data-title="${esc(s.title)}" data-project="${project.slug}" data-source="${WEB}/${project.repo}/tree/${s.writeup ?? s.mockup}">
            ${media}
            <span class="study__open">Open in 3D</span>
          </a>
          <div class="study__body">
            <p class="eyebrow">${esc(project.slug)}</p>
            <h4>${esc(s.title)}</h4>
            ${s.question ? `<p class="study__q">${esc(s.question)}</p>` : ""}
            <p class="study__links">${writeup}</p>
          </div>
        </li>`;
}

function studiesHtml(results) {
  const groups = results.map(({ project, studies }) => {
    const count = studies.length;
    const body = count
      ? `      <ul class="study-grid">\n${studies.map((s) => studyCard(project, s)).join("\n")}\n      </ul>`
      : `      <p class="study-empty">No mockups published yet. The first concept studies are in progress on <a href="${WEB}/${project.repo}" rel="noopener">Nurbly</a>.</p>`;
    return `    <div class="study-group" id="studies-${project.slug}">
      <h3 class="study-group__title">${esc(project.slug)} <span>${count} ${count === 1 ? "study" : "studies"}</span></h3>
${body}
    </div>`;
  });
  return groups.join("\n");
}

async function rewriteIndex(results) {
  const file = join(ROOT, "index.html");
  const html = await readFile(file, "utf8");
  const begin = "<!-- studies:begin -->";
  const end = "<!-- studies:end -->";
  const a = html.indexOf(begin);
  const b = html.indexOf(end);
  if (a < 0 || b < a) throw new Error("index.html has no studies:begin and studies:end markers");
  const out = `${html.slice(0, a + begin.length)}\n${studiesHtml(results)}\n    ${html.slice(b)}`;
  await writeFile(file, out);
}

// ---------------------------------------------------------------- browser

function findBrowser() {
  const list = process.env.BROWSER
    ? [process.env.BROWSER]
    : [
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/microsoft-edge",
      ];
  return list.find((p) => existsSync(p)) ?? null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, ms, what) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// A small Chrome DevTools Protocol client over Node's built in WebSocket.
class Browser {
  static async launch(path) {
    const profile = await mkdtemp(join(tmpdir(), "amachineco-"));
    const proc = spawn(path, [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--mute-audio",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "about:blank",
    ], { stdio: "ignore" });
    proc.on("error", (e) => console.error(`could not start ${path}: ${e.message}`));
    const portFile = join(profile, "DevToolsActivePort");
    await waitFor(async () => existsSync(portFile) && (await readFile(portFile, "utf8")).includes("\n"), 20000, "the browser to start");
    const [port, path2] = (await readFile(portFile, "utf8")).split(/\r?\n/);
    const b = new Browser(proc, profile, `ws://127.0.0.1:${port}${path2}`);
    await b.open();
    return b;
  }

  constructor(proc, profile, url) {
    Object.assign(this, { proc, profile, url, id: 0, pending: new Map() });
  }

  open() {
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error("could not connect to the browser")), 10000);
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => { clearTimeout(timer); res(); };
      this.ws.onerror = (e) => { clearTimeout(timer); rej(e.error ?? new Error("WebSocket error")); };
      this.ws.onclose = () => {
        for (const p of this.pending.values()) p.reject(new Error("the browser closed the connection"));
        this.pending.clear();
      };
      this.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        const p = m.id && this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      };
    });
  }

  // Every call gives up after a while, so a stuck page cannot hang the sync.
  send(method, params = {}, sessionId, ms = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, ms);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  async page({ width, height, scale, dark }) {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m, p) => this.send(m, p, sessionId);
    await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
    await s("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }],
    });
    const evaluate = async (expression) =>
      (await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
    return { s, evaluate, close: () => this.send("Target.closeTarget", { targetId }) };
  }

  async close() {
    // The browser often exits before it answers Browser.close, so do not wait long.
    await this.send("Browser.close", {}, undefined, 2000).catch(() => {});
    this.ws?.close();
    await sleep(300);
    this.proc.kill();
    await rm(this.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".jpg": "image/jpeg",
};

// The studies load three.js as modules, so they are served over HTTP, not file://.
function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    if (!path.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(path);
      res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

async function thumbnails(browser, base, project, studies) {
  for (const s of studies) {
    for (const dark of [false, true]) {
      const out = join(ROOT, "assets/thumbs", `${project.slug}-${s.slug}-${dark ? "dark" : "light"}.webp`);
      const p = await browser.page({ width: THUMB.width, height: THUMB.height, scale: THUMB.scale, dark });
      try {
        await p.s("Page.navigate", { url: `${base}/${s.page}` });
        await waitFor(() => p.evaluate("document.readyState === 'complete' && !!document.querySelector('canvas')"), 30000, `${s.page} to draw`);
        // Hide the study's side panel so the thumbnail shows only the model.
        await p.evaluate(`(() => {
          const st = document.createElement('style');
          st.textContent = '#panel{display:none!important}';
          document.head.append(st);
          dispatchEvent(new Event('resize'));
        })()`);
        await sleep(700);
        const { data } = await p.s("Page.captureScreenshot", { format: "webp", quality: THUMB.quality });
        await writeFile(out, Buffer.from(data, "base64"));
        console.log(`  thumb  ${out.slice(ROOT.length + 1)}`);
      } finally {
        await p.close();
      }
    }
  }
}

// ---------------------------------------------------------------- main

async function sync({ thumbs }) {
  const results = [];
  const manifest = { source: WEB, synced: new Date().toISOString(), projects: [] };
  for (const project of PROJECTS) {
    const { ref, studies } = await listStudies(project.repo);
    console.log(`${project.repo} (${ref}), ${studies.length} studies`);
    const outDir = join(ROOT, "studies", project.slug);
    await rm(outDir, { recursive: true, force: true });
    const done = [];
    for (const s of studies) {
      const html = await fileText(project.repo, s.mockup);
      if (!html) { console.warn(`  skip   ${s.mockup} (not readable)`); continue; }
      const md = s.writeup ? await fileText(project.repo, s.writeup) : null;
      const page = `studies/${project.slug}/${s.slug}.html`;
      await mkdir(outDir, { recursive: true });
      await writeFile(join(ROOT, page), html);
      console.log(`  copy   ${s.mockup} -> ${page}`);
      done.push({ ...s, ...describe(md, html, s.slug), page });
    }
    results.push({ project, studies: done });
    manifest.projects.push({ ...project, ref, studies: done });
  }

  await mkdir(join(ROOT, "studies"), { recursive: true });
  await writeFile(join(ROOT, "studies/studies.json"), JSON.stringify(manifest, null, 2) + "\n");

  if (thumbs) {
    const path = findBrowser();
    if (!path) {
      console.warn("No Chrome, Chromium or Edge found, so no thumbnails. Set BROWSER or pass --no-thumbs.");
    } else {
      await mkdir(join(ROOT, "assets/thumbs"), { recursive: true });
      const server = await serve();
      const browser = await Browser.launch(path);
      try {
        const base = `http://127.0.0.1:${server.address().port}`;
        for (const r of results) await thumbnails(browser, base, r.project, r.studies);
      } finally {
        await browser.close();
        server.close();
      }
    }
  }

  await rewriteIndex(results);
  console.log("index.html updated");
}

// Crops the middle of a SolidCraft render (vehicle.png from tools/check.py) to a 16 by 10 frame.
async function render(src, name) {
  const path = findBrowser();
  if (!path) throw new Error("--render needs Chrome, Chromium or Edge. Set BROWSER.");
  const browser = await Browser.launch(path);
  try {
    const p = await browser.page({ width: 2400, height: 1600, scale: 1, dark: false });
    // Draw the image at the page's top left corner, at its own size.
    const data64 = (await readFile(resolve(src))).toString("base64");
    await p.evaluate(`(() => {
      document.documentElement.style.background = '#fff';
      document.body.style.margin = '0';
      const img = new Image();
      img.style.display = 'block';
      img.src = 'data:image/png;base64,${data64}';
      document.body.append(img);
    })()`);
    await waitFor(() => p.evaluate("!!document.images[0]?.complete && document.images[0].naturalWidth > 0"), 10000, "the image");
    const [w, h] = await p.evaluate("[document.images[0].naturalWidth, document.images[0].naturalHeight]");
    const cw = Math.round(w * 0.62), ch = Math.round(cw / 1.6);
    const clip = { x: Math.round((w - cw) / 2), y: Math.round((h - ch) / 2), width: cw, height: ch, scale: 1 };
    const { data } = await p.s("Page.captureScreenshot", { format: "webp", quality: 85, clip });
    await mkdir(join(ROOT, "assets/renders"), { recursive: true });
    const out = join(ROOT, "assets/renders", `${name}.webp`);
    await writeFile(out, Buffer.from(data, "base64"));
    console.log(`wrote ${out.slice(ROOT.length + 1)}`);
    await p.close();
  } finally {
    await browser.close();
  }
}

const args = process.argv.slice(2);
try {
  if (args[0] === "--render") {
    if (args.length !== 3) throw new Error("usage: node tools/sync.mjs --render <png> <name>");
    await render(args[1], args[2]);
  } else {
    await sync({ thumbs: !args.includes("--no-thumbs") });
  }
} catch (e) {
  console.error(e.message ?? e);
  process.exit(1);
}
