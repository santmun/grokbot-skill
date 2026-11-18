#!/usr/bin/env node
// Cliente del bridge de Grok Bot. Sin dependencias (Node 18+).
//
//   node grokbot.mjs ask "<tarea>" [--context "..."] [--file ruta]...   → imprime el request_id
//   node grokbot.mjs wait <id> [--out carpeta] [--timeout 900]          → imprime el texto y baja los archivos
//   node grokbot.mjs status <id>                                        → imprime el estado
//
// Salida: 0 ok · 1 error de auth o de API · 2 falta la URL o el token · 3 forward_failed · 4 timeout
// La URL del bridge se lee de GROKBOT_BRIDGE_URL o de ~/.config/grokbot/url.
// El token se lee de GROKBOT_BRIDGE_TOKEN o de ~/.config/grokbot/token. Nunca se imprime.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const CONFIG_DIR = join(homedir(), '.config', 'grokbot')
const URL_FILE = join(CONFIG_DIR, 'url')
const TOKEN_FILE = join(CONFIG_DIR, 'token')
const POLL_MS = 10_000

const EXIT = { ok: 0, api: 1, noToken: 2, forwardFailed: 3, timeout: 4 }

const log = msg => process.stderr.write(`${msg}\n`)

function fail(code, msg) {
  log(`grokbot: ${msg}`)
  process.exit(code)
}

// Lee un valor de una variable de entorno o, si no existe, de un archivo.
function setting(envName, file) {
  const fromEnv = process.env[envName]?.trim()
  if (fromEnv) return fromEnv
  if (existsSync(file)) {
    const fromFile = readFileSync(file, 'utf8').trim()
    if (fromFile) return fromFile
  }
  return null
}

let base
function bridge() {
  base ??= setting('GROKBOT_BRIDGE_URL', URL_FILE)?.replace(/\/+$/, '') ?? null
  if (!base) fail(EXIT.noToken, `falta la URL del bridge: define GROKBOT_BRIDGE_URL o guárdala en ${URL_FILE}`)
  if (!/^https:\/\//.test(base)) fail(EXIT.noToken, 'la URL del bridge debe empezar con https://')
  return base
}

function token() {
  const value = setting('GROKBOT_BRIDGE_TOKEN', TOKEN_FILE)
  if (value) return value
  return fail(EXIT.noToken, `falta el token: define GROKBOT_BRIDGE_TOKEN o guárdalo en ${TOKEN_FILE}`)
}

// Separa argumentos posicionales de flags; los flags repetibles se acumulan.
function parse(args, repeatable = []) {
  const pos = []
  const flags = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const value = args[i + 1]
      if (value === undefined) fail(EXIT.api, `--${key} necesita un valor`)
      i++
      if (repeatable.includes(key)) (flags[key] ??= []).push(value)
      else flags[key] = value
    } else {
      pos.push(a)
    }
  }
  return { pos, flags }
}

