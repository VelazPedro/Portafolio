# Portafolio — grafo de repositorios

Portafolio interactivo que representa los repositorios de GitHub de `VelazPedro` como un grafo de nodos conectados. Sitio estático, sin backend, con análisis 100% estático en build time.

Estado: scaffold inicial (Fase 1). Grafo funcionando con datos mock en `public/data/graph.json`.

## Desarrollo

```
npm install
npm run dev
```

## Pipeline de datos (pendiente de implementar)

```
npm run pipeline        # orquesta fetch -> analyze -> summarize -> build-graph
```

Requiere `.env.local` (ver `.env.local.example`) con `GITHUB_TOKEN` y `ANTHROPIC_API_KEY`.

## Stack

Vite + React 18 + TypeScript, Tailwind CSS, react-force-graph-2d + d3-force, Octokit, @anthropic-ai/sdk, Zod, Vitest.
