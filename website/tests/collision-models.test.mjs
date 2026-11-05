import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findPlannerConfigs, loadCollisionModel, writeCollisionModels } from '../scripts/collision-models.mjs'
import { armSpheres, boxFrame, forwardKinematics, signedDistance } from '../components/collision-model/kinematics.mjs'

// flatbot's and dojo's files from rammp-deployments dev at 20001af.
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rammp-deployments')
const FLATBOT = 'december_2026/config/robots/flatbot/curobo/planner.yaml'
const DOJO = 'december_2026/config/robots/dojo/curobo/planner.yaml'
const REST = [0.067, -1.898, -3.137, -2.269, -0.211, -0.684, 1.725]

const count = (model, layer) => model.boxes.filter(b => b.layer === layer).length

// The planner's own check: each box's deepest sphere, with the sphere buffer.
function penetrations(model, q) {
  const { spheres } = armSpheres(model, q)
  const out = {}
  for (const box of model.boxes.map(boxFrame)) {
    const d = Math.min(...spheres.map(s => signedDistance(s.p, s.r + model.sphere_buffer, box)))
    if (d < 0) out[box.id] = Math.round(d * 10000) / 10
  }
  return out
}

// A copy of dojo's robot directory to edit, in a repo of its own.
async function scratchRobot() {
  const repo = await mkdtemp(path.join(tmpdir(), 'collision-models-'))
  const dir = path.join(repo, 'dep', 'config', 'robots', 'bot')
  await cp(path.join(FIXTURE, 'december_2026/config/robots/dojo'), dir, { recursive: true })
  const write = (rel, text) => writeFile(path.join(dir, 'curobo', rel), text)
  return { repo, dir, write, planner: 'dep/config/robots/bot/curobo/planner.yaml' }
}

const LAYER = (name, box = 'b', extra = '') =>
  `layer: ${name}\n${extra}obstacles:\n  - {name: ${box}, position: [0.5, 0, 0], dims: [0.1, 0.1, 0.1]}\n`

test('finds every robot with a curobo/planner.yaml', async () => {
  assert.deepEqual(await findPlannerConfigs(FIXTURE), [DOJO, FLATBOT].map(p => p.split('/').join(path.sep)))
})

test('flatbot composes 30 boxes: platform 16, seat 5, person 8, floor 1', async () => {
  const model = await loadCollisionModel(FIXTURE, FLATBOT)
  assert.equal(model.id, 'december_2026-flatbot')
  assert.equal(model.boxes.length, 30)
  assert.deepEqual(['platform', 'seat', 'person', 'floor'].map(l => count(model, l)), [16, 5, 8, 1])
  assert.ok(model.boxes.every(b => b.pad === 0.02))
  assert.deepEqual(model.mount_rpy_deg, [0, 30, 0])
  assert.equal(model.sphere_buffer, 0.005)
  assert.deepEqual(model.mebot.arm_base_in_mebot, [0.505, 0.36, 0.376])
})

test('dojo has its pedestal and table, the pedestal unpadded, and no chair', async () => {
  const model = await loadCollisionModel(FIXTURE, DOJO)
  assert.deepEqual(model.boxes.map(b => [b.id, b.pad]), [['pedestal', 0], ['table', 0.02]])
  assert.equal(model.mebot, null)
})

test('FK at retract puts flatbot\'s tool frame where the planner does', async () => {
  const model = await loadCollisionModel(FIXTURE, FLATBOT)
  const T = forwardKinematics(model, model.retract)
  const tool = [0, 1, 2].map(i => Math.round(T[model.ee_link][i][3] * 1e4) / 1e4)
  assert.deepEqual(tool, [0.7162, 0.0011, 0.0872])
})

test('flatbot at rest reproduces the planner\'s penetrations', async () => {
  const model = await loadCollisionModel(FIXTURE, FLATBOT)
  assert.deepEqual(penetrations(model, REST), {
    'person/torso_0': -24.9,
    'person/torso_2': -9.0,
    'seat/backrest': -5.0
  })
})

test('a world layer resolves next to the world file, a config layer next to planner.yaml', async () => {
  const { repo, dir, write, planner } = await scratchRobot()
  await mkdir(path.join(dir, 'curobo', 'worlds', 'layers'), { recursive: true })
  await write('planner.yaml', 'robot: robot.yaml\nworld: worlds/w.yaml\nlayers: [chair.yaml]\n')
  await write('chair.yaml', LAYER('chair'))
  await write('worlds/w.yaml', 'base_frame: arm_mount\nlayers: [layers/floor.yaml]\nobstacles: []\n')
  await write('worlds/layers/floor.yaml', LAYER('floor'))
  const model = await loadCollisionModel(repo, planner)
  assert.deepEqual(model.boxes.map(b => b.id), ['chair/b', 'floor/b'])
  assert.deepEqual(model.layers.map(l => [l.name, l.source]), [['chair', 'planner'], ['floor', 'world']])
})

