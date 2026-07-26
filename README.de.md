# fastpanel-mcp

> Sprechen Sie mit Ihrem [FastPanel 2](https://fastpanel.direct/)-Server über Claude, Cursor oder einen beliebigen MCP-kompatiblen Client. Erstellen Sie Websites, verwalten Sie Datenbanken, binden Sie SSL ein und härten Sie nginx-Konfigurationen — per natürlicher Sprache, mit produktionsreifer Sicherheitsabsicherung.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue.svg)](https://modelcontextprotocol.io/)
[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](./CHANGELOG.md)

**Schlüsselwörter:** FastPanel, MCP, Model Context Protocol, Claude Code, Claude Desktop, server management, hosting automation, nginx, Let's Encrypt, DevOps, LLM ops, AI sysadmin, Webhosting-Automatisierung, Serververwaltung, Infrastrukturmanagement, DevOps-Automatisierung, KI-Systemadministration.

**In anderen Sprachen lesen:** [English](./README.md) · [Русский](./README.ru.md) · [Українська](./README.uk.md) · [Español](./README.es.md) · [Deutsch](./README.de.md)

> Die maßgebliche Dokumentation wird auf Englisch gepflegt; Übersetzungen können veraltet sein.

---

## Was Sie erhalten

Stellen Sie einem LLM eine Anfrage und erhalten Sie echte Infrastrukturänderungen auf Ihrem FastPanel-Server:

> **Sie:** „Erstelle eine neue Website `foo.example.com` für Benutzer `www-root`, PHP 8.4, keine Datenbank, und binde unser Wildcard-SSL-Zertifikat ein. Aktiviere außerdem HTTP/2 und HTTP/3."
>
> **LLM (~30 Sekunden, 5 Tool-Aufrufe später):** Website ID 53 ist live unter https://foo.example.com mit HTTP/2, HTTP/3, Wildcard-TLS und einer automatisch eingerichteten HTTPS-Weiterleitung.

> **Sie:** „Zeig mir die nginx-Konfiguration für Website 1 — prüfe, ob `.env`, `.git` und andere sensible Pfade gesperrt sind. Falls nicht, füge Härtungsmaßnahmen hinzu."
>
> **LLM:** Liest die Konfiguration, stellt fest, dass `.env` und `.htaccess` als statische Dateien ausgeliefert werden (Sicherheitslücke), bearbeitet das Frontend, um Ablehnungsregeln für Dotfiles, sensible Erweiterungen und Framework-Dateien hinzuzufügen, zeigt das Diff per `dry_run` in der Vorschau und stellt die Änderung anschließend bereit. `.env` liefert nun 404 zurück; `.well-known/acme-challenge` funktioniert weiterhin.

> **Sie:** „Welche Websites laufen auf diesem Server, wem gehören sie und welche erzwingen kein HTTPS?"
>
> **LLM:** Fragt `sites_list` ab und meldet die 5 Websites ohne `https_redirect: true`.

## Funktionen

- **32 Tools**, die Websites, Datenbanken (inkl. SSH-Dump/-Import), Benutzer, DNS-Zonen, SSL-Zertifikate, Systemauslastung, Warteschlange, Website-Logs, Backup-Pläne, hostbasierte Diagnosen, Datei-Upload/-Deployment in das Web-Root einer Website sowie rohe nginx-/Apache-/php.ini-Konfigurationen abdecken.
- **Duales Token-Sicherheitsmodell.** Leseoperationen verwenden ein Nur-Lese-Token; schreibende Operationen erfordern ein separates Schreib-Token (`FASTPANEL_WRITE_TOKEN`). Wird das Schreib-Token nicht gesetzt, schlägt jedes Schreib-Tool zuverlässig fehl.
- **`confirm: true` erforderlich** bei jedem Schreibvorgang. Versehentliche LLM-Ausgaben können den Zustand nicht verändern.
- **`dry_run: true` zeigt eine Vorschau** des genauen HTTP-Bodys, den der Server erhalten würde — Passwörter werden als `***` geschwärzt, kein Netzwerkaufruf wird ausgelöst.
- **Kompakter Antwortmodus** bei sites_list, um bei großen Panels den LLM-Kontext nicht zu überfüllen.
- **stderr-Auditprotokoll** für jeden ausgeführten Schreibvorgang, mit geschwärzten Passwörtern.
- **MCP-Tool-Annotationen** (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`), damit Clients und Richtlinienscanner jedes Tool korrekt klassifizieren, anstatt Nur-Lese-Diagnosen als destruktiv einzustufen.
- **`nginx -t`-Autovalidierung mit Rollback** — `site_configuration_update` validiert die Live-Konfiguration nach dem Anwenden und setzt eine fehlerhafte Änderung automatisch zurück, wenn SSH konfiguriert ist.
- **Getestet gegen ein Live-FastPanel-2-Panel** mit 35+ Websites in der Produktion.

## Warum dieses Projekt existiert

FastPanel veröffentlicht keine OpenAPI-Spezifikation. Die Endpunkte und Payload-Strukturen in diesem Server wurden durch Reverse Engineering aus dem Angular-SPA-Bundle des Panels und Live-DevTools-Mitschnitten gewonnen, einschließlich nicht offensichtlicher Eigenheiten wie:

- Listenendpunkte erfordern `filter[limit]=…&filter[type]=…` als verschachtelte Parameter — ein einfaches `?limit=…` wird stillschweigend ignoriert.
- Das Erstellen einer Website erfolgt in einem zweistufigen Assistenten (`POST /api/master/domain` Probe → `PUT /api/master`), nicht durch ein konventionelles `POST /api/sites`.
- Das `backend`-Feld in der Website-Konfiguration ist bei `handler=php_fpm` eine PHP-FPM-Pool-Konfiguration, aber bei `handler=fcgi` ein Apache-VirtualHost-Block.
- Das Einbinden/Trennen von SSL erfolgt über `PUT /api/sites/{id}` (website-seitig), nicht über `POST /api/sites/{id}/certificate` (dieser Endpunkt existiert nicht).

Diese Besonderheiten sind in den Tool-Beschreibungen dokumentiert, damit das LLM sie nicht neu entdecken muss.

## Voraussetzungen

- Node.js 20 oder neuer
- Eine FastPanel-2-Installation, die über HTTPS erreichbar ist
- Root-SSH auf dem Panel-Host zum Erstellen von API-Tokens (einmalig)

## Installation

```bash
git clone https://github.com/iMateo/fastpanel-mcp.git
cd fastpanel-mcp
pnpm install      # oder: npm install
pnpm build
```

## API-Tokens erstellen

Erstellen Sie auf dem FastPanel-Host (als root) ein Nur-Lese-Token für den täglichen Betrieb:

```bash
mogwai users tokens add -n mcp-read -s read_only -e 2030-12-31
```

> Das CLI-Binary ist `/usr/local/fastpanel2/fastpanel`; neuere FastPanel-Builds stellen es als `mogwai` über `PATH` bereit (`/usr/local/bin/mogwai` → dasselbe Binary). Ältere Dokumentationen bezeichnen es als `fastpanel`, das **nicht** in `PATH` enthalten ist — verwenden Sie `mogwai` oder den vollständigen Pfad. Nur für root.

Kopieren Sie das `msg`-Feld aus dem zurückgegebenen JSON — das ist Ihr Token. Es umgeht 2FA und überlebt Session-TTLs, behandeln Sie es daher wie ein Server-Passwort.

Optionales Schreib-Token mit Ablaufdatum und IP-Sperre:

```bash
mogwai users tokens add -n mcp-write -c <your-ip> -e 2030-12-31
```

Lassen Sie `FASTPANEL_WRITE_TOKEN` in Konfigurationen ungesetzt, in denen Sie keine Schreibzugriffe benötigen.

## Konfiguration

```bash
cp .env.example .env
```

Minimal-`.env`:

```
FASTPANEL_URL=https://panel.example.com:8888
FASTPANEL_TOKEN=<your read token>
FASTPANEL_INSECURE_TLS=1   # nur wenn das Panel ein selbstsigniertes Zertifikat verwendet
```

## Verwendung mit Claude Code

```bash
claude mcp add fastpanel \
  -s user \
  -e "FASTPANEL_URL=https://panel.example.com:8888" \
  -e "FASTPANEL_TOKEN=…" \
  -e "FASTPANEL_INSECURE_TLS=1" \
  -- node $PWD/dist/index.js
```

Fügen Sie `-e "FASTPANEL_WRITE_TOKEN=…"` hinzu, wenn Sie Schreib-Tools aktivieren möchten.

## Verwendung mit Claude Desktop / Cursor / anderen MCP-Clients

`claude_desktop_config.json` (oder entsprechende Konfigurationsdatei):

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

## Debugging

Tools mit der MCP Inspector GUI untersuchen:

```bash
pnpm inspect
```

JSON-RPC manuell über stdio steuern:

```bash
FASTPANEL_URL=… FASTPANEL_TOKEN=… node scripts/smoke.mjs
```

## Tools

### Lesen (kein Schreib-Token erforderlich)

| Tool | Endpunkt | Rückgabe |
|---|---|---|
| `sites_list` | `GET /api/sites/list` | Alle Websites, standardmäßig 13 wesentliche Felder (Kompaktmodus) |
| `site_get` | `GET /api/sites/{id}` | Vollständiges Website-Objekt mit 40 Feldern (Zertifikat, Backend, Backups, Statistiken) |
| `site_configuration_get` | `GET /api/sites/{id}/configuration` | Rohes nginx-Frontend, Handler-Backend (PHP-FPM oder Apache), php.ini |
| `databases_list` | `GET /api/databases` | MySQL- und PostgreSQL-Datenbanken mit Eigentümern und Größen |
| `database_servers_list` | `GET /api/databases/servers` | Verfügbare Datenbankserver — IDs für `database_create` verwenden |
| `users_list` | `GET /api/users` | Panel-Benutzer und Website-Eigentümer |
| `dns_domains_list` | `GET /api/dns/domains` | DNS-Zonen (leer, wenn Panel-DNS deaktiviert ist) |
| `dns_records_list` | `GET /api/dns/domain/{id}/records` | Einträge für eine Zone |
| `certificates_list` | `GET /api/certificates` | Gespeicherte SSL-Zertifikate (LE + benutzerdefiniert) |
| `system_load` | `GET /api/loads/full` | CPU / Speicher / Festplatte / Lastmittelwerte / Top-Prozesse |
| `queue_list` | `GET /api/queue/list` | Hintergrundaufgaben einschließlich abgeschlossener |
| `queue_active` | `GET /api/queue` | Nur laufende Aufgaben (abgeschlossene werden gefiltert) + `meta.all_done` für deterministisches Polling |
| `site_logs` | `GET /api/sites/{id}/log/{lines}/{type}` | nginx-/Apache-Zugriffs- oder Fehlerlog (frontend_/backend_) ohne SSH |
| `site_resources` | `GET /api/sites/{id}/resources` | Datenbanken, Subdomains, DNS- und E-Mail-Zonen einer Website |
| `backup_plans_list` | `GET /api/v2/backup/plans` | Konfigurierte Backup-Pläne |
| `me` | `GET /api/me` | Konto hinter dem aktuellen Lese-Token (Benutzername, Rollen, SSH) |
| `settings_get` | `GET /api/settings` | Panelweite Einstellungen (Betriebssystem, Lizenz, Limits, Benachrichtigungen) |

### Schreiben (erfordert `FASTPANEL_WRITE_TOKEN` + explizites `confirm: true`)

| Tool | Endpunkt | Zweck |
|---|---|---|
| `user_create` | `POST /api/users` | Neuen Panel-Benutzer (Website-Eigentümer) erstellen |
| `database_create` | `POST /api/databases` | MySQL- oder PostgreSQL-Datenbank mit dediziertem DB-Benutzer erstellen |
| `site_create` | `POST /api/master/domain` + `PUT /api/master` | Website atomar erstellen, optional mit integriertem Benutzer / Datenbank / FTP |
| `site_update` | `PUT /api/sites/{id}` | Document Root (`index_dir`) / Directory Index ändern — z. B. eine Laravel-Website auf `public/` zeigen lassen (`framework: "laravel"`-Voreinstellung) |
| `site_ssl_update` | `PUT /api/sites/{id}` | SSL-Zertifikat einbinden / ersetzen / trennen, HTTPS / HTTP2 / HTTP3 / HSTS umschalten |
| `site_backend_update` | `PUT /api/sites/backend/{backend_id}` | PHP-Version, Handler, Port, Socket, Umgebungsvariablen ändern (Website-ID übergeben — Backend-ID wird intern aufgelöst) |
| `site_configuration_update` | `PUT /api/sites/{id}/configuration` | Rohes nginx-/Apache-/php.ini-Konfiguration der Website ersetzen. **Gefährlich**: Fehlerhafte Syntax kann die Website beschädigen — bei konfiguriertem SSH wird `nginx -t` nach dem Anwenden ausgeführt und bei Fehler **automatisch zurückgesetzt** (`validate: false` zum Überspringen) |
| `certificate_create_letsencrypt` | `POST /api/certificates` | Neues Let's Encrypt-Zertifikat ausstellen (asynchron — `queue_active` abfragen) |

### SSH-gestützt (erfordert `FASTPANEL_SSH_HOST`)

Diese Tools leisten, was die REST-API nicht kann — sie werden direkt auf dem Panel-Host ausgeführt. Opt-in und host-unabhängig: Setzen Sie `FASTPANEL_SSH_HOST` (+ optional `FASTPANEL_SSH_USER`/`PORT`/`KEY`), um auf **jeden** FastPanel-Server zu zeigen. Der Server delegiert an Ihren eigenen `ssh`-Client, der Host muss daher lediglich mit schlüsselbasierter Authentifizierung erreichbar sein. `nginx_validate` und `site_doctor` sind schreibgeschützt; die übrigen Tools sind Schreiboperationen (`confirm: true` + `dry_run`-Vorschau).

| Tool | Führt aus | Zweck |
|---|---|---|
| `nginx_validate` | `nginx -t` | Live-nginx-Konfiguration vor/nach `site_configuration_update` validieren — Syntaxfehler erkennen, bevor nginx ausfällt |
| `site_doctor` | `stat` / `systemctl` / `nginx -t` | Diagnosieren, warum eine Website Fehler erzeugt: fehlendes Docroot, übergeordnetes Verzeichnis ohne `o+x` (die 750-→-404-Falle), fehlender FPM-Socket, ausgefallenes Backend, defekte nginx-Konfiguration |
| `database_dump` | `mysqldump` | Datenbank in eine `.sql`-Datei im Staging-Verzeichnis dumpen (lokales MySQL). Schreibt eine root-eigene Datei — erfordert `confirm: true` |
| `database_import` | `mysql` | Eine `.sql`-Datei (aus dem Staging-Verzeichnis) in eine Datenbank laden. **Destruktiv** — erfordert `confirm: true` |
| `site_files_upload` | `rsync` (scp-Fallback) | Lokale Datei/Verzeichnis in das Web-Root einer Website hochladen und anschließend dem Website-Benutzer zuordnen (chown). `delete: true` spiegelt (entfernt nur remote vorhandene Dateien) |
| `site_files_deploy` | `git clone` / `curl` + `tar` | Dateien auf dem Host abrufen (HTTPS-Git-Repository oder Tarball) in das Web-Root einer Website, anschließend chown an den Website-Benutzer |
| `site_file_put` | `cat` über SSH | Eine kleine Inline-Datei (Platzhalter/.htaccess/robots.txt) in das Web-Root einer Website schreiben, anschließend chown an den Website-Benutzer |

Dump-/Import-Pfade sind auf ein Staging-Verzeichnis beschränkt (Standard `/root/fastpanel-mcp-dumps`, überschreibbar mit `FASTPANEL_DUMP_DIR`); Pfade außerhalb oder mit `..` werden abgewiesen. Die drei Upload-/Deploy-Tools ermitteln das `index_dir` und den Eigentümer der Website über `site_get`, verweigern Ziel-Unterpfade, die aus dem Web-Root entkommen oder Shell-unsichere Zeichen enthalten, und führen `chown` durch, damit nginx/PHP-FPM die Dateien ausliefern kann (root-eigene Dateien würden 403 zurückgeben).

## Kochbuch

**Neue Test-Website unter einem Wildcard-Zertifikat einrichten (30 Sekunden, kein DNS-/LE-Warten):**

```
site_create(domain="foo.example.com", owner_id=2, php_version="84")
  → site_ssl_update(site_id=<new>, certificate_id=<wildcard>, https_redirect=true, http2=true, http3=true)
```

**Produktions-Website mit einem frischen Let's Encrypt-Zertifikat einrichten:**

```
site_create(domain="foo.com", aliases=["www.foo.com"], owner_id=<id>, php_version="84", database={...})
  → certificate_create_letsencrypt(site_id=<new>, email, common_name="foo.com")
  → queue_active  # abfragen bis LE-Job SUCCESS
```

**Standard-nginx härten (`.git`, `.env`, `.htaccess`, composer.json usw. sperren):**

```
site_configuration_get(site_id)
  # LLM fügt Sicherheits-location-Blöcke in das Frontend ein
site_configuration_update(site_id, frontend=<edited>, backend=<unchanged>, phpini=<unchanged>)
```

**Veraltete TLS-Versionen entfernen:**

```
site_configuration_get(site_id)
  # LLM ersetzt "ssl_protocols TLSv1.1 TLSv1.2 TLSv1.3" durch "ssl_protocols TLSv1.2 TLSv1.3"
site_configuration_update(site_id, frontend=<edited>, backend=<unchanged>, phpini=<unchanged>)
```

## Sicherheitsmodell

- **Duale Tokens.** Lese-Token ist immer erforderlich. Schreib-Token ist optional — ist `FASTPANEL_WRITE_TOKEN` nicht gesetzt, schlägt jedes Schreib-Tool vor dem Netzwerkzugriff mit `FastPanelWriteDisabledError` fehl.
- **`confirm: true`** ist ein Pflichtargument bei jedem Schreib-Tool. Tools verweigern die Ausführung ohne dieses Argument — das ist Ihre letzte Verteidigungslinie gegen ein verworrenes LLM.
- **`dry_run: true`** gibt den exakten JSON-Body zurück, der gesendet würde, Passwörter werden als `***` geschwärzt, und der HTTP-Aufruf wird vollständig übersprungen.
- **stderr-Auditprotokoll** erfasst jeden ausgeführten Schreibvorgang mit geschwärztem Payload. In Claude Code ist dies in den MCP-Logs sichtbar.
- **`nginx -t`-Autovalidierung.** Bei konfiguriertem SSH führt `site_configuration_update` direkt nach dem Anwenden `nginx -t` aus und **setzt automatisch auf die vorherige Konfiguration zurück**, wenn die Validierung fehlschlägt — eine fehlerhafte Änderung kann nginx nicht in einen nicht neu ladbaren Zustand versetzen. Übergeben Sie `validate: false`, um dies zu deaktivieren.
- **Tool-Annotationen.** Jedes Tool liefert MCP-`readOnlyHint`-/`destructiveHint`-/`idempotentHint`-/`openWorldHint`-Hinweise, damit MCP-Clients und externe Richtliniens-Gateways für jedes Tool die richtigen Schutzmaßnahmen anwenden können.
- **Noch keine Lösch-Tools.** Destruktive Operationen verbleiben in der Benutzeroberfläche, bis sie bewusst hinzugefügt werden.
- **IP-gesperrte Tokens** (`mogwai users tokens add -c <ip>`), sodass ein geleaktes Token nicht von anderen Adressen aus verwendet werden kann.

## Bekannte Tücken

- **`filter[...]`-Parameter:** FastPanel-Listenendpunkte erwarten `filter[limit]=…&filter[type]=…`. Ein einfaches `?limit=…` wird stillschweigend ignoriert.
- **Website-Erstellung ist ein Assistent, kein REST-Create.** Das Panel führt `POST /api/master/domain` (Probe) und dann `PUT /api/master` (eigentliche Erstellung) aus, nicht `POST /api/sites`. `site_create` verbirgt dies.
- **Asynchrone Operationen.** Zertifikatsausstellung, Website-Backend-Updates und mehrere andere Operationen geben sofort `action: "CREATING"` / `"UPDATING"` zurück und laufen im Hintergrund. Verwenden Sie `queue_active` zum Abfragen.
- **Keine offizielle OpenAPI-Spezifikation.** Endpunkte wurden durch Reverse Engineering ermittelt. Falls ein neues FastPanel-Release etwas ändert, erstellen Sie bitte ein Issue mit der neuen Payload-Struktur.
- **Selbstsigniertes TLS.** Die meisten Panel-Installationen verwenden selbstsignierte Zertifikate. Setzen Sie `FASTPANEL_INSECURE_TLS=1` oder stellen Sie ein ordentliches Zertifikat davor.
- **fail2ban / Rate-Limiting.** FastPanel wird mit fail2ban und panelweitem Rate-Limiting ausgeliefert. Testskripte, die die API intensiv abfragen, können Ihre IP sperren lassen.

## Roadmap

- Lösch-Tools (`user_delete`, `site_delete`, `database_delete`, `certificate_delete`)
- DNS-Einträge CRUD
- Backup-Plan-Verwaltung (auflisten / ausführen / wiederherstellen)
- E-Mail-Domain- und Postfach-Verwaltung
- Massenoperationen (z. B. „diese nginx-Härtung auf alle Websites anwenden")
- CLI-Fallback-Tools über SSH für Operationen, die nicht in REST verfügbar sind (`transfer`, `firewall save/restore`, `panel ip_match`)
- Strukturiertes MCP-`outputSchema`, damit Clients typisierte Ergebnisse darstellen können
- Rate-Limit-bewusstes Retry mit exponentiellem Backoff

## Mitmachen

Issues und Pull Requests sind willkommen. Besonders hilfreich:

- Aufgezeichnete DevTools-Network-Payloads für noch nicht abgedeckte Aktionen
- Kompatibilitätskorrekturen für neuere FastPanel-Versionen
- Zusätzliche Datenbankserver / Laufzeittypen in den Enum-Schemas
- Screenshots / Aufzeichnungen typischer Abläufe für die README

## Autor

Erstellt und gepflegt von **Ihor Chyshkala** — [chyshkala.com](https://chyshkala.com) · [ihor@chyshkala.com](mailto:ihor@chyshkala.com).

### Dienstleistungen

Verfügbar für Auftragsarbeiten über [chyshkala.com](https://chyshkala.com):

| Dienstleistung | Abgedeckte Bereiche |
|---|---|
| **Webentwicklung** | Full-Stack-Webanwendungen mit React, Next.js & Node.js |
| **Prozessautomatisierung** | Workflows, Integrationen & Datenpipelines |
| **API-Entwicklung** | REST, GraphQL & Drittanbieter-Integrationen |
| **KI-Integration** | ChatGPT, Claude & individuelle KI-Lösungen |
| **KI-Chatbot** _(neu)_ | Maßgeschneiderte Chatbots, trainiert auf Ihren Daten |
| **DevOps** | CI/CD, Docker & Cloud-Infrastruktur |
| **CTO-as-a-Service** | Technische Führung für Startups |
| **Due Diligence** | Technische Audits für Investoren |
| **Legacy-Modernisierung** | Migration von Legacy- auf moderne Technologiestacks |

## Lizenz

MIT — siehe [LICENSE](./LICENSE).

## Haftungsausschluss

Dies ist ein Drittanbieter-Community-Projekt. „FastPanel" ist eine eingetragene Marke der jeweiligen Eigentümer. Dieses Projekt ist weder mit FastPanel verbunden noch von FastPanel gebilligt oder gesponsert. Testen Sie es gegen eine Nicht-Produktionsinstanz von FastPanel, bevor Sie es auf produktionskritische Systeme anwenden.
