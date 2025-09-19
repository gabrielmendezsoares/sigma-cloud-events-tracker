# 📢 Sigma Cloud Events Tracker

## 📋 Overview

Sigma Cloud Events Tracker is a background job that monitors Segware event activity in 2-hour intervals. It connects to the Segware API, retrieves recent events, and filters them based on predefined codes and CUCs. Events are aggregated by account, CUC, and code, and if their count exceeds a configurable threshold, alerts are generated.

Each alert is enriched with external metadata from Segware’s account, company, and client group APIs. Alerts are tracked in internal databases and optionally sent via WhatsApp or injected into Segware's event system. Redundant alerts are avoided using a trigger tracking table, and alerts are automatically cleared once event volume normalizes.

The system is fault-tolerant, retries intelligently on API limits, and logs all activity for audit and observability. This enables proactive detection of excessive or misconfigured event activity across monitored environments.

### 🎯 Objectives 
 
- Monitor Segware alarm events within a rolling 2-hour window
- Fetch event data from the Segware API with bearer token authentication
- Support batched time windows to handle API pagination and data limits
- Filter events based on a predefined set of codes
- Filter events by a provided set of CUCs
- Aggregate event occurrences by CUC, account ID, and event code
- Generate alerts when event counts exceed the defined threshold
- Store and track active alerts to prevent duplicates
- Automatically clear alerts when event volumes fall below threshold
- Enrich alert data with account, company, and client group metadata
- Send alert messages to WhatsApp using the ChatPro API
- Inject alerts into Segware’s alarm event endpoint
- Persist alert records and metadata in internal reporting tables
- Log all operations and failures for observability and debugging
- Run as a scheduled background job suitable for automation environments

--- 

## 📦 Quick Start

### ⚠️ Prerequisites 

- [**Node.js**](https://nodejs.org/) ≥ `20.14.0` — _JavaScript runtime environment_
- [**MySQL**](https://www.mysql.com/) ≥ `8.0` — _Relational database_

### ⚙️ Setup 

```bash 
# Clone & navigate
git clone <repository-url> && cd sigma-cloud-events-tracker

# Configure environment
cp .env.example .env  # Edit with your settings

# Install dependencies (auto-runs database setup)
npm install
```

> **💡 Database:** Import `storage.sql.example` before running `npm install`

---

## ⚡ Usage

### 🛠️ Development

```bash
npm run start:development
```

### 🏗️ Production

```bash
npm run build && npm run start:production
```

---

## 📚 Command Reference

### 🧰 Core

| Command | Description |
| ------- | ----------- |
| `npm run start:development` | _Start the application in development_ |
| `npm run start:production` | _Start the application in production_ |
| `npm run build` | _Build the application for production_ |
| `npm run build:watch` | _Build the application with watch mode_ |
| `npm run clean` | _Clean application build artifacts_ |
 
### 🛢️ Database

| Command | Description |
| ------- | ----------- |
| `npm run db:pull` | _Pull database schema into Prisma across all schemas_ |
| `npm run db:push` | _Push Prisma schema to the database across all schemas_ |
| `npm run db:generate` | _Generate Prisma Client for all schemas_ |
| `npm run db:migrate:dev` | _Run development migrations across all schemas_ |
| `npm run db:migrate:deploy` | _Deploy migrations to production across all schemas_ |
| `npm run db:studio` | _Open Prisma Studio (GUI) across all schemas_ |
| `npm run db:reset` | _Reset database (pull + generate) for all schemas_ |

### 🐳 Docker 

| Command | Description |
| ------- | ----------- |
| `npm run docker:build:development` | _Build Docker image for development_ |
| `npm run docker:build:production` | _Build Docker image for production_ |
| `npm run docker:run:development` | _Run development Docker container_ |
| `npm run docker:run:production` | _Run production Docker container_ |
| `npm run docker:compose:up:development` | _Start Docker Compose in development_ |
| `npm run docker:compose:up:production` | _Start Docker Compose in production_ |
| `npm run docker:compose:up:build:development` | _Start & rebuild Docker Compose in development_ |
| `npm run docker:compose:up:build:production` | _Start & rebuild Docker Compose in production_ |
| `npm run docker:compose:down` | _Stop Docker Compose services_ |
| `npm run docker:compose:logs` | _View Docker Compose logs_ |
| `npm run docker:prune` | _Clean up unused Docker resources_ |

### 🧪 Testing

| Command | Description |
| ------- | ----------- |
| `npm test` | _Run all tests once_ |
| `npm run test:watch` | _Run tests in watch mode_ |
| `npm run test:coverage` | _Run tests and generate a coverage report_ |
   