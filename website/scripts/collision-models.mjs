// Each robot's cuRobo collision model, from rammp-deployments, for the
// collision-model page: the boxes its planner composes into the collision
// world, and the arm's collision spheres with what places them.
//
// The files are resolved the way RAMMP-CuRobo's planner resolves them
// (core/rammp_curobo/config.py, scene.py, world.py, robot_config.py): names
// resolve next to the file that lists them; the world's own layers follow the
// planner config's; a world must be in the planning frame. A file the planner
// would refuse fails the build, naming the file.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { cloneRepo, siblingRepoDir } from './compose.mjs'
import { forwardKinematics } from '../components/collision-model/kinematics.mjs'

const websiteDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repoRoot = path.dirname(websiteDir)
const cacheDir = path.join(websiteDir, '.sources')
export const outDir = path.join(websiteDir, 'public', 'collision-models')

const SOURCE = { repo: 'rammp-org/rammp-deployments', slug: 'rammp-deployments', ref: 'dev' }

// The frame the planner plans in, and the root the arm's FK starts from.
const PLANNING_FRAME = 'arm_mount'

// RAMMP-CuRobo config.PLANNER_DEFAULTS, for the keys read here.
const PLANNER_DEFAULTS = {
  world_padding: 0.02,
  no_pad_names: ['pedestal'],
  collision_activation_distance: 0.03
}

const isMapping = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNumber = v => typeof v === 'number' && Number.isFinite(v)

// Every */config/robots/<robot>/curobo/planner.yaml, relative to repoDir.
export async function findPlannerConfigs(repoDir) {
  const found = []
  for (const top of await readdir(repoDir, { withFileTypes: true })) {
    if (!top.isDirectory() || top.name.startsWith('.')) continue
    const robotsDir = path.join(repoDir, top.name, 'config', 'robots')
    if (!existsSync(robotsDir)) continue
    for (const robot of await readdir(robotsDir, { withFileTypes: true })) {
      const rel = path.join(top.name, 'config', 'robots', robot.name, 'curobo', 'planner.yaml')
      if (robot.isDirectory() && existsSync(path.join(repoDir, rel))) found.push(rel)
    }
  }
  return found.sort()
}

