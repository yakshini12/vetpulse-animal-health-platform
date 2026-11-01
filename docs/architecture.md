# VetPulse architecture

VetPulse is a browser-based case and diagnostic sample platform backed by a modular Express API. React communicates with the API using JSON and an httpOnly JWT session cookie. Prisma persists application records in PostgreSQL. CSV imports use a small Python validator for row-level rules, while the Node service owns database checks and transactional writes.

~~~mermaid
flowchart LR
    subgraph Browser[Browser]
        UI[React 19 SPA<br/>Vite · React Router · Recharts]
    end

    subgraph API[Node.js API · Express]
        Routes[REST routes<br/>auth · cases · samples · tasks<br/>imports · dashboard · audit · users]
        Auth[Auth middleware<br/>JWT cookie · role checks]
        CSV[CSV import coordinator]
        Audit[Audit service]
        ORM[Prisma ORM]
    end

    subgraph Validator[Python data service]
        RowCheck[CSV row validation<br/>schema · formats · dates · duplicates]
    end

    DB[(PostgreSQL 16)]
    CI[GitHub Actions<br/>lint · typecheck · tests · build]

    UI -->|JSON + httpOnly session cookie| Routes
    Routes --> Auth
    Auth --> CSV
    Auth --> ORM
    ORM <--> DB
    Routes --> Audit
    Audit --> ORM
    CSV -->|uploaded CSV| RowCheck
    RowCheck -->|validation report| CSV
    CSV -->|case and sample reference checks| ORM
    CSV -->|preview batch + audit| ORM
    CSV -->|atomic valid-row commit + batch status + audit| ORM
    CI -. validates .-> API
    CI -. validates .-> Validator
    CI -. builds .-> UI
~~~

## Main components

- **React web app:** case, sample, task, import, audit, dashboard, and user screens. Vite proxies API requests during development; Express serves the production build when present.
- **Express API:** feature routers share authentication, validation, pagination, and a consistent error response. Role checks run on the server.
- **Authentication:** bcrypt verifies passwords; the API places a signed JWT in an httpOnly cookie. The browser does not store the token in local storage.
- **Prisma and PostgreSQL:** versioned migrations define the schema. Dashboard figures come from live database aggregation.
- **Python CSV validator:** validates file structure and row-level fields, enums, dates, chronology, and duplicate sample codes. It stays database-free.
- **Node import coordinator:** adds database-level case/sample checks, stores preview reports, and commits valid sample rows, batch status, and the audit event transactionally.
- **Audit service:** records mutation events inside the associated transaction so an audit entry cannot describe a write that rolled back.
- **GitHub Actions:** runs lint, type checks, tests, and production builds across the web app, API, and Python validator.

## CSV import flow

1. An authenticated user uploads a CSV file for preview.
2. The API checks the file and asks the Python service to validate its rows.
3. Node checks case references and existing sample codes against PostgreSQL.
4. VetPulse stores the preview report and audit event without inserting sample rows.
5. On commit, valid rows, batch status, and audit event are written together in one database transaction.

All seeded and screenshot data is synthetic. See the [README](../README.md) for setup instructions, test commands, and documented limitations.
