# Installation

## Requirements

- **Deno** 2.x **or** Node.js 18+
- **SurrealDB** 2.0+

## Installing surql

=== "Deno (JSR)"

    Import directly — no install step required:

    ```typescript
    import { SurQLClient } from 'jsr:@oneiriq/surql'
    ```

    For convenience, add an import map to your `deno.json`:

    ```json
    {
      "imports": {
        "surql": "jsr:@oneiriq/surql",
        "surrealdb": "npm:surrealdb@^2.0.0"
      }
    }
    ```

    Then import with the short alias:

    ```typescript
    import { SurQLClient } from 'surql'
    ```

=== "Node.js (npm)"

    ```shell
    npm install @oneiriq/surql
    # or
    yarn add @oneiriq/surql
    # or
    pnpm add @oneiriq/surql
    ```

    ```typescript
    import { SurQLClient } from '@oneiriq/surql'
    ```

=== "Node.js (JSR)"

    ```shell
    npx jsr add @oneiriq/surql
    ```

## Installing SurrealDB

### macOS

```shell
brew install surrealdb/tap/surreal
```

### Linux

```shell
curl -sSf https://install.surrealdb.com | sh
```

### Windows (PowerShell)

```powershell
iwr https://windows.surrealdb.com -useb | iex
```

### Docker

```shell
docker pull surrealdb/surrealdb:latest
```

## Running SurrealDB

### Local Development (memory)

```shell
surreal start --user root --pass root memory
```

### Docker

```shell
docker run --rm -p 8000:8000 \
  surrealdb/surrealdb:latest \
  start --user root --pass root memory
```

### Docker Compose

```yaml
services:
  surrealdb:
    image: surrealdb/surrealdb:latest
    ports:
      - "8000:8000"
    command: start --user root --pass root memory
```

## Verify the Connection

```typescript
import { SurQLClient } from 'jsr:@oneiriq/surql'

const client = new SurQLClient({
  host: 'localhost',
  port: '8000',
  namespace: 'test',
  database: 'test',
  username: 'root',
  password: 'root',
})

const db = await client.getConnection()
const result = await db.query('SELECT * FROM $session')
console.log('Connected:', result)
await client.close()
```

## Next Steps

- Follow the [Quick Start](quickstart.md) tutorial
- Read the [Schema Definition Guide](schema.md)
- Explore [Query Builder](queries.md) documentation
