# Estado (trabajo a medias)

- `ne/outputs/pulso/` — sitio Cloudflare Workers (vinext + React 19 + shadcn). Solo landing: `app/page.tsx`, `app/layout.tsx`. Sin ruta de API.
- `ne/work/luna/` — backend de análisis sin integrar en el sitio. `src/handler.ts` importa `./metrics.ts`, que **no existe**. `test/` está vacío.
- `ne/work/{trends,feed-probe}.json`, `live-smoke.py` — sondas manuales contra Bluesky.
- `te/` — vacío.

## Pendiente
1. Escribir `src/metrics.ts` (`calculateConcentration`, `emptyAnalysis` — el HHI descrito en el README de pulso).
2. Mover `luna/src` + `luna/app/api/analyze/route.ts` dentro de `pulso/` y ajustar los imports.
3. Conectar la landing con `POST /api/analyze`.
4. Secretos: `.env` local (excluido de Git); en producción, `wrangler secret`.
