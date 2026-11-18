# Skill grokbot para Claude Code

Un skill para que **Claude Code le delegue tareas a tu Grok Bot**: buscar y leer
posts, perfiles y tendencias en X/Twitter, investigar en la web actual, usar tus
conectores (Gmail, Notion, Drive, Calendar, Slack…) y generar o bajar archivos
(imágenes, PDFs, videos).

Le dices a Claude Code algo como *«pídeselo a Grok Bot: busca qué se está
diciendo en X sobre Claude Code esta semana»*. Claude escribe la tarea completa,
se la manda a tu Grok Bot, espera la respuesta, baja los archivos y sigue
trabajando con el resultado.

> Grok Bot **nunca envía correos, mensajes ni publica** por ti con este skill:
> si la tarea lo pide, te devuelve un borrador.

## Qué necesitas

- [Claude Code](https://claude.com/claude-code).
- Node.js 18 o más nuevo (`node --version`).
- **Tu propio Grok Bot con su bridge HTTP**: la URL del bridge y tu token.
  Cada persona usa el suyo; este repo no trae ninguna URL ni token.

## Instalar (una línea)

```bash
git clone --depth 1 https://github.com/santmun/grokbot-skill ~/.claude/skills/grokbot
```

Claude Code lo detecta solo en la siguiente sesión.

## Configurar tu bridge y tu token

Guarda la URL de tu bridge (cambia la de ejemplo por la tuya):

```bash
mkdir -p ~/.config/grokbot && printf '%s' 'https://TU-BRIDGE.workers.dev' > ~/.config/grokbot/url
```

Guarda tu token sin que quede en pantalla ni en el historial: corre esto, pega
el token y presiona Enter.

```bash
read -rs T && printf '%s' "$T" > ~/.config/grokbot/token && unset T && chmod 600 ~/.config/grokbot/token
```

También puedes usar variables de entorno en vez de archivos:
`GROKBOT_BRIDGE_URL` y `GROKBOT_BRIDGE_TOKEN`.

**No pegues tu token en el chat de Claude ni lo subas a ningún repo.**

## Probar

```bash
node ~/.claude/skills/grokbot/grokbot.mjs ask "Prueba: responde solo 'pong'"
```

Te devuelve un id. Luego:

```bash
node ~/.claude/skills/grokbot/grokbot.mjs wait <id>
```

Si imprime `pong`, ya está. O pídeselo directo a Claude Code:
*«pregúntale a Grok Bot que responda pong»*.

## Comandos del script

| Comando | Qué hace |
| --- | --- |
| `ask "<tarea>" [--context "..."] [--file ruta]...` | Manda la tarea (con archivos opcionales) e imprime el `request_id` |
| `wait <id> [--out carpeta] [--timeout 900]` | Revisa cada 10 s hasta que termine, imprime la respuesta y baja los archivos (por defecto a `./grokbot-results/<id>/`) |
| `status <id>` | Muestra el estado sin esperar |

Códigos de salida: `0` listo · `1` error de auth o de API · `2` falta la URL o el
token · `3` Grok Bot no recibió la tarea (`forward_failed`) · `4` se acabó el tiempo.

## Actualizar y desinstalar

```bash
git -C ~/.claude/skills/grokbot pull
```

```bash
rm -rf ~/.claude/skills/grokbot
```

Tu URL y tu token viven aparte, en `~/.config/grokbot/`.

## El bridge que espera el skill

Si armas tu propio bridge, esta es la API (todo con
`Authorization: Bearer <token>`, menos `/health`):

- `POST /requests` con `{ "task": "...", "context": "opcional", "files": [{ "name": "x.png", "content_base64": "..." }] }` → `{ "request_id", "status" }` (`status: "forward_failed"` si no se pudo entregar)
- `GET /requests/<id>` → `{ "status": "pending" | "working" | "done" | "error", "text", "files": [{ "name", "size", "url" }] }`
- `GET /requests/<id>/files/<name>` → el archivo
- `GET /health` → `{ "ok": true }`

## Licencia

MIT. Ver [LICENSE](LICENSE).
