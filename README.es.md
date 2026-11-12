# fastpanel-mcp

> Habla con tu servidor [FastPanel 2](https://fastpanel.direct/) desde Claude, Cursor o cualquier cliente compatible con MCP. Crea sitios, aprovisiona bases de datos, adjunta SSL, refuerza configuraciones nginx — mediante lenguaje natural, con salvaguardas de seguridad de nivel productivo.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue.svg)](https://modelcontextprotocol.io/)
[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](./CHANGELOG.md)

**Palabras clave:** FastPanel, MCP, Model Context Protocol, Claude Code, Claude Desktop, gestión de servidores, hosting automation, nginx, Let's Encrypt, DevOps, LLM ops, AI sysadmin, administración de servidores, automatización de alojamiento, infraestructura en la nube, despliegue web.

**Leer en otros idiomas:** [English](./README.md) · [Русский](./README.ru.md) · [Українська](./README.uk.md) · [Español](./README.es.md) · [Deutsch](./README.de.md)

> La documentación canónica se mantiene en inglés; las traducciones pueden estar desactualizadas.

---

## Qué obtienes

Pídele a un LLM y obtén cambios reales en la infraestructura de tu servidor FastPanel:

> **Tú:** "Crea un nuevo sitio `foo.example.com` bajo el usuario `www-root`, PHP 8.4, sin base de datos, y adjunta nuestro certificado SSL wildcard. También activa HTTP/2 y HTTP/3."
>
> **LLM (~30 segundos, 5 llamadas a herramientas después):** El sitio con id 53 está en producción en https://foo.example.com con HTTP/2, HTTP/3, TLS wildcard y una redirección HTTPS aprovisionada automáticamente.

> **Tú:** "Muéstrame la configuración nginx del sitio 1 — comprueba si bloquea `.env`, `.git` y otras rutas sensibles. Si no, añade refuerzo."
>
> **LLM:** Lee la configuración, observa que `.env` y `.htaccess` se sirven como archivos estáticos (brecha de seguridad), edita el frontend para añadir reglas de denegación para dotfiles + extensiones sensibles + archivos de framework, previsualiza el diff mediante `dry_run` y luego lo despliega. `.env` ahora devuelve 404; `.well-known/acme-challenge` sigue funcionando.

> **Tú:** "¿Qué sitios están corriendo en este servidor, quiénes son sus propietarios y cuáles no fuerzan HTTPS?"
>
> **LLM:** Consulta `sites_list` e informa de los 5 sitios sin `https_redirect: true`.

## Características

- **39 herramientas** que cubren sitios, dominios de correo y buzones, bases de datos (incluido volcado/importación por SSH), usuarios, zonas DNS, certificados SSL, carga del sistema, cola, registros de sitios, planes de copia de seguridad, diagnósticos a nivel de host, subida/despliegue de archivos en la raíz web de un sitio, y configuraciones raw de nginx/apache/php.ini.
- **Modelo de seguridad de doble token.** Las operaciones de lectura usan un token de solo lectura; las operaciones de escritura requieren un token de escritura separado (`FASTPANEL_WRITE_TOKEN`). Si no defines el token de escritura, cada herramienta de escritura falla de forma cerrada.
- **`confirm: true` requerido** en cada escritura. Las salidas accidentales del LLM no pueden mutar el estado.
- **`dry_run: true` previsualiza** el cuerpo HTTP exacto que recibiría el servidor — contraseñas redactadas como `***`, sin llamada de red.
- **Modo de respuesta compacta** en sites_list para evitar desbordar el contexto del LLM en paneles grandes.
- **Registro de auditoría en stderr** para cada escritura ejecutada, con contraseñas redactadas.
- **Anotaciones de herramientas MCP** (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`) para que los clientes y escáneres de política clasifiquen cada herramienta correctamente en lugar de tratar los diagnósticos de solo lectura como destructivos.
- **Autovalidación con `nginx -t` y reversión automática** — `site_configuration_update` valida la configuración en vivo tras aplicarla y revierte automáticamente una edición incorrecta cuando SSH está configurado.
- **Probado contra un panel FastPanel 2 en producción** con más de 35 sitios.

## Por qué existe esto

FastPanel no publica ninguna especificación OpenAPI. Los endpoints y las formas de carga útil de este servidor fueron obtenidos por ingeniería inversa del bundle de la SPA Angular del panel y capturas en vivo de DevTools, incluyendo particularidades no obvias como:

- Los endpoints de lista requieren parámetros envueltos `filter[limit]=…&filter[type]=…` — el uso simple de `?limit=…` se ignora silenciosamente.
- La creación de sitios es un asistente de dos pasos (`POST /api/master/domain` sonda → `PUT /api/master`), no un `POST /api/sites` convencional.
- El campo `backend` en la configuración del sitio es la configuración del pool PHP-FPM cuando `handler=php_fpm`, pero un bloque Apache VirtualHost cuando `handler=fcgi`.
- El flujo de adjuntar/desadjuntar SSL pasa por `PUT /api/sites/{id}` (lado del sitio), no por `POST /api/sites/{id}/certificate` (ese endpoint no existe).

Todo esto está documentado en las descripciones de las herramientas para que el LLM no tenga que redescubrirlo.

## Requisitos

- Node.js 20 o superior
- Una instalación de FastPanel 2 accesible vía HTTPS
- SSH root en el host del panel para crear tokens de API (una sola vez)

## Instalación

```bash
git clone https://github.com/iMateo/fastpanel-mcp.git
cd fastpanel-mcp
pnpm install      # o: npm install
pnpm build
```

## Obtener tokens de API

En el host de FastPanel (como root), crea un token de solo lectura para el uso cotidiano:

```bash
mogwai users tokens add -n mcp-read -s read_only -e 2030-12-31
```

> El binario del CLI es `/usr/local/fastpanel2/fastpanel`; las versiones recientes de FastPanel lo exponen en `PATH` como `mogwai` (`/usr/local/bin/mogwai` → el mismo binario). Documentación antigua lo llama `fastpanel`, que **no** está en `PATH` — usa `mogwai`, o la ruta completa. Solo root.

Copia el campo `msg` del JSON devuelto — ese es tu token. Omite la 2FA y sobrevive a los TTL de sesión, así que trátalo como una credencial del servidor.

Token de escritura opcional, con fecha de vencimiento y bloqueo por IP:

```bash
mogwai users tokens add -n mcp-write -c <tu-ip> -e 2030-12-31
```

Deja `FASTPANEL_WRITE_TOKEN` sin definir en las configuraciones donde no necesites escrituras.

## Configuración

```bash
cp .env.example .env
```

`.env` mínimo viable:

```
FASTPANEL_URL=https://panel.example.com:8888
FASTPANEL_TOKEN=<tu token de lectura>
FASTPANEL_INSECURE_TLS=1   # solo si el panel usa un certificado autofirmado
```

## Uso con Claude Code

```bash
claude mcp add fastpanel \
  -s user \
  -e "FASTPANEL_URL=https://panel.example.com:8888" \
  -e "FASTPANEL_TOKEN=…" \
  -e "FASTPANEL_INSECURE_TLS=1" \
  -- node $PWD/dist/index.js
```

Añade `-e "FASTPANEL_WRITE_TOKEN=…"` cuando quieras activar las herramientas de escritura.

## Uso con Claude Desktop / Cursor / otros clientes MCP

`claude_desktop_config.json` (o equivalente):

```json
{
  "mcpServers": {
    "fastpanel": {
      "command": "node",
      "args": ["/absolute/path/to/fastpanel-mcp/dist/index.js"],
      "env": {
        "FASTPANEL_URL": "https://panel.example.com:8888",
        "FASTPANEL_TOKEN": "…",
        "FASTPANEL_INSECURE_TLS": "1"
      }
    }
  }
}
```

## Depuración

Inspecciona las herramientas con la interfaz gráfica del MCP Inspector:

```bash
pnpm inspect
```

Controla JSON-RPC sobre stdio manualmente:

```bash
FASTPANEL_URL=… FASTPANEL_TOKEN=… node scripts/smoke.mjs
```

## Herramientas

### Lectura (no requiere token de escritura)

| Herramienta | Endpoint | Devuelve |
|---|---|---|
| `sites_list` | `GET /api/sites/list` | Todos los sitios web, 13 campos esenciales por defecto (modo compacto) |
| `site_get` | `GET /api/sites/{id}` | Objeto completo del sitio con 40 campos (certificado, backend, copias de seguridad, estadísticas) |
| `site_configuration_get` | `GET /api/sites/{id}/configuration` | nginx raw (frontend), backend del handler (PHP-FPM o Apache), php.ini |
| `databases_list` | `GET /api/databases` | Bases de datos MySQL + PostgreSQL con propietarios y tamaños |
| `database_servers_list` | `GET /api/databases/servers` | Servidores de BD disponibles — usa los ids en `database_create` |
| `users_list` | `GET /api/users` | Usuarios del panel y propietarios de sitios |
| `dns_domains_list` | `GET /api/dns/domains` | Zonas DNS (vacío si el DNS del panel está desactivado) |
| `dns_records_list` | `GET /api/dns/domain/{id}/records` | Registros de una zona |
| `certificates_list` | `GET /api/certificates` | Certificados SSL almacenados (LE + personalizados) |
| `system_load` | `GET /api/loads/full` | CPU / memoria / disco / promedios de carga / procesos principales |
| `queue_list` | `GET /api/queue/list` | Tareas en segundo plano, incluidas las completadas |
| `queue_active` | `GET /api/queue` | Solo tareas en vuelo (filtra las finalizadas) + `meta.all_done` para sondeo determinista |
| `site_logs` | `GET /api/sites/{id}/log/{lines}/{type}` | Cola de registros de acceso o error de nginx/apache (frontend_/backend_) sin SSH |
| `site_resources` | `GET /api/sites/{id}/resources` | Bases de datos, subdominios, zonas DNS y de correo adjuntas a un sitio |
| `backup_plans_list` | `GET /api/v2/backup/plans` | Planes de copia de seguridad configurados |
| `me` | `GET /api/me` | Cuenta asociada al token de lectura actual (usuario, roles, ssh) |
| `settings_get` | `GET /api/settings` | Configuración global del panel (SO, licencia, límites, notificaciones) |
| `email_domains_list` | `GET /api/email/domains` | Listar dominios de correo (opcionalmente de un sitio); los ids se usan en las herramientas de buzones |
| `email_domain_dkim_get` | `GET /api/email/domains/{id}/dkim` | Registro DNS DKIM (TXT con la clave pública) de un dominio de correo |
| `mailboxes_list` | `GET /api/email/domains/{id}/boxs` | Buzones de un dominio: tamaño, cuota, redirecciones, alias, opciones (compacto por defecto) |
| `mailbox_get` | `GET /api/mail/box/{id}` | Un buzón, objeto completo. Las contraseñas nunca se devuelven — FastPanel no permite leerlas |
| `mailbox_password_get` | macOS Keychain | Contraseña de un buzón desde el almacén de contraseñas **local** (Llavero de macOS). Opcional mediante `FASTPANEL_PASSWORD_STORE=keychain`; solo conoce las contraseñas establecidas a través de este MCP |

### Escritura (requieren `FASTPANEL_WRITE_TOKEN` + `confirm: true` explícito)

| Herramienta | Endpoint | Propósito |
|---|---|---|
| `user_create` | `POST /api/users` | Crear un nuevo usuario del panel (propietario de sitio) |
| `database_create` | `POST /api/databases` | Crear una base de datos MySQL o PostgreSQL con un usuario de BD dedicado |
| `site_create` | `POST /api/master/domain` + `PUT /api/master` | Crear un sitio de forma atómica, opcionalmente con usuario / base de datos / FTP en línea |
| `site_update` | `PUT /api/sites/{id}` | Cambiar la raíz de documentos (`index_dir`) / índice de directorio — p. ej. apuntar un sitio Laravel a `public/` (preajuste `framework: "laravel"`) |
| `site_ssl_update` | `PUT /api/sites/{id}` | Adjuntar / reemplazar / desadjuntar un certificado SSL, activar/desactivar HTTPS / HTTP2 / HTTP3 / HSTS |
| `site_backend_update` | `PUT /api/sites/backend/{backend_id}` | Cambiar versión de PHP, handler, puerto, socket, variables de entorno (pasa el id del sitio — el id del backend se resuelve internamente) |
| `site_configuration_update` | `PUT /api/sites/{id}/configuration` | Reemplazar nginx/apache/php.ini raw del sitio. **Peligroso**: una sintaxis incorrecta puede romper el sitio — cuando SSH está configurado, ejecuta `nginx -t` tras aplicar y **revierte automáticamente** en caso de fallo (`validate: false` para omitir) |
| `certificate_create_letsencrypt` | `POST /api/certificates` | Emitir un nuevo certificado Let's Encrypt (asíncrono — sondea `queue_active`) |
| `mailbox_create` | `POST /api/email/domains/{id}/boxs` | Crear un buzón con redirecciones / alias / cuota. `generate_password: true` genera una contraseña fuerte y la devuelve **una sola vez** |
| `mailbox_update` | `PUT /api/mail/box/{id}` | Restablecer la contraseña (opcionalmente generada, mostrada una vez), activar/desactivar, cambiar cuota / redirecciones / alias — solo cambian los campos indicados |

### Almacén de contraseñas de buzones (opcional)

FastPanel no permite volver a leer la contraseña de un buzón: ni la API ni la CLI la devuelven (internamente guarda un hash unidireccional para IMAP más una copia reversible que solo el propio proceso del panel puede descifrar, para su propio autologin de Roundcube). Así que conectar un nuevo cliente a un buzón técnico existente normalmente implica restablecer la contraseña y romper todo lo demás que la usa. Define `FASTPANEL_PASSWORD_STORE=keychain` (solo macOS) y cada contraseña establecida mediante `mailbox_create` / `mailbox_update` — generada o explícita — se guardará también en tu llavero de inicio de sesión (servicio `fastpanel-mcp:<host del panel>`, cuenta = dirección del buzón; visible en Acceso a Llaveros). `mailbox_password_get` la recupera y `mailboxes_list` marca cada buzón con `password_stored`.

Las contraseñas establecidas antes de activar el almacén, o cambiadas después en la interfaz del panel, le son desconocidas. El secreto se pasa a `security` por stdin, nunca en argv, y nunca se registra. Contrapartida: cualquier proceso que se ejecute con tu usuario de macOS puede leer estas entradas, y `mailbox_password_get` coloca una credencial en texto plano en el contexto del modelo — deja el almacén desactivado si eso no es aceptable.


### Respaldadas por SSH (requieren `FASTPANEL_SSH_HOST`)

Estas hacen lo que la API REST no puede — se ejecutan directamente en el host del panel. Son opcionales e independientes del host: define `FASTPANEL_SSH_HOST` (+ `FASTPANEL_SSH_USER`/`PORT`/`KEY` opcionales) para apuntar a **cualquier** servidor FastPanel. El servidor llama a tu propio cliente `ssh`, por lo que el host solo necesita ser accesible con autenticación por clave. `nginx_validate` y `site_doctor` son de solo lectura; el resto son escrituras (`confirm: true` + previsualización con `dry_run`).

| Herramienta | Ejecuta | Propósito |
|---|---|---|
| `nginx_validate` | `nginx -t` | Validar la configuración nginx en vivo antes/después de `site_configuration_update` — detectar errores de sintaxis antes de que dejen nginx inoperable |
| `site_doctor` | `stat` / `systemctl` / `nginx -t` | Diagnosticar por qué un sitio falla: docroot faltante, directorio padre sin `o+x` (la trampa 750 → 404), socket FPM faltante, backend muerto, configuración nginx rota |
| `database_dump` | `mysqldump` | Volcar una base de datos a un archivo `.sql` en el directorio de staging (MySQL local). Escribe un archivo propiedad de root — requiere `confirm: true` |
| `database_import` | `mysql` | Cargar un archivo `.sql` (del directorio de staging) en una base de datos. **Destructivo** — requiere `confirm: true` |
| `site_files_upload` | `rsync` (fallback scp) | Subir un archivo/directorio local a la raíz web de un sitio, luego hacer chown al usuario del sitio. `delete: true` sincroniza (elimina archivos solo remotos) |
| `site_files_deploy` | `git clone` / `curl` + `tar` | Obtener archivos en el host (repositorio git https o tarball) en la raíz web de un sitio, luego hacer chown al usuario del sitio |
| `site_file_put` | `cat` sobre ssh | Escribir un archivo pequeño en línea (placeholder/.htaccess/robots.txt) en la raíz web de un sitio, luego hacer chown al usuario del sitio |

Las rutas de volcado/importación están confinadas a un directorio de staging (por defecto `/root/fastpanel-mcp-dumps`, anulable con `FASTPANEL_DUMP_DIR`); las rutas fuera de él o que contengan `..` son rechazadas. Las tres herramientas de subida/despliegue resuelven el `index_dir` y el propietario del sitio mediante `site_get`, rechazan las subrutas de destino que escapan de la raíz web o contienen caracteres inseguros para el shell, y aplican `chown` de todo al usuario del sistema del sitio para que nginx/PHP-FPM pueda servirlo (los archivos propiedad de root devolverían 403).

## Recetario

**Aprovisionar un nuevo sitio de prueba bajo un certificado wildcard (30 segundos, sin espera de DNS/LE):**

```
site_create(domain="foo.example.com", owner_id=2, php_version="84")
  → site_ssl_update(site_id=<new>, certificate_id=<wildcard>, https_redirect=true, http2=true, http3=true)
```

**Aprovisionar un sitio de producción con un certificado Let's Encrypt nuevo:**

```
site_create(domain="foo.com", aliases=["www.foo.com"], owner_id=<id>, php_version="84", database={...})
  → certificate_create_letsencrypt(site_id=<new>, email, common_name="foo.com")
  → queue_active  # sondear hasta que el trabajo de LE tenga éxito
```

**Reforzar el nginx predeterminado (bloquear `.git`, `.env`, `.htaccess`, composer.json, etc.):**

```
site_configuration_get(site_id)
  # El LLM inserta bloques de location de seguridad en el frontend
site_configuration_update(site_id, frontend=<edited>, backend=<unchanged>, phpini=<unchanged>)
```

**Eliminar versiones de TLS obsoletas:**

```
site_configuration_get(site_id)
  # El LLM reemplaza "ssl_protocols TLSv1.1 TLSv1.2 TLSv1.3" por "ssl_protocols TLSv1.2 TLSv1.3"
site_configuration_update(site_id, frontend=<edited>, backend=<unchanged>, phpini=<unchanged>)
```

## Modelo de seguridad

- **Doble token.** El token de lectura es siempre obligatorio. El token de escritura es opcional — si `FASTPANEL_WRITE_TOKEN` no está definido, cada herramienta de escritura falla antes de tocar la red con `FastPanelWriteDisabledError`.
- **`confirm: true`** es un argumento obligatorio en cada herramienta de escritura. Las herramientas se niegan a ejecutarse sin él — es tu última línea de defensa contra un LLM confundido.
- **`dry_run: true`** devuelve el cuerpo JSON exacto que se enviaría, con contraseñas redactadas como `***`, y omite por completo la llamada HTTP.
- **El registro de auditoría en stderr** registra cada escritura ejecutada con la carga útil redactada. En Claude Code esto aparece en los registros de MCP.
- **Autovalidación con `nginx -t`.** Con SSH configurado, `site_configuration_update` ejecuta `nginx -t` justo después de aplicar y **revierte automáticamente a la configuración anterior** si falla — una edición incorrecta no puede dejar nginx sin poder recargar. Pasa `validate: false` para omitirlo.
- **Anotaciones de herramientas.** Cada herramienta incluye las sugerencias MCP `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint` para que los clientes MCP y las pasarelas de política externa puedan aplicar las salvaguardas correctas por herramienta.
- **Sin herramientas de eliminación** por ahora — tampoco para eliminar o vaciar buzones. Las operaciones destructivas se quedan de momento en la interfaz de usuario; están previstas para más adelante, cuando el propio protocolo MCP ofrezca mayores garantías de seguridad para acciones irreversibles.
- **Tokens bloqueados por IP** (`mogwai users tokens add -c <ip>`) para que un token filtrado no pueda usarse desde otro lugar.

## Problemas conocidos

- **Parámetros `filter[...]`:** Los endpoints de lista de FastPanel esperan `filter[limit]=…&filter[type]=…`. El uso simple de `?limit=…` se ignora silenciosamente.
- **La creación de sitios es un asistente, no una creación REST.** El panel hace `POST /api/master/domain` (sonda) y luego `PUT /api/master` (creación real), no `POST /api/sites`. `site_create` oculta esto.
- **Operaciones asíncronas.** La emisión de certificados, las actualizaciones del backend del sitio y varias otras operaciones devuelven `action: "CREATING"` / `"UPDATING"` inmediatamente y se ejecutan en segundo plano. Usa `queue_active` para sondear.
- **Sin especificación OpenAPI oficial.** Los endpoints fueron obtenidos por ingeniería inversa. Si una nueva versión de FastPanel rompe algo, por favor abre un issue con la nueva forma de la carga útil.
- **TLS autofirmado.** La mayoría de las instalaciones del panel usan certificados autofirmados. Define `FASTPANEL_INSECURE_TLS=1` o coloca un certificado adecuado delante.
- **fail2ban / limitación de velocidad.** FastPanel incluye fail2ban y limitación de velocidad a nivel de panel. Los scripts de prueba que bombardean la API pueden hacer que tu IP quede bloqueada.

## Hoja de ruta

- Herramientas de eliminación (`user_delete`, `site_delete`, `database_delete`, `certificate_delete`, eliminar/vaciar buzones) — más adelante, cuando MCP sea más seguro para operaciones irreversibles
- CRUD de registros DNS
- Gestión de planes de copia de seguridad (listar / ejecutar / restaurar)
- Crear/modificar dominios de correo
- Operaciones masivas (p. ej. "aplicar este refuerzo de nginx a todos los sitios")
- Herramientas de fallback a CLI sobre SSH para operaciones no disponibles en REST (`transfer`, `firewall save/restore`, `panel ip_match`)
- `outputSchema` MCP estructurado para que los clientes puedan renderizar resultados tipados
- Reintento con retroceso exponencial consciente del límite de velocidad

## Contribuir

Los issues y PRs son bienvenidos. Especialmente útil:

- Cargas útiles de red capturadas en DevTools para acciones aún no cubiertas
- Correcciones de compatibilidad para versiones más recientes de FastPanel
- Servidores de BD adicionales / tipos de runtime en los esquemas enum
- Capturas de pantalla / grabaciones de flujos típicos para el README

## Autor

Desarrollado y mantenido por **Ihor Chyshkala** — [chyshkala.com](https://chyshkala.com) · [ihor@chyshkala.com](mailto:ihor@chyshkala.com).

### Servicios

Disponible para contratar a través de [chyshkala.com](https://chyshkala.com):

| Servicio | Qué cubre |
|---|---|
| **Desarrollo Web** | Aplicaciones web full-stack con React, Next.js y Node.js |
| **Automatización de Procesos** | Flujos de trabajo, integraciones y canalizaciones de datos |
| **Desarrollo de API** | REST, GraphQL e integraciones con terceros |
| **Integración de IA** | ChatGPT, Claude y soluciones de IA personalizadas |
| **Chatbot de IA** _(nuevo)_ | Chatbots personalizados entrenados con tus datos |
| **DevOps** | CI/CD, Docker e infraestructura en la nube |
| **CTO-as-a-Service** | Liderazgo técnico para startups |
| **Due Diligence** | Auditorías técnicas para inversores |
| **Modernización de Sistemas Legados** | Migrar de una pila heredada a una moderna |

## Licencia

MIT — véase [LICENSE](./LICENSE).

## Aviso legal

Este es un proyecto comunitario de terceros. "FastPanel" es una marca comercial de sus respectivos propietarios. Este proyecto no está afiliado, respaldado ni patrocinado por FastPanel. Pruébalo contra una instancia de FastPanel que no sea de producción antes de apuntarlo a algo que te importe.
