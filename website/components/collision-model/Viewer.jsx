'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { armSpheres, boxCorners, boxFrame, signedDistance } from './kinematics.mjs'
import s from './viewer.module.css'

const DEGR = 180 / Math.PI
const STORE = 'rammp-collision-model'
// Where the arm parks on flatbot (snorlax), read from /joint_states.
const REST = { 'december_2026-flatbot': [0.067, -1.898, -3.137, -2.269, -0.211, -0.684, 1.725] }
const COLORED = ['platform', 'seat', 'person', 'floor', 'scene']
const layerVar = layer => `--cm-${COLORED.includes(layer) ? layer : 'other'}`
const layerColor = layer => `var(${layerVar(layer)})`

const fmt = (v, n = 3) => (Math.abs(v) < 5e-7 ? 0 : v).toFixed(n)
const mm = v => Math.round(v * 1000)
const cx = (...names) => names.filter(Boolean).join(' ')

// Per-viewer conveniences only: the page works without them.
function recall(key) {
  try {
    const v = localStorage.getItem(`${STORE}.${key}`)
    return v === null ? undefined : JSON.parse(v)
  } catch {
    return undefined
  }
}
function store(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(`${STORE}.${key}`)
    else localStorage.setItem(`${STORE}.${key}`, JSON.stringify(value))
  } catch {}
}

function posesOf(model) {
  return [
    ...(REST[model.id] ? [{ key: 'rest', label: 'Rest (snorlax park)', q: REST[model.id] }] : []),
    { key: 'retract', label: 'Retract (IK seed)', q: model.retract },
    { key: 'zero', label: 'All zero', q: model.joint_names.map(() => 0) }
  ]
}

const MOUNT = { label: 'arm_mount (what the planner uses)', short: 'arm_mount', shift: [0, 0, 0] }
function framesOf(model) {
  if (!model.mebot) return { mount: MOUNT }
  const o = model.mebot.arm_base_in_mebot
  return {
    ground: { label: 'chair, height above floor', short: 'chair x, y; z above the floor', shift: [o[0], o[1], -model.mebot.floor_top] },
    mebot: { label: 'chair URDF (base_link)', short: 'chair URDF base_link', shift: o },
    mount: MOUNT
  }
}

// The chair's key dimensions, for a robot whose layers came from the MEBot
// layer generator. A row whose inputs the layers lack is left out.
function keyDimensionsOf(model) {
  const m = model.mebot
  if (!m) return null
  const off = m.arm_base_in_mebot, seat = m.seat_parts, centreY = m.person_seat.centreline_y
  const groundZ = m.floor_top + off[2]
  const pf = name => model.boxes.find(b => b.layer === 'platform' && b.name === name)
  const platform = model.boxes.filter(b => b.layer === 'platform')
  const axleX = pf('drive_wheel_l').c[0] + off[0]
  const frontCaster = pf('front_caster_wheel_l'), rearCaster = pf('rear_caster_wheel_l') ?? pf('rear_casteer_wheel_l')
  const groups = [
    ['Arm mount', [
      ['arm-h', 'Arm base above floor', off[2] - groundZ, "bottom of the arm's base, on its axis"],
      ['arm-x', 'Arm base ahead of drive axle', off[0] - axleX, 'axle = drive wheel centre'],
      ['arm-y', 'Arm base left of seat centreline', off[1] - centreY],
      ['arm-bx', 'Arm base ahead of backrest face', off[0] - seat.backrest?.[1][0]],
      ['arm-sx', 'Arm base behind seat front edge', seat.base?.[1][0] - off[0]],
      ['arm-t', 'Arm tilt forward (degrees)', model.mount_rpy_deg[1], '', true]
    ]],
    ['Seat', [
      ['seat-h', 'Seat pan top above floor', seat.base?.[1][2] - groundZ],
      ['seat-w', 'Seat base width', seat.base?.[1][1] - seat.base?.[0][1]],
      ['seat-d', 'Seat base depth', seat.base?.[1][0] - seat.base?.[0][0]],
      ['seat-f', 'Seat front edge ahead of drive axle', seat.base?.[1][0] - axleX],
      ['seat-b', 'Seat base bottom above floor', seat.base?.[0][2] - groundZ],
      ['back-x', 'Backrest face behind drive axle', axleX - seat.backrest?.[1][0], "the occupant's back sits here"],
      ['back-h', 'Backrest top above floor', seat.backrest?.[1][2] - groundZ],
      ['arm-r-h', 'Armrest (right) top above floor', seat.armrest?.[1][2] - groundZ],
      ['arm-r-b', 'Armrest (right) bottom above floor', seat.armrest?.[0][2] - groundZ],
      ['arm-r-y', 'Armrest inner edge right of centreline', centreY - seat.armrest?.[1][1]],
      ['arm-r-f', 'Armrest front ahead of drive axle', seat.armrest?.[1][0] - axleX]
    ]],
    ['Drive base', [
      ['dw-d', 'Drive wheel diameter', pf('drive_wheel_l').d[2]],
      ['dw-t', 'Drive wheel track, centre to centre', pf('drive_wheel_l').c[1] - pf('drive_wheel_r').c[1]],
      ['fc-d', 'Front caster wheel diameter', frontCaster?.d[2]],
      ['fc-x', 'Front caster centre ahead of axle', frontCaster?.c[0] + off[0] - axleX],
      ['rc-d', 'Rear caster wheel diameter', rearCaster?.d[2]],
      ['rc-x', 'Rear caster centre behind axle', axleX - (rearCaster?.c[0] + off[0])],
      ['len', 'Drive base length, front to back',
        Math.max(...platform.map(b => b.c[0] + b.d[0] / 2)) - Math.min(...platform.map(b => b.c[0] - b.d[0] / 2)),
        'platform boxes only']
    ]]
  ]
  return groups
    .map(([group, rows]) => [group, rows
      .filter(r => Number.isFinite(r[2]))
      .map(([key, label, v, note = '', deg = false]) => ({ key, label, note, deg, model: deg ? v : v * 1000 }))])
    .filter(([, rows]) => rows.length)
}

