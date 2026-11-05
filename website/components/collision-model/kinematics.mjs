// Forward kinematics of the arm's URDF chain (the robot's arm_kinematics.json)
// on arm_mount, and the planner's sphere-to-box signed distance. Plain arrays,
// no library: the build script checks every model with it, and the page draws
// with it.

const DEG = Math.PI / 180

// Rz(y) * Ry(p) * Rx(r): the URDF convention, and the one RAMMP-CuRobo turns
// an obstacle's rpy_deg into a quaternion with.
export function rpyMatrix([r, p, y]) {
  const cr = Math.cos(r), sr = Math.sin(r), cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y)
  return [
    [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
    [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
    [-sp, cp * sr, cp * cr]
  ]
}

function axisAngle([x, y, z], q) {
  const c = Math.cos(q), s = Math.sin(q), t = 1 - c
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c]
  ]
}

function transform(xyz, R) {
  return [[...R[0], xyz[0]], [...R[1], xyz[1]], [...R[2], xyz[2]], [0, 0, 0, 1]]
}

function mul(A, B) {
  return A.map(row => [0, 1, 2, 3].map(j => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j] + row[3] * B[3][j]))
}

export function apply(T, p) {
  return [0, 1, 2].map(i => T[i][0] * p[0] + T[i][1] * p[1] + T[i][2] * p[2] + T[i][3])
}

// The value of every moving joint at q: the planned joints from q, the locked
// ones (the gripper's knuckle) from lock_joints, and mimics from their source.
function jointValues(model, q) {
  const values = { ...model.lock_joints }
  model.joint_names.forEach((name, i) => { values[name] = q[i] })
  const value = name => {
    const mimic = model.joints[name]?.mimic
    if (mimic) return value(mimic.joint) * (mimic.multiplier ?? 1) + (mimic.offset ?? 0)
    return values[name] ?? 0
  }
  return value
}

// {link: 4x4} in arm_mount. arm_mount -> arm_base_link is the mount's tilt
// (mount.yaml's rpy_deg); the joints below arm_base_link are the reference's.
export function forwardKinematics(model, q) {
  const value = jointValues(model, q)
  const T = {
    [model.base_link]: transform([0, 0, 0], rpyMatrix([0, 0, 0])),
    [model.arm_base_link]: transform([0, 0, 0], rpyMatrix(model.mount_rpy_deg.map(d => d * DEG)))
  }
  const pending = Object.entries(model.joints)
  let progressed = true
  while (pending.length && progressed) {
    progressed = false
    for (let i = pending.length - 1; i >= 0; i--) {
      const [name, j] = pending[i]
      if (!(j.parent in T)) continue
      let Tj = mul(T[j.parent], transform(j.xyz, rpyMatrix(j.rpy)))
      if (j.type !== 'fixed') Tj = mul(Tj, transform([0, 0, 0], axisAngle(j.axis, value(name))))
      T[j.child] = Tj
      pending.splice(i, 1)
      progressed = true
    }
  }
  return T
}

// The collision spheres in arm_mount: {link, p, r}, r without the buffer.
export function armSpheres(model, q) {
  const T = forwardKinematics(model, q)
  const spheres = []
  for (const [link, list] of Object.entries(model.spheres)) {
    for (const s of list) spheres.push({ link, p: apply(T[link], s.center), r: s.radius })
  }
  return { T, spheres }
}

// A box as the planner composes it: c, d (unpadded), pad per side, and R,
// its orientation in arm_mount.
export function boxFrame(box) {
  return { ...box, R: rpyMatrix(box.rpy_deg.map(d => d * DEG)) }
}

// p in the box's own frame: R^T (p - c).
function local(box, p) {
  const v = [p[0] - box.c[0], p[1] - box.c[1], p[2] - box.c[2]]
  return [0, 1, 2].map(i => box.R[0][i] * v[0] + box.R[1][i] * v[1] + box.R[2][i] * v[2])
}

// Signed distance from a sphere of radius r at p to the padded box: negative
// inside, the test cuRobo's feasibility check makes (RAMMP-CuRobo
// world.sphere_box_penetration).
export function signedDistance(p, r, box) {
  const l = local(box, p)
  let outside = 0, inside = -Infinity
  for (let i = 0; i < 3; i++) {
    const d = Math.abs(l[i]) - (box.d[i] / 2 + box.pad)
    if (d > 0) outside += d * d
    inside = Math.max(inside, d)
  }
  return Math.sqrt(outside) + Math.min(inside, 0) - r
}

// The 8 corners of the box grown by `grow` per side, in arm_mount.
export function boxCorners(box, grow = 0) {
  const h = box.d.map(v => v / 2 + grow)
  const out = []
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const v = [sx * h[0], sy * h[1], sz * h[2]]
    out.push([0, 1, 2].map(i => box.c[i] + box.R[i][0] * v[0] + box.R[i][1] * v[1] + box.R[i][2] * v[2]))
  }
  return out
}