// Loads one robot's model. `plannerRel` is planner.yaml's path in repoDir;
// every message names a file by its path there.
export async function loadCollisionModel(repoDir, plannerRel) {
  const rel = file => path.relative(repoDir, file)
  const fail = (file, message) => { throw new Error(`${rel(file)}: ${message}`) }

  async function readText(file) {
    if (!existsSync(file)) fail(file, 'not found')
    return readFile(file, 'utf8')
  }

  async function readYaml(file) {
    let data
    try {
      data = parse(await readText(file))
    } catch (err) {
      if (err.message.startsWith(rel(file))) throw err
      fail(file, `not valid YAML: ${err.message}`)
    }
    if (!isMapping(data)) fail(file, 'must be a YAML mapping')
    return data
  }

  // A name in `listing` resolves next to it, never anywhere else.
  function resolve(listing, ref, key) {
    if (typeof ref !== 'string' || ref === '') fail(listing, `${key} must be a file name, got ${JSON.stringify(ref)}`)
    if (ref.startsWith('example:')) {
      fail(listing, `${key} "${ref}" is a file inside the planner's image, which this site cannot read`)
    }
    const file = path.resolve(path.dirname(listing), ref)
    if (!existsSync(file)) fail(listing, `${key} "${ref}" not found (looked for ${rel(file)})`)
    return file
  }

  function vec3(file, where, v, { positive = false } = {}) {
    if (!Array.isArray(v) || v.length !== 3 || !v.every(isNumber) || (positive && !v.every(x => x >= 0))) {
      fail(file, `${where} must be 3 finite numbers${positive ? ' >= 0' : ''}, got ${JSON.stringify(v)}`)
    }
    return v
  }

  function obstacle(file, where, o) {
    if (!isMapping(o)) fail(file, `${where} must be a mapping`)
    if (typeof o.name !== 'string' || !o.name || o.name.includes('/')) {
      fail(file, `${where}: 'name' must be a non-empty string without '/', got ${JSON.stringify(o.name)}`)
    }
    const at = `${where} (${o.name})`
    return {
      name: o.name,
      position: vec3(file, `${at} position`, o.position),
      dims: vec3(file, `${at} dims`, o.dims, { positive: true }),
      rpy_deg: o.rpy_deg === undefined ? [0, 0, 0] : vec3(file, `${at} rpy_deg`, o.rpy_deg)
    }
  }

  // A prop: collision-checked as its bounding box (scene.SceneObject).
  function sceneObject(file, where, o) {
    if (!isMapping(o) || typeof o.name !== 'string' || !o.name) fail(file, `${where} must be a mapping with a name`)
    const at = `${where} (${o.name})`
    const type = o.type ?? 'box'
    const radius = o.radius ?? 0.03, height = o.height ?? 0.1
    if (!isNumber(radius) || !isNumber(height)) fail(file, `${at}: radius and height must be numbers`)
    const dims = type === 'cylinder' ? [2 * radius, 2 * radius, height]
      : type === 'sphere' ? [2 * radius, 2 * radius, 2 * radius]
        : type === 'box' ? vec3(file, `${at} dims`, o.dims ?? [0.05, 0.05, 0.05], { positive: true })
          : fail(file, `${at}: unknown type ${JSON.stringify(type)}`)
    return {
      name: o.name,
      position: vec3(file, `${at} position`, o.position),
      dims,
      rpy_deg: o.rpy_deg === undefined ? [0, 0, 0] : vec3(file, `${at} rpy_deg`, o.rpy_deg)
    }
  }

  function list(file, data, key, { required = false } = {}) {
    if (!(key in data)) {
      if (required) fail(file, `has no '${key}'; write \`${key}: []\` for none`)
      return []
    }
    if (!Array.isArray(data[key])) fail(file, `'${key}' must be a list, got ${JSON.stringify(data[key])}`)
    return data[key]
  }

  async function loadLayer(file) {
    const data = await readYaml(file)
    const name = data.layer
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name) || name === 'scene') {
      fail(file, `'layer' must match [a-z][a-z0-9_]* and not be 'scene', got ${JSON.stringify(name)}`)
    }
    const excludable = data.excludable ?? false
    if (typeof excludable !== 'boolean') fail(file, `'excludable' must be true or false`)
    if (!Array.isArray(data.obstacles) || data.obstacles.length === 0) fail(file, `'obstacles' must be a non-empty list`)
    const meta = data.meta ?? {}
    if (!isMapping(meta)) fail(file, `'meta' must be a mapping`)
    const paddingAssumed = meta.padding_assumed_m
    if (paddingAssumed !== undefined && !(isNumber(paddingAssumed) && paddingAssumed >= 0)) {
      fail(file, `meta.padding_assumed_m must be a number >= 0, got ${JSON.stringify(paddingAssumed)}`)
    }
    return {
      name,
      excludable,
      file,
      meta,
      paddingAssumed,
      obstacles: data.obstacles.map((o, i) => obstacle(file, `obstacles[${i}]`, o))
    }
  }

  // ---- planner config ----
  const plannerFile = path.join(repoDir, plannerRel)
  const planner = await readYaml(plannerFile)
  for (const key of ['robot', 'world']) {
    if (!(key in planner)) fail(plannerFile, `is missing the '${key}' entry`)
  }
  const settings = { ...PLANNER_DEFAULTS, ...(isMapping(planner.planner) ? planner.planner : {}) }
  for (const key of ['world_padding', 'collision_activation_distance']) {
    if (!(isNumber(settings[key]) && settings[key] >= 0)) {
      fail(plannerFile, `planner.${key} must be a number >= 0, got ${JSON.stringify(settings[key])}`)
    }
  }
  const noPad = settings.no_pad_names ?? []
  if (!Array.isArray(noPad) || !noPad.every(n => typeof n === 'string')) {
    fail(plannerFile, `planner.no_pad_names must be a list of box names, got ${JSON.stringify(noPad)}`)
  }

  // ---- robot file ----
  const robotFile = resolve(plannerFile, planner.robot, 'robot')
  const robot = await readYaml(robotFile)
  const kin = robot.robot_cfg?.kinematics
  if (!isMapping(kin)) fail(robotFile, 'has no robot_cfg.kinematics')
  if (kin.base_link !== PLANNING_FRAME) {
    fail(robotFile, `kinematics.base_link is ${JSON.stringify(kin.base_link)}; this page plans from ${PLANNING_FRAME}`)
  }
  if (typeof kin.ee_link !== 'string') fail(robotFile, 'has no kinematics.ee_link')
  const jointNames = kin.cspace?.joint_names
  const retract = kin.cspace?.retract_config
  if (!Array.isArray(jointNames) || !jointNames.every(n => typeof n === 'string')) {
    fail(robotFile, 'kinematics.cspace.joint_names must be a list of joint names')
  }
  if (!Array.isArray(retract) || retract.length !== jointNames.length || !retract.every(isNumber)) {
    fail(robotFile, `kinematics.cspace.retract_config must be ${jointNames.length} numbers`)
  }
  if (!isMapping(kin.collision_spheres)) {
    fail(robotFile, 'kinematics.collision_spheres must be the spheres themselves (a reference into cuRobo\'s own tree cannot be read here)')
  }
  const buffer = kin.collision_sphere_buffer ?? 0
  if (!isNumber(buffer)) fail(robotFile, 'kinematics.collision_sphere_buffer must be a number')
  // cuRobo builds spheres only for the links collision_link_names names.
  const linkNames = kin.collision_link_names ?? Object.keys(kin.collision_spheres)
  const spheres = {}
  for (const link of linkNames) {
    const listed = kin.collision_spheres[link] ?? []
    if (!Array.isArray(listed)) fail(robotFile, `collision_spheres.${link} must be a list`)
    spheres[link] = listed.map((s, i) => {
      const where = `collision_spheres.${link}[${i}]`
      if (!isMapping(s) || !isNumber(s.radius)) fail(robotFile, `${where} needs a numeric radius`)
      return { center: vec3(robotFile, `${where} center`, s.center), radius: s.radius }
    })
  }
  const lockJoints = kin.lock_joints ?? {}
  if (!isMapping(lockJoints) || !Object.values(lockJoints).every(isNumber)) {
    fail(robotFile, 'kinematics.lock_joints must map joint names to numbers')
  }
  const check = robot.model_check
  if (!isMapping(check) || typeof check.arm_base_link !== 'string') fail(robotFile, 'has no model_check.arm_base_link')
  const kinFile = resolve(robotFile, check.kinematics_reference, 'model_check.kinematics_reference')
  let joints
  try {
    joints = JSON.parse(await readText(kinFile))
  } catch (err) {
    fail(kinFile, `not valid JSON: ${err.message}`)
  }
  if (!isMapping(joints)) fail(kinFile, 'must be a JSON object of joints')
  for (const name of jointNames) {
    if (!isMapping(joints[name])) fail(kinFile, `has no joint ${name}, which ${rel(robotFile)} plans`)
  }

  // ---- the arm's mount ----
  const mountFile = path.join(path.dirname(plannerFile), '..', 'mount.yaml')
  const mount = await readYaml(mountFile)
  const mountRpy = vec3(mountFile, 'rpy_deg', mount.rpy_deg)

  // ---- world and layers ----
  const worldFile = resolve(plannerFile, planner.world, 'world')
  const world = await readYaml(worldFile)
  if (world.base_frame !== PLANNING_FRAME) {
    fail(worldFile, `base_frame is ${JSON.stringify(world.base_frame)}, expected "${PLANNING_FRAME}" (the planning frame)`)
  }
  const obstacles = list(worldFile, world, 'obstacles', { required: true }).map((o, i) => obstacle(worldFile, `obstacles[${i}]`, o))
  const objects = list(worldFile, world, 'objects').map((o, i) => sceneObject(worldFile, `objects[${i}]`, o))

  const layers = []
  for (const [listing, refs, source] of [
    [plannerFile, list(plannerFile, planner, 'layers'), 'planner'],
    [worldFile, list(worldFile, world, 'layers'), 'world']
  ]) {
    for (const ref of refs) {
      const file = resolve(listing, ref, 'layer')
      if (layers.some(l => l.file === file)) continue // one file is one layer
      const layer = await loadLayer(file)
      const other = layers.find(l => l.name === layer.name)
      if (other) fail(listing, `layer "${layer.name}" is defined by two files: ${rel(other.file)} and ${rel(file)}`)
      if (layer.paddingAssumed !== undefined && settings.world_padding < layer.paddingAssumed) {
        fail(file, `was generated for world_padding ${layer.paddingAssumed} and ${rel(plannerFile)} composes it with ${settings.world_padding}; the planner refuses that`)
      }
      layers.push({ ...layer, source })
    }
  }

  // ---- compose, in the planner's order ----
  const boxes = []
  const add = (file, id, layer, o, pad) => {
    if (boxes.some(b => b.id === id)) fail(file, `two collision boxes are named "${id}"`)
    if (!o.dims.every(d => d + 2 * pad > 0)) fail(file, `box "${id}" has a zero dim and no padding`)
    boxes.push({ id, layer, name: o.name, c: o.position, d: o.dims, rpy_deg: o.rpy_deg, pad })
  }
  const pad = settings.world_padding
  for (const o of obstacles) add(worldFile, o.name, 'scene', o, noPad.includes(o.name) ? 0 : pad)
  for (const o of objects) add(worldFile, `obj_${o.name}`, 'scene', o, pad)
  for (const layer of layers) {
    for (const o of layer.obstacles) add(layer.file, `${layer.name}/${o.name}`, layer.name, o, pad)
  }

  // What the planner does not check but the page depends on: generated layers
  // fitted to the arm where mount.yaml puts it. Shown on the page, not fatal:
  // the planner plans with them all the same.
  const warnings = []
  const placed = layers.filter(l => isMapping(l.meta.arm_base_in_mebot))
  for (const layer of layers) {
    const tilt = layer.meta.arm_base_joint?.rpy_deg
    if (Array.isArray(tilt) && tilt.some((v, i) => v !== mountRpy[i])) {
      warnings.push(`${rel(layer.file)} was generated for the arm tilted rpy_deg ${JSON.stringify(tilt)}, ` +
        `but ${rel(mountFile)} says ${JSON.stringify(mountRpy)}: regenerate the layers`)
    }
  }
  const where = l => JSON.stringify(l.meta.arm_base_in_mebot.position)
  if (placed.some(l => where(l) !== where(placed[0]))) {
    warnings.push(`the layers disagree on where the arm sits on the chair: ${placed.map(l => `${l.name} ${where(l)}`).join(', ')}`)
  }

  const curoboDir = path.dirname(plannerFile)
  const model = {
    id: plannerRel.split(path.sep).filter((_, i) => i === 0 || i === 3).join('-'),
    deployment: plannerRel.split(path.sep)[0],
    robot: plannerRel.split(path.sep)[3],
    dir: path.dirname(plannerRel).split(path.sep).join('/'),
    world_padding: pad,
    collision_activation_distance: settings.collision_activation_distance,
    sphere_buffer: buffer,
    base_link: PLANNING_FRAME,
    arm_base_link: check.arm_base_link,
    ee_link: kin.ee_link,
    mount_rpy_deg: mountRpy,
    joint_names: jointNames,
    retract,
    lock_joints: lockJoints,
    joints,
    spheres,
    layers: [
      ...(obstacles.length + objects.length ? [{ name: 'scene', source: 'world', file: path.relative(curoboDir, worldFile), excludable: false }] : []),
      ...layers.map(l => ({ name: l.name, source: l.source, file: path.relative(curoboDir, l.file), excludable: l.excludable }))
    ],
    boxes,
    mebot: mebotMeta(layers),
    warnings
  }

  // Every link with spheres, and the tool, must hang off the chain.
  const T = forwardKinematics(model, retract)
  for (const link of [...Object.keys(spheres), kin.ee_link]) {
    if (!T[link]) fail(kinFile, `does not reach ${link}, which ${rel(robotFile)} names`)
  }
  return model
}