// The links from the planning frame down to the tool, for the arm's line.
function chainOf(model) {
  const byChild = Object.fromEntries(Object.values(model.joints).map(j => [j.child, j]))
  const links = [model.ee_link]
  while (byChild[links[0]]) links.unshift(byChild[links[0]].parent)
  return links
}

// Convex hull (monotone chain) of 2D points: a box seen along an axis.
function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = list => {
    const out = []
    for (const q of list) {
      while (out.length >= 2 && cross(out.at(-2), out.at(-1), q) <= 0) out.pop()
      out.push(q)
    }
    return out.slice(0, -1)
  }
  return [...half(p), ...half(p.reverse())]
}

// Frees what a group holds and empties it; `shared` geometry and materials stay.
function release(group, shared = new Set()) {
  group.traverse(o => {
    if (o === group) return
    for (const r of [o.geometry, ...[o.material].flat()]) if (r && !shared.has(r)) r.dispose()
  })
  group.clear()
}

// The box around `points`, or around the origin when there are none.
function aabb(points) {
  if (points.length === 0) points = [[0, 0, 0]]
  const lo = [0, 1, 2].map(i => Math.min(...points.map(p => p[i])))
  const hi = [0, 1, 2].map(i => Math.max(...points.map(p => p[i])))
  return { lo, hi }
}

