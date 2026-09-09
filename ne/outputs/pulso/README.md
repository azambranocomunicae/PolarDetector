# Pulso · Opiniones en Bluesky

Landing en español para recuperar posts públicos de una tendencia y comparar sus opiniones con Cloudflare Workers AI. Servidor compatible con Cloudflare Workers, construido con el starter de Sites/Vinext.

## Uso local

```sh
npm install
cp .env.example .env
# Completar las credenciales de Workers AI en .env, sin compartirlo ni añadirlo a Git.
npm run dev
```

Las credenciales son exclusivamente del servidor. Para el runtime local de Cloudflare, usar también `.dev.vars` con las mismas variables si el emulador no carga `.env`. Ambos archivos están excluidos de Git. `npm run build` genera el Worker y los assets. En Sites, las variables de producción se administran como secretos separados del código.

Cloudflare documenta la creación de un token acotado a Workers AI en [REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/). No se necesita permiso para administrar dominios, DNS ni los demás servicios de la cuenta.

## Qué mide

Se aplica un índice de concentración HHI a la distribución de posturas identificadas por la IA: `100 × suma(proporción²)`. Un único grupo obtiene 100; dos grupos iguales, 50; cuatro iguales, 25. El resultado no mide antagonismo entre bandos y no permite inferir opinión pública representativa.

El grupo de posts destacados recibe el 95 % del peso y la muestra complementaria el 5 %. Se eliminan duplicados y se limita la presencia del mismo autor. Son decisiones iniciales del prototipo, no parámetros validados científicamente ni una defensa suficiente frente a manipulación coordinada.

Los posts sin opinión identificable se tratan como desconocidos. Se muestra su peso y se exige una muestra y cobertura mínimas antes de puntuar. La clasificación de posturas requiere evaluación humana con ejemplos etiquetados antes de usar los resultados para decisiones importantes. No se infieren rasgos personales de los autores.

## Límites

- La API ofrece una muestra de búsqueda/feed; no garantiza el acceso a todos los posts ni a impresiones reales.
- Los feeds se ordenan dentro de la muestra recuperada. Un post viral no es necesariamente auténtico.
- Los resultados dependen de la consulta, la ventana temporal, el idioma, el contexto disponible y el modelo de IA.
- Un post meramente informativo, una ironía sin contexto o una imagen cuyo texto no esté disponible pueden quedar sin clasificar.
- No hay datos simulados en la interfaz. Los errores de Bluesky, de IA y de configuración se muestran como tales.
- El prototipo se publica con acceso privado. Antes de abrirlo a terceros, añadir límites por usuario y presupuesto de inferencia.

## Fuentes técnicas

- [Bluesky: lexicons oficiales](https://github.com/bluesky-social/atproto/tree/main/lexicons/app/bsky)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Workers AI](https://developers.cloudflare.com/workers-ai/)