async function api(path, init = {}) {
  let res
  try {
    res = await fetch(`${bridge()}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token()}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    })
  } catch (err) {
    return fail(EXIT.api, `no se pudo conectar con el bridge (${err.cause?.code ?? err.message})`)
  }
  if (res.status === 401 || res.status === 403) {
    return fail(EXIT.api, `el bridge rechazó el token (HTTP ${res.status})`)
  }
  return res
}

async function json(res, what) {
  const body = await res.text()
  if (!res.ok) fail(EXIT.api, `${what} falló (HTTP ${res.status}): ${body.slice(0, 500)}`)
  try {
    return JSON.parse(body)
  } catch {
    return fail(EXIT.api, `${what}: respuesta no es JSON: ${body.slice(0, 300)}`)
  }
}

async function ask(args) {
  const { pos, flags } = parse(args, ['file'])
  const task = pos.join(' ').trim()
  if (!task) fail(EXIT.api, 'uso: ask "<tarea>" [--context "..."] [--file ruta]...')

  const files = (flags.file ?? []).map(p => {
    const full = resolve(p)
    if (!existsSync(full)) fail(EXIT.api, `no existe el archivo ${p}`)
    return { name: basename(full), content_base64: readFileSync(full).toString('base64') }
  })

  const payload = { task, ...(flags.context ? { context: flags.context } : {}), ...(files.length ? { files } : {}) }
  const res = await api('/requests', { method: 'POST', body: JSON.stringify(payload) })
  const data = await json(res, 'POST /requests')

  if (data.status === 'forward_failed') {
    fail(EXIT.forwardFailed, `Grok Bot no recibió la tarea (forward_failed): ${data.error ?? data.message ?? JSON.stringify(data)}`)
  }
  if (!data.request_id) fail(EXIT.api, `respuesta sin request_id: ${JSON.stringify(data).slice(0, 300)}`)

  log(`grokbot: tarea enviada (${data.status ?? 'pending'})`)
  process.stdout.write(`${data.request_id}\n`)
}

async function getRequest(id) {
  const res = await api(`/requests/${encodeURIComponent(id)}`)
  return json(res, `GET /requests/${id}`)
}

async function status(args) {
  const id = args[0]
  if (!id) fail(EXIT.api, 'uso: status <id>')
  const data = await getRequest(id)
  const files = (data.files ?? []).map(f => `${f.name} (${f.size ?? '?'} B)`).join(', ')
  process.stdout.write(`status: ${data.status}\n${files ? `archivos: ${files}\n` : ''}${data.text ? `\n${data.text}\n` : ''}`)
}

// Nombre de archivo seguro: sin rutas ni «..».
const safeName = name => basename(String(name)).replace(/^\.+/, '_') || 'archivo'

async function download(id, file, dir) {
  const res = await api(`/requests/${encodeURIComponent(id)}/files/${encodeURIComponent(file.name)}`)
  if (!res.ok) fail(EXIT.api, `no se pudo bajar ${file.name} (HTTP ${res.status})`)
  const path = join(dir, safeName(file.name))
  writeFileSync(path, Buffer.from(await res.arrayBuffer()))
  return path
}

async function wait(args) {
  const { pos, flags } = parse(args)
  const id = pos[0]
  if (!id) fail(EXIT.api, 'uso: wait <id> [--out carpeta] [--timeout 900]')
  const timeoutS = Number(flags.timeout ?? 900)
  if (!Number.isFinite(timeoutS) || timeoutS < 0) fail(EXIT.api, '--timeout debe ser un número de segundos')
  const out = resolve(flags.out ?? join('grokbot-results', id))
  const deadline = Date.now() + timeoutS * 1000

  let last = ''
  for (;;) {
    const data = await getRequest(id)
    if (data.status !== last) {
      log(`grokbot: ${data.status}`)
      last = data.status
    }

    if (data.status === 'done' || data.status === 'error') {
      if (data.text) process.stdout.write(`${data.text}\n`)
      const files = data.files ?? []
      if (files.length) {
        mkdirSync(out, { recursive: true })
        for (const f of files) log(`grokbot: archivo → ${await download(id, f, out)}`)
      }
      if (data.status === 'error') fail(EXIT.api, `Grok Bot devolvió error${data.text ? '' : ' sin detalle'}`)
      return
    }

    if (Date.now() + POLL_MS > deadline) {
      fail(EXIT.timeout, `sin respuesta después de ${timeoutS} s (último estado: ${data.status}). Retoma con: wait ${id}`)
    }
    await new Promise(r => setTimeout(r, POLL_MS))
  }
}

const [cmd, ...rest] = process.argv.slice(2)
const commands = { ask, wait, status }

if (!commands[cmd]) {
  fail(EXIT.api, 'comandos: ask "<tarea>" [--context ..] [--file ruta]... | wait <id> [--out carpeta] [--timeout 900] | status <id>')
}
await commands[cmd](rest)
