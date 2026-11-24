// A Machine Co. landing page. Opens the three.js studies in a dialog, and
// swaps the hero picture for the live study once it has drawn.

const viewer = document.getElementById("viewer");
const frame = document.getElementById("viewer-frame");
const titleEl = document.getElementById("viewer-title");
const projectEl = document.getElementById("viewer-project");
const fullEl = document.getElementById("viewer-full");
const sourceEl = document.getElementById("viewer-source");

function openStudy(link) {
  titleEl.textContent = link.dataset.title || "Study";
  projectEl.textContent = link.dataset.project || "";
  fullEl.href = link.href;
  sourceEl.href = link.dataset.source || "#";
  sourceEl.hidden = !link.dataset.source;
  frame.src = link.href;
  viewer.showModal();
  frame.focus();
}

if (viewer && typeof viewer.showModal === "function") {
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a[data-viewer]");
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openStudy(link);
  });
  document.getElementById("viewer-close").addEventListener("click", () => viewer.close());
  viewer.addEventListener("click", (e) => { if (e.target === viewer) viewer.close(); });
  viewer.addEventListener("close", () => { frame.src = "about:blank"; });
}

// The hero study is loaded once the page is idle. The study's own side panel
// is hidden, and the frame stays non-interactive so the page still scrolls.
function embedHero() {
  const stage = document.querySelector(".stage[data-embed]");
  if (!stage || location.protocol === "file:") return;
  if (window.matchMedia("(max-width: 520px)").matches) return;
  const view = stage.querySelector(".stage__view");
  const iframe = document.createElement("iframe");
  iframe.title = "Live 3D view of the a-truck frame concept";
  iframe.tabIndex = -1;
  iframe.setAttribute("aria-hidden", "true");
  iframe.addEventListener("load", () => {
    let doc;
    try { doc = iframe.contentDocument; } catch { return; }
    if (!doc?.head) return;
    const style = doc.createElement("style");
    style.textContent = "#panel{display:none!important}";
    doc.head.append(style);
    iframe.contentWindow.dispatchEvent(new Event("resize"));
    const start = performance.now();
    const ready = () => {
      if (doc.querySelector("canvas")) {
        setTimeout(() => iframe.classList.add("is-ready"), 250);
      } else if (performance.now() - start < 15000) {
        setTimeout(ready, 150);
      }
    };
    ready();
  });
  iframe.src = stage.dataset.embed;
  view.insertBefore(iframe, view.querySelector(".stage__open"));
}

if ("requestIdleCallback" in window) requestIdleCallback(embedHero, { timeout: 2000 });
else window.addEventListener("load", () => setTimeout(embedHero, 300));
