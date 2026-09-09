# Pulso · Opiniones en Bluesky

Landing en español para recuperar posts públicos de una tendencia y comparar sus opiniones con Cloudflare Workers AI. Servidor compatible con Cloudflare Workers, construido con el starter de Sites/Vinext.

## Uso local

```sh
npm install
cp .env.example .env
# Completar las credenciales de Workers AI en .env, sin compartirlo ni añadirlo a Git.
npm run dev
```

Para el runtime local de Cloudflare las credenciales se leen de `.dev.vars` (mismo contenido que `.env`). `npm test` ejecuta las comprobaciones del análisis con el runner de Node, sin dependencias extra.

Las credenciales son exclusivamente del servidor. Para el runtime local de Cloudflare, usar también `.dev.vars` con las mismas variables si el emulador no carga `.env`. Ambos archivos están excluidos de Git. `npm run build` genera el Worker y los assets. En Sites, las variables de producción se administran como secretos separados del código.

Cloudflare documenta la creación de un token acotado a Workers AI en [REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/). No se necesita permiso para administrar dominios, DNS ni los demás servicios de la cuenta.

## Cómo está montado

- `app/page.tsx` — landing: formulario, puntuación, distribución de posturas y muestra de posts.
- `app/api/analyze/route.ts` — `POST /api/analyze`, con las credenciales del Worker vía `cloudflare:workers`.
- `lib/analyze/url.ts` — solo acepta búsquedas, hashtags y feeds de `bsky.app`.
- `lib/analyze/bluesky.ts` — recupera destacados y recientes, deduplica, limita autores y reparte pesos.
- `lib/analyze/ai.ts` — pide a Workers AI las posturas y valida la respuesta tolerando su ruido.
- `lib/analyze/metrics.ts` — calcula el HHI ponderado, la cobertura y el nivel.

## Qué mide

Se aplica un índice de concentración HHI a la distribución de posturas identificadas por la IA: `100 × suma(proporción²)`. Un único grupo obtiene 100; dos grupos iguales, 50; cuatro iguales, 25. El resultado no mide antagonismo entre bandos y no permite inferir opinión pública representativa.

El grupo de posts destacados recibe el 95 % del peso y la muestra complementaria el 5 %. Se eliminan duplicados y se limita la presencia del mismo autor. Son decisiones iniciales del prototipo, no parámetros validados científicamente ni una defensa suficiente frente a manipulación coordinada.

Se puntúa a partir de 5 posts con postura identificable y un 60 % de cobertura ponderada. Por encima de 60 el nivel es alto, entre 35 y 60 medio, y por debajo bajo.

Los posts sin opinión identificable se tratan como desconocidos. Se muestra su peso y se exige una muestra y cobertura mínimas antes de puntuar. La clasificación de posturas requiere evaluación humana con ejemplos etiquetados antes de usar los resultados para decisiones importantes. No se infieren rasgos personales de los autores.

## Límites

- La API ofrece una muestra de búsqueda/feed; no garantiza el acceso a todos los posts ni a impresiones reales.
- Los feeds se ordenan dentro de la muestra recuperada. Un post viral no es necesariamente auténtico.
- Los resultados dependen de la consulta, la ventana temporal, el idioma, el contexto disponible y el modelo de IA.
- Un post meramente informativo, una ironía sin contexto o una imagen cuyo texto no esté disponible pueden quedar sin clasificar.
- No hay datos simulados en la interfaz. Los errores de Bluesky, de IA y de configuración se muestran como tales.
- El prototipo se publica con acceso privado. Antes de abrirlo a terceros, añadir límites por usuario y presupuesto de inferencia.

## Dos límites encontrados en pruebas reales

- **Rate limit de Bluesky.** El appview público (`api.bsky.app`) responde `403 Request forbidden by administrative rules` tras unas pocas consultas por IP en una ventana de un par de minutos. Cada análisis de búsqueda gasta dos consultas (destacados y recientes). Se cachean 120 s en el borde y el error se muestra tal cual. Para uso continuado hay que autenticarse con una sesión de Bluesky, que tiene límites mucho mayores.
- **Tamaño del modelo.** Los modelos de 8B degeneran en repetición con muestras de ~70 posts: agotan `max_tokens` y devuelven JSON truncado. El modelo por defecto es `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (~6-10 s por análisis) y se puede cambiar con la variable `AI_MODEL`. La salida estructurada (`response_format: json_schema`) se probó y se descartó: con muestras reales la decodificación guiada se atasca y la petición agota el tiempo de espera.

## Fuentes técnicas

- [Bluesky: lexicons oficiales](https://github.com/bluesky-social/atproto/tree/main/lexicons/app/bsky)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Workers AI](https://developers.cloudflare.com/workers-ai/)