export default function Viewer({ models }) {
  const [robotId, setRobotId] = useState((models.find(m => m.mebot) ?? models[0]).id)
  const model = models.find(m => m.id === robotId)
  const d = useMemo(() => ({
    boxes: model.boxes.map(boxFrame),
    poses: posesOf(model),
    frames: framesOf(model),
    dims: keyDimensionsOf(model),
    chain: chainOf(model),
    unpadded: model.boxes.filter(b => b.pad === 0).map(b => b.id)
  }), [model])
  const floorTop = model.mebot?.floor_top

  const [frameKey, setFrameKey] = useState('ground')
  const frame = d.frames[frameKey] ?? d.frames.mount
  const [hidden, setHidden] = useState({})
  const [showPad, setShowPad] = useState(true)
  const [showArm, setShowArm] = useState(true)
  const [pose, setPose] = useState(d.poses[0].key)
  const [q, setQ] = useState(d.poses[0].q)
  const [selId, setSelId] = useState(null)
  const [meas, setMeas] = useState({})
  const [theme, setTheme] = useState(0)
  const [noGl, setNoGl] = useState(false)
  const sel = d.boxes.find(b => b.id === selId) ?? null
  const shown = layer => !hidden[layer]

  function chooseRobot(id) {
    const next = models.find(m => m.id === id)
    const first = posesOf(next)[0]
    setRobotId(id)
    setPose(first.key)
    setQ(first.q)
    setSelId(null)
    store('robot', id)
  }

  // What this viewer chose last time, after hydration.
  useEffect(() => {
    const robot = recall('robot')
    if (robot && robot !== robotId && models.some(m => m.id === robot)) chooseRobot(robot)
    const f = recall('frame')
    if (f) setFrameKey(f)
  }, [])
  useEffect(() => { setMeas(recall(`${robotId}.meas`) ?? {}) }, [robotId])

  const toF = p => p.map((v, i) => v + frame.shift[i])

  // ---- arm ----
  const arm = useMemo(() => {
    const { T, spheres } = armSpheres(model, q)
    const nearest = {}
    for (const sp of spheres) {
      sp.best = Infinity
      for (const b of d.boxes) {
        if (!shown(b.layer)) continue
        const dist = signedDistance(sp.p, sp.r + model.sphere_buffer, b)
        if (dist < sp.best) sp.best = dist
        if (!nearest[b.id] || dist < nearest[b.id].d) nearest[b.id] = { d: dist, s: sp, b }
      }
    }
    const tool = [0, 1, 2].map(i => T[model.ee_link][i][3])
    return { T, spheres, tool, nearest: Object.values(nearest).sort((a, b) => a.d - b.d).slice(0, 10) }
  }, [model, d, q, hidden])
  const act = model.collision_activation_distance
  const sphereColor = sp => (sp.best < 0 ? 'hit' : sp.best < act ? 'warn' : 'arm')

  function setPoseTo(key) {
    const p = d.poses.find(x => x.key === key)
    setPose(key)
    if (p) setQ(p.q)
  }
  function setJoint(i, deg) {
    if (!Number.isFinite(deg)) return
    setQ(q.map((v, j) => (j === i ? deg / DEGR : v)))
    setPose('custom')
  }
  const qText = useRef(null)
  function applyText() {
    const input = qText.current
    const nums = (input.value.match(/[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/gi) || []).map(Number)
    if (nums.length !== model.joint_names.length) {
      input.setCustomValidity(`Give ${model.joint_names.length} joint angles in radians.`)
      input.reportValidity()
      return
    }
    input.setCustomValidity('')
    setQ(nums)
    setPose('custom')
  }

  // ---- theme ----
  useEffect(() => {
    const bump = () => setTheme(t => t + 1)
    const mo = new MutationObserver(bump)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', bump)
    return () => { mo.disconnect(); mq.removeEventListener('change', bump) }
  }, [])
  const probe = useRef(null)
  const color = name => {
    probe.current.style.color = `var(${name})`
    return new THREE.Color(getComputedStyle(probe.current).color)
  }

  // ---- 3D ----
  const canvas = useRef(null)
  const gl = useRef(null)
  const live = useRef(null)
  live.current = { hidden, setSelId }

  useEffect(() => {
    const el = canvas.current
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true })
    } catch {
      setNoGl(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 50)
    camera.up.set(0, 0, 1)
    const controls = new OrbitControls(camera, el)
    controls.enableDamping = true
    scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2.7))
    const sun = new THREE.DirectionalLight(0xffffff, 1.7)
    sun.position.set(2, 1.5, 3)
    scene.add(sun)
    const world = new THREE.Group()
    scene.add(world)
    const resize = () => {
      const r = el.parentElement.getBoundingClientRect()
      renderer.setSize(r.width, r.height, false)
      camera.aspect = r.width / Math.max(1, r.height)
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el.parentElement)
    resize()
    let raf
    const loop = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop) }
    loop()

    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()
    let down = null
    const onDown = e => { down = [e.clientX, e.clientY] }
    const onUp = e => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return
      const r = el.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const { hidden, setSelId } = live.current
      const hits = ray.intersectObjects(gl.current.boxMeshes.filter(m => !hidden[m.userData.box.layer]))
      setSelId(hits.length ? hits[0].object.userData.box.id : null)
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    gl.current = { renderer, scene, camera, controls, world, boxMeshes: [] }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      controls.dispose()
      renderer.dispose()
      gl.current = null
    }
  }, [])

  // The view that frames this robot: its boxes (not the floor) and its arm.
  function resetView() {
    const g = gl.current
    if (!g) return
    const pts = d.boxes.filter(b => b.layer !== 'floor').flatMap(b => boxCorners(b))
    for (const sp of armSpheres(model, d.poses[0].q).spheres) pts.push(sp.p)
    const { lo, hi } = aabb(pts)
    const target = new THREE.Vector3(...lo.map((v, i) => (v + hi[i]) / 2))
    const size = Math.max(...hi.map((v, i) => v - lo[i]))
    g.controls.target.copy(target)
    g.camera.position.copy(target).add(new THREE.Vector3(2.4, 1.9, 1.25).normalize().multiplyScalar(size * 2.4))
    g.controls.update()
  }
  useEffect(resetView, [model])

  // The boxes, padding, grid and axes: per robot and per theme.
  useEffect(() => {
    const g = gl.current
    if (!g) return
    release(g.world)
    g.sphere?.dispose()
    Object.values(g.mats ?? {}).forEach(m => m.dispose())
    g.boxMeshes = []
    g.scene.background = color('--cm-sheet')
    g.layers = {}
    for (const layer of new Set(d.boxes.map(b => b.layer))) {
      g.layers[layer] = new THREE.Group()
      g.world.add(g.layers[layer])
    }
    const place = (obj, b) => {
      obj.position.set(...b.c)
      obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(...b.R[0], 0, ...b.R[1], 0, ...b.R[2], 0, 0, 0, 0, 1))
      return obj
    }
    g.pad = new THREE.Group()
    for (const b of d.boxes) {
      if (b.layer === 'floor') continue
      const c = color(layerVar(b.layer))
      const geo = new THREE.BoxGeometry(...b.d)
      const mesh = place(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
        color: c, transparent: true, opacity: b.layer === 'person' ? 0.22 : 0.3, depthWrite: false
      })), b)
      mesh.userData.box = b
      g.layers[b.layer].add(mesh, place(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: c })), b))
      g.boxMeshes.push(mesh)
      if (b.pad > 0) {
        const pad = place(new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(...b.d.map(v => v + 2 * b.pad))),
          new THREE.LineDashedMaterial({ color: c, dashSize: 0.012, gapSize: 0.01, transparent: true, opacity: 0.7 })), b)
        pad.computeLineDistances()
        pad.userData.layer = b.layer
        g.pad.add(pad)
      }
    }
    // The ground: a grid of 100 mm cells under the boxes, on the floor's top
    // or under the lowest box.
    const { lo, hi } = aabb(d.boxes.filter(b => b.layer !== 'floor').flatMap(b => boxCorners(b)))
    const grid = new THREE.GridHelper(2.4, 24, color('--cm-floor'), color('--cm-grid'))
    grid.rotation.x = Math.PI / 2
    const mid = i => Math.round((lo[i] + hi[i]) * 5) / 10
    grid.position.set(mid(0), mid(1), (floorTop ?? lo[2]) + 0.0005)
    ;(g.layers.floor ?? g.world).add(grid)
    g.world.add(g.pad, new THREE.AxesHelper(0.15))
    g.arm = new THREE.Group()
    g.sel = new THREE.Group()
    g.tool = new THREE.AxesHelper(0.07)
    g.tool.matrixAutoUpdate = false
    g.world.add(g.arm, g.sel, g.tool)
    g.sphere = new THREE.SphereGeometry(1, 20, 14)
    const sphereMat = name => new THREE.MeshLambertMaterial({ color: color(name), transparent: true, opacity: 0.55, depthWrite: false })
    g.mats = { arm: sphereMat('--cm-arm'), hit: sphereMat('--cm-hit'), warn: sphereMat('--cm-warn'), ink: new THREE.LineBasicMaterial({ color: color('--cm-ink') }) }
    g.shared = new Set([g.sphere, ...Object.values(g.mats)])
  }, [d, theme])

  // What changes with the controls: visibility, the arm, the selection.
  useEffect(() => {
    const g = gl.current
    if (!g?.arm) return
    for (const [layer, group] of Object.entries(g.layers)) group.visible = shown(layer)
    g.pad.children.forEach(c => { c.visible = showPad && shown(c.userData.layer) })
    release(g.arm, g.shared)
    g.tool.visible = showArm
    if (showArm) {
      for (const sp of arm.spheres) {
        const m = new THREE.Mesh(g.sphere, g.mats[sphereColor(sp)])
        m.scale.setScalar(sp.r + (showPad ? model.sphere_buffer : 0))
        m.position.set(...sp.p)
        g.arm.add(m)
      }
      const pts = d.chain.filter(n => arm.T[n]).map(n => new THREE.Vector3(arm.T[n][0][3], arm.T[n][1][3], arm.T[n][2][3]))
      g.arm.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), g.mats.ink))
      const T = arm.T[model.ee_link]
      g.tool.matrix.set(...T[0], ...T[1], ...T[2], 0, 0, 0, 1)
    }
    release(g.sel)
    if (sel) {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...sel.d.map(v => v + 0.004))),
        new THREE.LineBasicMaterial({ color: color('--cm-accent') }))
      e.position.set(...sel.c)
      e.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(...sel.R[0], 0, ...sel.R[1], 0, ...sel.R[2], 0, 0, 0, 0, 1))
      g.sel.add(e)
    }
  }, [d, theme, arm, hidden, showPad, showArm, sel])

  // ---- key dimensions ----
  function measure(key, value) {
    const next = { ...meas }
    if (value === '') delete next[key]
    else next[key] = +value
    setMeas(next)
    store(`${robotId}.meas`, Object.keys(next).length ? next : undefined)
  }
  function delta(r) {
    const m = meas[r.key]
    if (m === undefined || Number.isNaN(m)) return null
    const diff = m - r.model, tol = r.deg ? [1, 3] : [10, 25]
    return {
      text: (diff >= 0 ? '+' : '') + diff.toFixed(r.deg ? 1 : 0) + (r.deg ? '°' : ''),
      cls: Math.abs(diff) <= tol[0] ? s.good : Math.abs(diff) <= tol[1] ? s.near : s.bad
    }
  }
  const [copied, setCopied] = useState(null)
  function copyDims() {
    const lines = [`${model.robot} key dimensions (model vs measured, mm)`]
    for (const [group, rows] of d.dims) {
      lines.push('', group)
      for (const r of rows) {
        const m = meas[r.key]
        lines.push(`  ${r.label}: model ${r.model.toFixed(r.deg ? 0 : 1)}` +
          (m !== undefined ? `, measured ${m}, diff ${(m - r.model >= 0 ? '+' : '') + (m - r.model).toFixed(1)}` : ''))
      }
    }
    navigator.clipboard.writeText(lines.join('\n')).then(() => setCopied('Copied'), () => setCopied('Copy blocked'))
    setTimeout(() => setCopied(null), 1500)
  }

  // ---- 2D sheet ----
  const readouts = useRef([])
  const sheet = useMemo(() => {
    const S = 300, G = 70, L = 46, T0 = 26 // px per m, gap between views, left margin, title room
    const drawn = d.boxes.filter(b => b.layer !== 'floor')
    const pts = drawn.flatMap(b => boxCorners(b))
    if (showArm) for (const sp of arm.spheres) for (const sg of [-1, 1]) pts.push(sp.p.map(v => v + sg * sp.r))
    if (floorTop !== undefined) pts.push([0, 0, floorTop])
    const box = aabb(pts)
    const lo = box.lo.map((v, i) => v - (i === 2 && floorTop !== undefined ? 0.03 : 0.06))
    const hi = box.hi.map(v => v + 0.06)
    const xr = hi[0] - lo[0], yr = hi[1] - lo[1], zr = hi[2] - lo[2]
    const W = L + xr * S + G + yr * S + 20, H = T0 + yr * S + G + zr * S + 62
    const chair = model.mebot ? " (chair's left)" : ''
    const panels = [
      { title: `TOP  ·  x →, y ↑${chair}`, u: 0, v: 1, x0: L, y0: T0, w: xr * S, h: yr * S, sgn: 1 },
      { title: `SIDE  ·  ${model.mebot ? "from chair's right" : 'from −y'}  ·  x →, z ↑`, u: 0, v: 2, x0: L, y0: T0 + yr * S + G, w: xr * S, h: zr * S, sgn: -1 },
      { title: `FRONT  ·  ${model.mebot ? 'facing chair' : 'from +x'}  ·  y →, z ↑`, u: 1, v: 2, x0: L + xr * S + G, y0: T0 + yr * S + G, w: yr * S, h: zr * S, sgn: 1 }
    ]
    return { S, lo, hi, W, H, panels, drawn }
  }, [d, arm, showArm, floorTop, model])

  function drawPanel(pn, k) {
    const { S, lo, hi } = sheet
    const sh = frame.shift
    const P = p => [pn.x0 + (p[pn.u] - lo[pn.u]) * S, pn.y0 + (hi[pn.v] - p[pn.v]) * S]
    const proj = points => points.map(p => P(p))
    const poly = points => hull(proj(points)).map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')
    const depthAx = 3 - pn.u - pn.v
    const grid = [], labels = []
    ;[pn.u, pn.v].forEach((ax, which) => {
      const a = lo[ax] + sh[ax], b = hi[ax] + sh[ax]
      for (let t = Math.ceil(a * 10) / 10; t <= b + 1e-9; t += 0.1) {
        const tt = Math.round(t * 10) / 10, m = tt - sh[ax]
        const major = Math.abs(tt) < 1e-9
        const at = [0, 0, 0]
        at[ax] = m
        const p = P(at)
        const stroke = major ? 'var(--cm-ink-2)' : 'var(--cm-grid)', sw = major ? 1 : 0.8
        const even = Math.round(tt * 10) % 2 === 0
        if (which === 0) {
          grid.push(<line key={`u${tt}`} x1={p[0]} x2={p[0]} y1={pn.y0} y2={pn.y0 + pn.h} stroke={stroke} strokeWidth={sw} />)
          if (even) labels.push(<text key={`u${tt}`} x={p[0]} y={pn.y0 + pn.h + 13} textAnchor="middle">{tt.toFixed(1)}</text>)
        } else {
          grid.push(<line key={`v${tt}`} y1={p[1]} y2={p[1]} x1={pn.x0} x2={pn.x0 + pn.w} stroke={stroke} strokeWidth={sw} />)
          if (even) labels.push(<text key={`v${tt}`} x={pn.x0 - 5} y={p[1] + 4} textAnchor="end">{tt.toFixed(1)}</text>)
        }
      }
    })
    const floorY = pn.v === 2 && floorTop !== undefined && shown('floor') ? P([0, 0, floorTop])[1] : null
    const boxes = sheet.drawn.filter(b => shown(b.layer)).sort((a, b) => pn.sgn * (a.c[depthAx] - b.c[depthAx]))
    const spheres = showArm ? arm.spheres.slice().sort((a, b) => pn.sgn * (a.p[depthAx] - b.p[depthAx])) : []
    const o = P([0, 0, 0])
    let dims = null
    if (sel && shown(sel.layer)) {
      const pts = proj(boxCorners(sel))
      const x1 = Math.min(...pts.map(p => p[0])), x2 = Math.max(...pts.map(p => p[0]))
      const y1 = Math.min(...pts.map(p => p[1])), y2 = Math.max(...pts.map(p => p[1]))
      const dy = y1 - 10, dx = x2 + 10
      dims = (
        <>
          <path d={`M${x1},${dy}H${x2}M${x1},${dy - 4}v8M${x2},${dy - 4}v8M${dx},${y1}V${y2}M${dx - 4},${y1}h8M${dx - 4},${y2}h8`} stroke="var(--cm-accent)" strokeWidth={1.2} fill="none" />
          <text x={(x1 + x2) / 2} y={dy - 5} textAnchor="middle" className={s.dimtxt}>{Math.round(((x2 - x1) / S) * 1000)}</text>
          <text x={dx + 5} y={(y1 + y2) / 2 + 4} className={s.dimtxt}>{Math.round(((y2 - y1) / S) * 1000)}</text>
        </>
      )
    }
    const t = P(arm.tool)
    return (
      <g key={k}>
        <rect x={pn.x0} y={pn.y0} width={pn.w} height={pn.h} fill="var(--cm-sheet)" stroke="var(--cm-rule)" />
        <text x={pn.x0} y={pn.y0 - 9} className={s.ptitle}>{pn.title}</text>
        {labels}
        <text x={pn.x0 + pn.w - 2} y={pn.y0 + pn.h + 26} textAnchor="end" className={s.dimtxt}>{'xyz'[pn.u]} (m)</text>
        <text x={pn.x0 - 8} y={pn.y0 - 9} textAnchor="end" className={s.dimtxt}>{'xyz'[pn.v]}</text>
        <g clipPath={`url(#cm-clip-${k})`}>
          {grid}
          {floorY !== null && (
            <>
              <rect x={pn.x0} y={floorY} width={pn.w} height={Math.max(0, pn.y0 + pn.h - floorY)} fill="var(--cm-floor)" opacity={0.18} />
              <line x1={pn.x0} x2={pn.x0 + pn.w} y1={floorY} y2={floorY} stroke="var(--cm-floor)" strokeWidth={1.5} />
            </>
          )}
          {boxes.map(b => {
            const isSel = sel?.id === b.id
            return (
              <g key={b.id}>
                {showPad && b.pad > 0 && (
                  <polygon points={poly(boxCorners(b, b.pad))} fill="none" stroke={layerColor(b.layer)} strokeDasharray="3 3" strokeWidth={0.8} opacity={0.75} />
                )}
                <polygon points={poly(boxCorners(b))} fill={layerColor(b.layer)} fillOpacity={b.layer === 'person' ? 0.12 : 0.16}
                  stroke={isSel ? 'var(--cm-accent)' : layerColor(b.layer)} strokeWidth={isSel ? 2.2 : 1} className={s.box2d}
                  onClick={e => { e.stopPropagation(); setSelId(b.id) }}>
                  <title>{b.id}</title>
                </polygon>
              </g>
            )
          })}
          {spheres.map((sp, i) => {
            const c = P(sp.p), col = `var(--cm-${sphereColor(sp)})`
            return <circle key={i} cx={c[0]} cy={c[1]} r={(sp.r + (showPad ? model.sphere_buffer : 0)) * S} fill={col} fillOpacity={0.22} stroke={col} strokeWidth={0.9} />
          })}
          {showArm && <path d={`M${t[0] - 5},${t[1]}h10M${t[0]},${t[1] - 5}v10`} stroke="var(--cm-ink)" strokeWidth={1.4} />}
          <circle cx={o[0]} cy={o[1]} r={3.2} fill="var(--cm-sheet)" stroke="var(--cm-ink)" strokeWidth={1.2} />
        </g>
        {dims}
        <text ref={el => { readouts.current[k] = el }} x={pn.x0 + pn.w - 6} y={pn.y0 + 15} textAnchor="end" className={s.readout} />
      </g>
    )
  }

  function hover(ev) {
    const svg = ev.currentTarget
    const pt = svg.createSVGPoint()
    pt.x = ev.clientX
    pt.y = ev.clientY
    const p = pt.matrixTransform(svg.getScreenCTM().inverse())
    sheet.panels.forEach((pn, k) => {
      const ro = readouts.current[k]
      if (!ro) return
      const inside = p.x >= pn.x0 && p.x <= pn.x0 + pn.w && p.y >= pn.y0 && p.y <= pn.y0 + pn.h
      const u = sheet.lo[pn.u] + (p.x - pn.x0) / sheet.S + frame.shift[pn.u]
      const v = sheet.hi[pn.v] - (p.y - pn.y0) / sheet.S + frame.shift[pn.v]
      ro.textContent = inside ? `${'xyz'[pn.u]} ${u.toFixed(3)}  ${'xyz'[pn.v]} ${v.toFixed(3)} m` : ''
    })
  }

  function describe(b) {
    const { lo, hi } = aabb(boxCorners(b).map(p => toF(p)))
    const turned = b.rpy_deg.some(v => v !== 0) ? `  ·  rpy ${b.rpy_deg.join(', ')}°` : ''
    return `${b.id}  x ${fmt(lo[0])}…${fmt(hi[0])}  y ${fmt(lo[1])}…${fmt(hi[1])}  z ${fmt(lo[2])}…${fmt(hi[2])} m  ·  ${mm(b.d[0])} × ${mm(b.d[1])} × ${mm(b.d[2])} mm${turned}`
  }

  const rotated = d.boxes.some(b => b.rpy_deg.some(v => v !== 0))
  const layerNames = model.layers.map(l => l.name)
  const tp = toF(arm.tool)
  const src = model.source
  const treeUrl = `https://github.com/${src.repo}/tree/${src.sha}/${model.dir}`

  return (
    <div className={s.root}>
      <span ref={probe} className={s.probe} />

      <section className={cx(s.panel, s.controls)} aria-label="Robot">
        <div className={s.ctl}>
          <span className={s.label}>Robot</span>
          <div className={s.chips}>
            {models.map(m => (
              <label key={m.id} className={s.chip}>
                <input type="radio" name="cm-robot" checked={m.id === robotId} onChange={() => chooseRobot(m.id)} />
                {m.robot} <span className={s.hint}>{m.deployment}</span>
              </label>
            ))}
          </div>
        </div>
        <div className={s.ctl}>
          <span className={s.label}>Data from</span>
          <span>
            <code>{src.repo}</code> {src.ref} at <a href={treeUrl}><code>{src.sha.slice(0, 7)}</code></a> ({src.date}),{' '}
            <code>{model.dir}/</code>
          </span>
        </div>
        {model.warnings.map(w => <p key={w} className={cx(s.wide, s.warning)}>⚠ {w}</p>)}
      </section>

      <section className={cx(s.panel, s.controls)} aria-label="View controls">
        {Object.keys(d.frames).length > 1 && (
          <div className={s.ctl}>
            <span className={s.label}>Coordinates shown in</span>
            <select value={frameKey} aria-label="Coordinates shown in"
              onChange={e => { setFrameKey(e.target.value); store('frame', e.target.value) }}>
              {Object.entries(d.frames).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
            </select>
          </div>
        )}
        <div className={s.ctl}>
          <span className={s.label}>Layers</span>
          <div className={s.chips}>
            {layerNames.map(l => (
              <label key={l} className={s.chip}>
                <input type="checkbox" checked={shown(l)} onChange={e => setHidden({ ...hidden, [l]: !e.target.checked })} />
                <span className={s.sw} style={{ background: layerColor(l) }} />
                {l} <span className={s.hint}>{model.boxes.filter(b => b.layer === l).length}</span>
              </label>
            ))}
          </div>
        </div>
        <div className={s.ctl}>
          <span className={s.label}>Draw</span>
          <div className={s.chips}>
            <label className={s.chip}>
              <input type="checkbox" checked={showPad} onChange={e => setShowPad(e.target.checked)} />
              planner padding (+{mm(model.world_padding)} mm box, +{mm(model.sphere_buffer)} mm sphere)
            </label>
            <label className={s.chip}>
              <input type="checkbox" checked={showArm} onChange={e => setShowArm(e.target.checked)} /> arm spheres
            </label>
          </div>
        </div>
        <div className={cx(s.ctl, s.wide)}>
          <span className={s.label}>Arm pose</span>
          <div className={s.chips}>
            {[...d.poses, { key: 'custom', label: 'Custom' }].map(p => (
              <label key={p.key} className={s.chip}>
                <input type="radio" name="cm-pose" checked={pose === p.key} onChange={() => setPoseTo(p.key)} />
                {p.label}
              </label>
            ))}
          </div>
          <div className={s.joints}>
            {model.joint_names.map((n, i) => {
              const lim = model.joints[n].limit
              const [lo, hi] = lim?.lower !== undefined ? [lim.lower, lim.upper] : [-2 * Math.PI, 2 * Math.PI]
              const deg = (q[i] * DEGR).toFixed(1)
              return (
                <div key={n} className={s.joint}>
                  <label htmlFor={`cm-j${i}`} className={s.mono}>{n.replace('arm_', '')} °</label>
                  <input type="number" id={`cm-j${i}`} step="0.5" key={`${robotId}${deg}`} defaultValue={deg}
                    onBlur={e => setJoint(i, parseFloat(e.target.value))}
                    onKeyDown={e => { if (e.key === 'Enter') setJoint(i, parseFloat(e.currentTarget.value)) }} />
                  <input type="range" min={Math.ceil(lo * DEGR * 2) / 2} max={Math.floor(hi * DEGR * 2) / 2} step="0.5" value={deg}
                    aria-label={`${n} degrees`} onChange={e => setJoint(i, parseFloat(e.target.value))} />
                </div>
              )
            })}
          </div>
          <div className={s.qline}>
            <span className={s.hint}>Joint angles in radians, as on <code>/joint_states</code>:</span>
            <input type="text" ref={qText} aria-label="Joint angles in radians" spellCheck={false}
              key={q.join()} defaultValue={`[${q.map(v => v.toFixed(3)).join(', ')}]`}
              onKeyDown={e => { if (e.key === 'Enter') applyText() }} />
            <button type="button" onClick={applyText}>Set pose</button>
          </div>
        </div>
      </section>

      <div className={cx(s.top, !d.dims && s.topSolo)}>
        <section className={cx(s.panel, s.view3d)} aria-label="3D view">
          <canvas ref={canvas} className={s.canvas} />
          {noGl && <p className={cx(s.noGl, s.hint)}>The 3D view needs WebGL, which this browser does not offer.</p>}
          <div className={s.overlay}>
            <div className={s.legend}>
              {layerNames.filter(l => l !== 'floor').map(l => (
                <span key={l}><i className={s.sw} style={{ background: layerColor(l) }} />{l}</span>
              ))}
              <span><i className={cx(s.sw, s.dot)} style={{ background: 'var(--cm-arm)' }} />arm sphere</span>
              <span><i className={cx(s.sw, s.dot)} style={{ background: 'var(--cm-warn)' }} />&lt; {mm(act)} mm</span>
              <span><i className={cx(s.sw, s.dot)} style={{ background: 'var(--cm-hit)' }} />inside a box</span>
              <span className={s.hint}>axes: arm_mount (x red, y green, z blue)</span>
            </div>
            <div><button type="button" onClick={resetView}>Reset view</button></div>
          </div>
          <div className={cx(s.pick, s.mono)}>
            {sel ? describe(sel) : 'Drag to orbit, right-drag to pan, scroll to zoom. Click a box to select it.'}
          </div>
        </section>
        {d.dims && (
          <section className={cx(s.panel, s.dims)} aria-label="Key dimensions">
            <div>
              <h2>Key dimensions</h2>
              <p className={s.hint} style={{ margin: '4px 0 0' }}>
                Model values in mm, as you would measure them on the chair. Type a measurement to see the difference; it stays in this browser only.
              </p>
            </div>
            <table>
              <tbody>
                {d.dims.map(([group, rows]) => [
                  <tr key={group} className={s.group}><td colSpan={4} className={s.label}>{group}</td></tr>,
                  ...rows.map(r => {
                    const dl = delta(r)
                    return (
                      <tr key={r.key}>
                        <th scope="row" title={r.note}>
                          {r.label}
                          {r.note && <div className={s.hint} style={{ fontWeight: 400 }}>{r.note}</div>}
                        </th>
                        <td className={s.v}>{r.deg ? `${r.model.toFixed(0)}°` : r.model.toFixed(1)}</td>
                        <td>
                          <input type="number" step="0.5" aria-label={`Measured ${r.label}`} placeholder="meas."
                            value={meas[r.key] ?? ''} onChange={e => measure(r.key, e.target.value)} />
                        </td>
                        <td className={cx(s.delta, dl?.cls)}>{dl?.text}</td>
                      </tr>
                    )
                  })
                ])}
              </tbody>
            </table>
            <div className={s.buttons}>
              <button type="button" onClick={copyDims}>{copied ?? 'Copy as text'}</button>
              <button type="button" onClick={() => { setMeas({}); store(`${robotId}.meas`, undefined) }}>Clear measurements</button>
            </div>
          </section>
        )}
      </div>

      <section className={s.panel} aria-label="Orthographic drawing">
        <div className={s.heading}>
          <h2>Orthographic views</h2>
          <span className={s.hint}>Grid 100 mm in the chosen frame. Hover a view to read coordinates; the selected box is dimensioned.</span>
        </div>
        <div className={s.sheetwrap}>
          <svg className={s.sheet} viewBox={`0 0 ${sheet.W.toFixed(0)} ${sheet.H.toFixed(0)}`} role="img"
            aria-label="Top, side and front views of the collision boxes and arm spheres"
            onMouseMove={hover} onMouseLeave={() => readouts.current.forEach(r => { if (r) r.textContent = '' })}
            onClick={() => setSelId(null)}>
            <defs>
              {sheet.panels.map((pn, k) => (
                <clipPath key={k} id={`cm-clip-${k}`}><rect x={pn.x0} y={pn.y0} width={pn.w} height={pn.h} /></clipPath>
              ))}
            </defs>
            {sheet.panels.map(drawPanel)}
            <path d={`M${sheet.panels[0].x0},${sheet.H - 12}h${0.5 * sheet.S}M${sheet.panels[0].x0},${sheet.H - 16}v8M${sheet.panels[0].x0 + 0.5 * sheet.S},${sheet.H - 16}v8`} stroke="var(--cm-ink-2)" strokeWidth={1} />
            <text x={sheet.panels[0].x0 + 0.25 * sheet.S} y={sheet.H - 18} textAnchor="middle">500 mm</text>
            <text x={sheet.panels[0].x0 + 0.5 * sheet.S + 12} y={sheet.H - 8}>
              ○ arm_mount origin   + tool frame ({model.ee_link})   dashed: planner padding
            </text>
          </svg>
        </div>
      </section>

      <div className={s.cols2}>
        <section className={s.panel} aria-label="Arm clearance">
          <h2>Arm clearance at this pose</h2>
          <p className={s.hint} style={{ margin: '4px 0 8px' }}>
            The closest sphere–box pairs among the layers shown, measured as the planner does (box padded {mm(model.world_padding)} mm
            {d.unpadded.length > 0 && <>, except {d.unpadded.join(', ')}</>}; sphere buffered {mm(model.sphere_buffer)} mm).
            Inside = the planner refuses this state. Under {mm(act)} mm = inside the collision activation distance, where the planner adds collision cost.
          </p>
          <div className={s.tablewrap}>
            {showArm ? (
              <table className={s.sched}>
                <thead><tr><th>Box</th><th>Nearest arm link</th><th className={s.n}>Distance</th><th /></tr></thead>
                <tbody>
                  {arm.nearest.map(r => {
                    const [cls, word] = r.d < 0 ? [s.hit, 'inside'] : r.d < act ? [s.costed, 'costed'] : [s.clear, 'clear']
                    return (
                      <tr key={r.b.id} className={s.click} onClick={() => setSelId(r.b.id)}>
                        <td><span className={s.sw} style={{ background: layerColor(r.b.layer) }} /> {r.b.id}</td>
                        <td className={s.mono}>{r.s.link.replace('arm_', '')}</td>
                        <td className={s.n}>{(r.d * 1000).toFixed(1)} mm</td>
                        <td><span className={cx(s.pill, cls)}>{word}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : <p className={s.hint}>Arm spheres are hidden.</p>}
          </div>
          {showArm && (
            <p className={s.mono} style={{ margin: '10px 0 0', fontSize: 12.5 }}>
              Tool frame ({model.ee_link}) at x {fmt(tp[0])}, y {fmt(tp[1])}, z {fmt(tp[2])} m in the shown frame.
            </p>
          )}
        </section>
        <section className={s.panel} aria-label="Layers">
          <h2>What the planner composes</h2>
          <p className={s.hint} style={{ margin: '4px 0 8px' }}>
            In this order, from <code>{model.dir}/</code>. The planner config&apos;s layers are in every world, <code>set_world</code> pushes included; the world file&apos;s are replaced by the first push.
          </p>
          <div className={s.tablewrap}>
            <table className={cx(s.sched, s.wrapCells)}>
              <thead><tr><th>Layer</th><th>Listed in</th><th>File</th><th className={s.n}>Boxes</th><th>Excludable</th></tr></thead>
              <tbody>
                {model.layers.map(l => (
                  <tr key={l.name}>
                    <td><span className={s.sw} style={{ background: layerColor(l.name) }} /> {l.name}</td>
                    <td>{l.name === 'scene' ? 'world (own boxes)' : l.source === 'planner' ? 'planner config' : 'world'}</td>
                    <td className={s.mono}><a href={`https://github.com/${src.repo}/blob/${src.sha}/${model.dir}/${l.file}`}>{l.file}</a></td>
                    <td className={s.n}>{model.boxes.filter(b => b.layer === l.name).length}</td>
                    <td>{l.excludable ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className={s.panel} aria-label="Box schedule">
        <div className={s.heading}>
          <h2>Box schedule</h2>
          <span className={s.hint}>Extents in metres ({frame.short}), unpadded, as in the files. Sizes in mm.</span>
        </div>
        <div className={s.tablewrap} style={{ marginTop: 8 }}>
          <table className={s.sched}>
            <thead>
              <tr>
                <th>Layer</th><th>Box</th>
                {['x min', 'x max', 'y min', 'y max', 'z min', 'z max'].map(h => <th key={h} className={s.n}>{h}</th>)}
                <th className={s.n}>size x × y × z</th>
                {rotated && <th className={s.n}>rpy (°)</th>}
              </tr>
            </thead>
            <tbody>
              {d.boxes.map(b => {
                const { lo, hi } = aabb(boxCorners(b).map(p => toF(p)))
                return (
                  <tr key={b.id} className={cx(s.click, sel?.id === b.id && s.sel)} onClick={() => setSelId(b.id)}>
                    <td><span className={s.sw} style={{ background: layerColor(b.layer) }} /> {b.layer}</td>
                    <td className={s.mono}>{b.name}</td>
                    {[lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]].map((v, i) => <td key={i} className={s.n}>{fmt(v)}</td>)}
                    <td className={s.n}>{mm(b.d[0])} × {mm(b.d[1])} × {mm(b.d[2])}</td>
                    {rotated && <td className={s.n}>{b.rpy_deg.join(', ')}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
