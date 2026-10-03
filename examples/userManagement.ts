import { SurQLClient, SortDirection, Op } from '@oneiriq/surql'

const client = new SurQLClient({
  database: Deno.env.get('DB_DATABASE') || 'db',
  namespace: Deno.env.get('DB_NAMESPACE') || 'ns',
  host: Deno.env.get('DB_HOST') || 'localhost',
  username: Deno.env.get('DB_USERNAME') || 'root',
  password: Deno.env.get('DB_PASSWORD') || 'password',
  port: Deno.env.get('DB_PORT') || '8000',
  protocol: 'http',
  useSSL: false,
})

// TODO(@oneiriq): Clarity on the `signin` method usage vs the constructor options
const token = await client.signin({
  type: 'scope',
  namespace: 'myapp',
  database: 'users',
  scope: 'user',
  username: 'user@example.com',
  password: 'userPassword'
})

console.log('Token expires at:', token.expires?.toISOString() || 'No token')

// Get user analytics with session info
const userStats = await client.query('user_sessions')
  .where('user_id', Op.EQUALS, (await client.info()).id)
  .groupBy('device_type', 'location')
  .count('session_id')
  .sum('duration_minutes')
  .having('count(session_id)', Op.GREATER_THAN, 5)
  .orderBy('sum_duration_minutes', SortDirection.DESC)
  .execute()

console.log('User Analytics:', userStats)

// Bulk user activation with merge operations
const inactiveUsers = await client.query('users')
  .where({ status: 'inactive' })
  .where('last_login', Op.LESS_THAN, new Date('2024-01-01'))
  .execute()

console.log('Inactive Users:', inactiveUsers)

for (const user of inactiveUsers) {
  await client.merge('users', user.id, {
    status: 'reactivated',
    reactivation_date: new Date(),
    'notifications.reactivation_sent': true
  }).execute()
}

// Logout and cleanup
await client.invalidate()