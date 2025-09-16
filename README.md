# 📢 Sigma Cloud Events Tracker

## 📋 Overview

Sigma Cloud Events Tracker is a scheduled event monitoring system that analyzes events reported by Segware accounts to identify abnormal volumes within a defined time window (default: 2 hours). It connects to the Segware API, filters specific event codes, and groups occurrences by account and CUC. When event counts exceed a configurable threshold (default: 50), the service logs the case with enriched metadata — including account, company, and client group information — and tracks the alert in internal databases.

The service ensures idempotency through a trigger table, automatically clears expired alerts, and provides historical insight via a dedicated register log. While integrations with WhatsApp notifications and Segware alarm injection exist, they are currently disabled and ready for activation. This monitoring service plays a key role in ensuring operational awareness across client deployments by detecting excessive or potentially misconfigured alarm activity.

### 🎯 Objectives 
 
- Monitor recent Segware event activity on a rolling 2-hour basis
- Identify excessive occurrences of specific alarm event codes
- Aggregate events by account, CUC, and code, applying per-code thresholds
- Enrich alerts with external metadata (account info, company, client group)
- Store and track alerts in the internal database for auditing and analysis
- Prevent duplicate alerting using trigger-state persistence
- Automatically clear alerts once event volumes drop below the threshold
- Handle Segware API limitations gracefully (e.g., pagination, data limits)
- Support future alert delivery via WhatsApp or Segware’s event alarm endpoint
- Operate securely using bearer token authentication for all external integrations
- Run reliably as a scheduled background job or worker process

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
   