// What the key-dimensions panel needs, when the layers carry the MEBot layer
// generator's meta (RAMMP-CuRobo scripts/generate_layers.py); null otherwise.
export function mebotMeta(layers) {
  const by = Object.fromEntries(layers.map(l => [l.name, l]))
  const seat = by.seat?.meta, person = by.person?.meta
  const wheels = ['drive_wheel_l', 'drive_wheel_r']
  if (!seat?.parts || !seat?.arm_base_in_mebot?.position || !person?.seat || !by.floor ||
      !wheels.every(n => by.platform?.obstacles.some(o => o.name === n))) {
    return null
  }
  const floor = by.floor.obstacles[0]
  return {
    arm_base_in_mebot: seat.arm_base_in_mebot.position,
    seat_parts: seat.parts,
    person_seat: person.seat,
    floor_top: floor.position[2] + floor.dims[2] / 2
  }
}

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
}

export async function writeCollisionModels(repoDir, source, into = outDir) {
  const configs = await findPlannerConfigs(repoDir)
  if (configs.length === 0) {
    throw new Error(`${source.repo}@${source.ref} has no */config/robots/<robot>/curobo/planner.yaml`)
  }
  await rm(into, { recursive: true, force: true })
  await mkdir(into, { recursive: true })
  for (const rel of configs) {
    const model = { ...(await loadCollisionModel(repoDir, rel)), source }
    await writeFile(path.join(into, `${model.id}.json`), JSON.stringify(model))
    const counts = model.layers.map(l => `${l.name} ${model.boxes.filter(b => b.layer === l.name).length}`)
    console.log(`collision-models: ${model.id}: ${model.boxes.length} boxes (${counts.join(', ')})`)
    for (const w of model.warnings) console.warn(`collision-models: ${model.id}: warning: ${w}`)
  }
}

if (import.meta.filename === process.argv[1]) {
  const sibling = process.env.CI ? null : siblingRepoDir(repoRoot, SOURCE)
  let repoDir = sibling
  if (!sibling) {
    await rm(path.join(cacheDir, SOURCE.slug), { recursive: true, force: true })
    repoDir = cloneRepo(SOURCE, cacheDir)
  }
  const source = {
    repo: SOURCE.repo,
    ref: sibling ? `local checkout (${git(repoDir, 'rev-parse', '--abbrev-ref', 'HEAD')})` : SOURCE.ref,
    sha: git(repoDir, 'rev-parse', 'HEAD'),
    date: git(repoDir, 'log', '-1', '--format=%cs')
  }
  console.log(`collision-models: <- ${sibling ? `${repoDir} (local)` : `${SOURCE.repo}@${SOURCE.ref}`} ${source.sha.slice(0, 7)}`)
  await writeCollisionModels(repoDir, source)
}
