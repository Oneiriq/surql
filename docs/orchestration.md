# Orchestration

surql supports deploying migrations across multiple SurrealDB environments with configurable deployment strategies.

## Environment Configuration

```typescript
import type { EnvironmentConfig } from 'jsr:@oneiriq/surql'

const dev: EnvironmentConfig = {
  name: 'development',
  connection: {
    host: 'localhost',
    port: '8000',
    namespace: 'myapp',
    database: 'dev',
    username: 'root',
    password: 'root',
  },
}

const staging: EnvironmentConfig = {
  name: 'staging',
  connection: {
    host: 'staging.internal',
    port: '8000',
    namespace: 'myapp',
    database: 'staging',
    username: 'admin',
    password: process.env.STAGING_DB_PASSWORD,
  },
}

const prod: EnvironmentConfig = {
  name: 'production',
  connection: {
    host: 'prod.internal',
    port: '8000',
    namespace: 'myapp',
    database: 'production',
    username: 'admin',
    password: process.env.PROD_DB_PASSWORD,
  },
}
```

## MigrationCoordinator

```typescript
import { MigrationCoordinator } from 'jsr:@oneiriq/surql'

const coordinator = new MigrationCoordinator([migration1, migration2])

// Deploy to all environments sequentially
const results = await coordinator.deploy({
  environments: [dev, staging, prod],
  migrations: [migration1, migration2],
  strategy: 'sequential',
})

for (const result of results) {
  console.log(`${result.environment}: ${result.status}`)
}
```

## Deployment Strategies

| Strategy | Description |
|----------|-------------|
| `'sequential'` | Deploy to environments one at a time, stop on first failure |
| `'parallel'` | Deploy to all environments concurrently |
| `'canary'` | Deploy to first environment, verify health, then continue |

```typescript
// Parallel deployment
const results = await coordinator.deploy({
  environments: [dev, staging],
  migrations,
  strategy: 'parallel',
})
```

## Health Checks

```typescript
const statuses = await coordinator.checkHealth([dev, staging, prod])

for (const status of statuses) {
  console.log(`${status.environment}: ${status.healthy ? 'OK' : status.error}`)
  console.log(`  Latency: ${status.latencyMs}ms`)
}
```

## Standalone deployToEnvironments

```typescript
import { deployToEnvironments } from 'jsr:@oneiriq/surql'

const results = await deployToEnvironments({
  environments: [dev, staging],
  migrations: [migration1],
  strategy: 'sequential',
})
```

## Deployment Results

```typescript
import { DeploymentStatus } from 'jsr:@oneiriq/surql'

for (const result of results) {
  if (result.status === DeploymentStatus.SUCCESS) {
    console.log(`${result.environment}: deployed successfully`)
  } else if (result.status === DeploymentStatus.FAILED) {
    console.error(`${result.environment}: deployment failed`, result.error)
  }
}
```

## Next Steps

- [Versioning & Rollback](versioning_rollback.md) - Rollback strategies