test('composes scene obstacles, props, config layers, then world layers', async () => {
  const { repo, write, planner } = await scratchRobot()
  await write('planner.yaml', 'robot: robot.yaml\nworld: world.yaml\nlayers: [a.yaml, both.yaml]\n')
  await write('a.yaml', LAYER('a'))
  await write('both.yaml', LAYER('both'))
  await write('world.yaml', [
    'base_frame: arm_mount',
    'layers: [both.yaml]',
    'obstacles: [{name: pedestal, position: [0, 0, -0.05], dims: [0.14, 0.14, 0.04]}]',
    'objects: [{name: mug, type: cylinder, radius: 0.04, height: 0.1, position: [0.4, 0, 0]}]'
  ].join('\n'))
  const model = await loadCollisionModel(repo, planner)
  assert.deepEqual(model.boxes.map(b => b.id), ['pedestal', 'obj_mug', 'a/b', 'both/b'])
  assert.deepEqual(model.boxes[1].d, [0.08, 0.08, 0.1])
})

test('a world not in arm_mount is refused, naming the world file', async () => {
  const { repo, write, planner } = await scratchRobot()
  await write('world.yaml', 'base_frame: arm_base_link\nobstacles: []\n')
  await assert.rejects(loadCollisionModel(repo, planner),
    /dep\/config\/robots\/bot\/curobo\/world\.yaml: base_frame is "arm_base_link", expected "arm_mount"/)
})

test('a missing layer is named, with the file that lists it', async () => {
  const { repo, write, planner } = await scratchRobot()
  await write('planner.yaml', 'robot: robot.yaml\nworld: world.yaml\nlayers: [gone.yaml]\n')
  await assert.rejects(loadCollisionModel(repo, planner),
    /curobo\/planner\.yaml: layer "gone\.yaml" not found \(looked for .*curobo\/gone\.yaml\)/)
})

test('a missing mount.yaml is named', async () => {
  const { repo, dir, planner } = await scratchRobot()
  await rm(path.join(dir, 'mount.yaml'))
  await assert.rejects(loadCollisionModel(repo, planner), /dep\/config\/robots\/bot\/mount\.yaml: not found/)
})

test('malformed YAML is named', async () => {
  const { repo, write, planner } = await scratchRobot()
  await write('world.yaml', 'base_frame: arm_mount\nobstacles: [\n')
  await assert.rejects(loadCollisionModel(repo, planner), /curobo\/world\.yaml: not valid YAML/)
})

test('one layer name from two files is refused', async () => {
  const { repo, write, planner } = await scratchRobot()
  await write('planner.yaml', 'robot: robot.yaml\nworld: world.yaml\nlayers: [a.yaml, b.yaml]\n')
  await write('a.yaml', LAYER('chair'))
  await write('b.yaml', LAYER('chair'))
  await assert.rejects(loadCollisionModel(repo, planner), /layer "chair" is defined by two files/)
})

test('a layer generated for more padding than configured is refused', async () => {
  const { repo, write, planner } = await scratchRobot()
  await write('planner.yaml', 'robot: robot.yaml\nworld: world.yaml\nlayers: [a.yaml]\nplanner: {world_padding: 0.01}\n')
  await write('a.yaml', LAYER('a', 'b', 'meta: {padding_assumed_m: 0.02}\n'))
  await assert.rejects(loadCollisionModel(repo, planner), /a\.yaml: was generated for world_padding 0\.02/)
})

test('a rotated obstacle keeps its rpy_deg, and distances follow the rotation', async () => {
  const { repo, write, planner } = await scratchRobot()
  await write('world.yaml', 'base_frame: arm_mount\nobstacles:\n' +
    '  - {name: plank, position: [1, 0, 0], dims: [1.0, 0.1, 0.1], rpy_deg: [0, 0, 90]}\n')
  const model = await loadCollisionModel(repo, planner)
  const plank = boxFrame(model.boxes[0])
  assert.deepEqual(plank.rpy_deg, [0, 0, 90])
  // Turned 90 degrees about z, the plank runs along y: (1, 0.4, 0) is inside,
  // (1.4, 0, 0) is 0.4 - 0.05 - 0.02 = 0.33 m outside.
  assert.ok(signedDistance([1, 0.4, 0], 0, plank) < 0)
  assert.equal(Math.round(signedDistance([1.4, 0, 0], 0, plank) * 1000), 330)
})

test('writes one JSON per robot, stamped with its source', async () => {
  const into = await mkdtemp(path.join(tmpdir(), 'collision-models-out-'))
  const source = { repo: 'rammp-org/rammp-deployments', ref: 'dev', sha: '20001af', date: '2026-11-03' }
  await writeCollisionModels(FIXTURE, source, into)
  assert.deepEqual((await readdir(into)).sort(), ['december_2026-dojo.json', 'december_2026-flatbot.json'])
  const flatbot = JSON.parse(await readFile(path.join(into, 'december_2026-flatbot.json'), 'utf8'))
  assert.deepEqual(flatbot.source, source)
})
