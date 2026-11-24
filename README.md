# AMachineCo

The landing page for the A Machine Co. line of open source vehicles. It points to each vehicle's repository on Nurbly and shows its renders and three.js concept studies.

| Vehicle | Repository |
| --- | --- |
| a-car | <https://nurbly.com/adminkirk/a-car> |
| a-truck | <https://nurbly.com/adminkirk/a-truck> |
| a-bigger-truck | planned, no repository yet |

The vehicle designs live on Nurbly. This repository holds only the page. It may move to Nurbly later.

## How it is built

It is a plain static site with no build step. `index.html`, `assets/site.css` and `assets/site.js` are written by hand.

Nurbly does not allow its pages in frames or its files to be fetched from other sites, so the study mockups are copied here. `node tools/sync.mjs` does that. It

1. reads `docs/studies/` of each vehicle through Nurbly's public API,
2. copies every mockup into `studies/<vehicle>/` and records where each came from in `studies/studies.json`,
3. takes a light and a dark thumbnail of each with a headless Chrome or Edge, into `assets/thumbs/`,
4. rewrites the list of studies in `index.html` between the `studies:begin` and `studies:end` markers.

Run it whenever a vehicle publishes or changes a study. It needs Node 22 or later. Pass `--no-thumbs` to skip the thumbnails, or set `BROWSER` to the browser's path if it is not found.

```bash
node tools/sync.mjs
```

The a-truck frame render comes from `build/vehicle.png`, which `python tools/check.py --vehicle` writes in a local a-truck checkout. That file is not in the a-truck repository, so it is cropped and copied here by hand.

```bash
node tools/sync.mjs --render ../a-truck/build/vehicle.png a-truck-frame
```

When a-bigger-truck gets a repository, add it to `PROJECTS` in `tools/sync.mjs`, update its card in `index.html` and run the sync.

## Preview

The studies load three.js as modules, so open the page through a local server rather than as a file.

```bash
python -m http.server 8040
```

Then open <http://localhost:8040>.

## Hosting

The page is ready for GitHub Pages from the root of `main`. The `.nojekyll` file stops Pages from running Jekyll over it.

## Licence

This site's code is under the MIT licence in [LICENSE](LICENSE). The study mockups in `studies/` are copied from the vehicle repositories and keep their own licence, the CERN Open Hardware Licence version 2, weakly reciprocal (`CERN-OHL-W-2.0`).
