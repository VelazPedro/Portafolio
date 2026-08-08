# Portafolio — grafo de repositorios

Portafolio interactivo que representa los repositorios públicos de `VelazPedro` en GitHub como un grafo de nodos conectados. Sitio estático, sin backend: el análisis (metadatos, manifiestos, README) corre en build time y el navegador solo consume `public/data/graph.json`.

**Demo:** https://velazpedro.github.io/Portafolio/

## Desarrollo

```
npm install
npm run dev
```

## Pipeline de datos

Requiere `.env.local` (ver `.env.local.example`) con `GITHUB_TOKEN` y `ANTHROPIC_API_KEY`.

```
npm run pipeline:fetch       # baja metadatos crudos de GitHub -> .cache/raw/
npm run pipeline:analyze     # deriva stack, estructura y metricas -> .cache/analyzed/
npm run pipeline:summarize   # genera el informe breve con Claude -> .cache/summaries/
npm run pipeline:build-graph # calcula aristas y emite public/data/graph.json
npm run pipeline             # corre las 4 fases en orden
```

Sin `GITHUB_TOKEN`, `fetch-repos` usa la API pública sin autenticar (60 req/hora). Sin `ANTHROPIC_API_KEY`, `build-graph` genera un resumen factual sin LLM por repo (`confidence: "baja"`, sin inventar features) en vez de fallar.

Todo lo que cuelga de `.cache/` es local y no se commitea; lo único versionado es `public/data/graph.json`, que es la única fuente que consume el frontend en runtime.

## Tests

```
npm test
```

## Deploy

Configurado para GitHub Pages vía `.github/workflows/deploy.yml`: cada push a `main` corre `npm run build` y publica `dist/`. El `base` de Vite está fijado a `/Portafolio/` en `vite.config.ts` (coincide con el nombre del repo). Hay que habilitar Pages una vez en GitHub: **Settings → Pages → Source: GitHub Actions**.

## Stack

Vite + React 18 + TypeScript (strict, sin `any`), Tailwind CSS, react-force-graph-2d + d3-force, Octokit, @anthropic-ai/sdk, Zod (valida y tipa `graph.json` de punta a punta), Vitest.

## Estructura

```
/scripts     pipeline de ingesta -> analisis -> resumenes -> grafo (Node/tsx)
/config      config del portafolio (usuario, exclusiones, pesos de aristas)
/src/graph   componente de grafo (canvas, react-force-graph-2d)
/src/panel   panel de detalle expandible
/src/filters buscador y filtros
/src/views   vistas Timeline y Lista
/src/lib     tipos y schema Zod compartidos entre pipeline y frontend
```
