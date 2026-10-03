import { SurQLClient, SortDirection, Op } from '@oneiriq/surql'

// Setup connection
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

// READ
const premiumInsights = await client.query('orders')
  .groupBy('customer_id')
  .sum('total_amount')
  .count('order_id')
  .avg('order_value')
  .having('math::sum(total_amount)', Op.GREATER_THAN, 10000)
  .having('count(order_id)', Op.GREATER_THAN, 20)
  .orderBy('sum_total_amount', SortDirection.DESC)
  .page(1, 50)
  .execute()

console.log('Premium Customers Insights:', premiumInsights)

// CREATE
const product = await client.upsert('products', {
  sku: 'WIDGET-PRO-2024',
  name: 'Widget Pro 2024',
  price: 299.99,
  category: 'electronics',
  inventory: 150
})
  .withId('product:widget-pro-2024')
  .execute()

console.log('Upserted Product:', product)

// UPDATE
await client.patch('products', product.id, [
  { op: 'replace', path: '/price', value: 279.99 },
  { op: 'add', path: '/sale_end_date', value: '2024-12-31' },
  { op: 'add', path: '/tags/-', value: 'on-sale' }
])
  .execute()


// DELETE
await client.remove('products', product.id)
  .execute()

await client.invalidate()