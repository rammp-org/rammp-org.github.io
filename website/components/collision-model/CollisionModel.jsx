import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import Viewer from './Viewer'

// The models scripts/collision-models.mjs wrote, read when the page is built.
const dir = path.join(process.cwd(), 'public', 'collision-models')

export default async function CollisionModel() {
  if (!existsSync(dir)) {
    throw new Error(`${dir} is missing; run \`npm run collision-models\` (npm run build and dev do)`)
  }
  const files = (await readdir(dir)).filter(f => f.endsWith('.json')).sort()
  const models = await Promise.all(files.map(async f => JSON.parse(await readFile(path.join(dir, f), 'utf8'))))
  if (models.length === 0) throw new Error(`${dir} holds no collision models`)
  return <Viewer models={models} />
}
