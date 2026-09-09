# Phase 5 — Deep-Future Extrapolation

**Goal:** Run the clock out to a galactic year and watch the disk shear, instead of
watching every star fly off on a straight line.

**Why it is a phase and not a slider change:** Phase 4 moves points on `p0 + v*t`.
That is honest for about a million years. Past that the straight lines are visibly
wrong — stars leave the Galaxy — because real orbits curve in the galactic
potential. This phase replaces the straight line with a curved orbit.

## Execution protocol

`builder` subagents, one per task. Tests are the oracle. No `git`. **Report within
25 minutes.** Use port 5173 only; never start another dev server. **Never run
`npx playwright test`** except in Task 3; the orchestrator runs it at the end.

## Global constraints

- **No regressions.** 253 vitest, 134 pytest, and the Playwright suite pass now.
- **No pipeline change, no re-bake.** Positions are already Galactic Cartesian
  (x toward the Galactic Centre, y toward l = 90 degrees, z toward the north
  galactic pole) with a heliocentric origin, and velocities are already km/s in
  that same basis. Everything below is a shader and UI change.
- **Phase 4 behaviour is unchanged inside its range.** Deep time is an explicit
  mode, not a silent switch partway along the existing slider, so the Phase 4
  e2e tests — including "the modeled population does not move" — stay valid as
  written.
- **Commits** carry a `Phase: 5` trailer; no attribution trailers.

## Measured ground truth

These came from an RK4 integration in a flat-rotation-curve potential, run
against the closed forms below. Numbers are for a disk star 150 pc from the Sun
with a 17 km/s peculiar velocity. **Do not re-derive them by assertion; the
tests below re-measure them.**

| model | t | error vs exact integration |
|---|---|---|
| linear `p0 + v*t` | 1 Myr | 1.4% of the distance travelled |
| linear `p0 + v*t` | 10 Myr | 13.9% |
| epicyclic | 100 Myr | 2.6% of R |
| epicyclic | 250 Myr | 5.4% of R |
| epicyclic | 500 Myr | 11.0% |
| epicyclic | 1 Gyr | 39% |

So `DEEP_MAX_YEARS = 250e6`, a little past one galactic year. A billion-year
range is not defensible with this model and must not be offered.

## Constants, and why these ones

Chosen as a self-consistent set rather than the most-cited value for each
quantity independently:

- `R0 = 8122 pc` — GRAVITY Collaboration.
- `V_SUN_TOTAL = 246.84 km/s` — fixed by the Sgr A* proper motion,
  `4.74047 * 6.411 mas/yr * 8.122 kpc`. It is not a free parameter.
- `V_CIRC = 234.60 km/s` — the above minus Schoenrich's 12.24 km/s solar
  peculiar V. Taking Eilers' 229 km/s here instead would leave the Sun on a
  14%-eccentric orbit, which it is not.
- `SOLAR_MOTION = (11.1, 246.84, 7.25) km/s` in the galactic basis.
- `Z_SUN = 20.8 pc` — Bennett and Bovy.
- Vertical frequency from the Oort limit, `nu = sqrt(4 pi G rho0)` with
  `rho0 = 0.1 Msun/pc^3`, giving an 83.6 Myr vertical period (73.5 km/s/kpc,
  against an observed 70-75).

One warning: the flat-curve `kappa = sqrt(2) * Omega` gives 40.85 km/s/kpc where
the locally measured value is about 36. Using the measured rotation-curve slope
`dv_c/dR = -1.7 km/s/kpc` (Eilers) brings it to 39.6. The residual is real and
belongs in the disclosure, not in a fudge factor.

---

## Task 1: The orbit model, on the CPU, with an independent oracle

**Files:** create `app/src/render/galacticOrbit.ts`, `app/src/render/galacticOrbit.test.ts`

**Produces:**
- the constants above, each named and sourced
- `toGalactocentric(heliocentricPc)` and its velocity counterpart, which adds
  `SOLAR_MOTION`
- `circularSpeed(radiusPc)` — `V_CIRC + slope * (R - R0)`, floored so the inner
  Galaxy does not go negative
- `orbitPosition(p0, v0, tYears)` — the closed-form epicyclic orbit
- `integrateOrbit(p0, v0, tYears, steps)` — an RK4 reference, **test-only**, the
  oracle for everything above

**The sign trap that will cost you an hour if you skip this paragraph.** In this
frame the Sun sits at galactocentric `(-R0, 0, 0)` and moves toward `+y`. The
`+phi` direction there is `(0, -1)`, so the Sun's angular momentum `Lz` is
**negative**. An `Rg = Lz / v_c` written without the sign gives a negative
guiding radius and an orbit wrong by more than the distance travelled — it does
not look like a small error, it looks like the star teleports. Take
`Rg = |Lz| / v_c` and carry the rotation sense in the angular speed.

The epicyclic solution, for reference:

```
X(t)   = A cos(kappa t + a0),  where A, a0 come from (R - Rg) and vR
R(t)   = Rg + X(t)
phi(t) = phi0 + Omega_g t - (2 Omega_g A)/(kappa Rg) * [sin(kappa t + a0) - sin(a0)]
z(t)   = z0 cos(nu t) + (vz0/nu) sin(nu t)
```

**Tests, in order of what they actually prove:**
1. `orbitPosition` agrees with `integrateOrbit` to better than 6% of R at
   250 Myr and better than 3% at 100 Myr. This is the only test that can catch a
   wrong closed form, so write it first and confirm it fails against a
   deliberately broken one.
2. A star put on an exactly circular orbit stays at constant R for a full
   galactic year — to floating-point noise, not to a loose tolerance.
3. The Sun returns near its start after 212.7 Myr.
4. At small t the orbit reduces to `p0 + v*t`: agreement better than 0.2% at
   0.1 Myr. This is what makes the mode boundary continuous.
5. Angular momentum and energy are conserved by `integrateOrbit` itself, so a
   bug in the oracle cannot silently validate a bug in the model.

Assert against the *numbers in the table above*, not against whatever the code
happens to produce.

## Open lead: the azimuth truncation (do NOT act on this in Task 2)

Task 1 established that the 250 Myr error is dominated by `phi_dot =
Omega_g (1 - 2X/Rg)` being a first-order truncation of `Lz/r^2`, and
proposed `Omega_eff = Omega_g (1 + 1.5 (A/Rg)^2)` as the standard
second-order fix. Measured against RK4, that makes it **worse**: 4.86% ->
11.78% at 250 Myr. It was proposed but correctly not applied.

Scanning the coefficient instead:

| coefficient | 100 Myr | 250 Myr |
|---|---|---|
| 0 (shipped) | 2.45% | 4.86% |
| +1.5 (the textbook second-order term) | 5.12% | 11.78% |
| **-0.75** | **1.29%** | **1.49%** |

`-3/4` is a 3.3x improvement and suspiciously clean, but it is the
opposite sign to the derivation that motivates it, which means the
derivation is wrong somewhere and the number is currently just a fit.
**Shipping it would be a fudge factor, which this design does not
allow.** The shipped model stays first-order at a disclosed 5.4%.

Worth someone deriving properly: whether `Rg` from `Lz = Rg v_c(Rg)` is
the right expansion centre, and whether the amplitude `A` should be the
true radial excursion rather than the epicyclic one. If it derives, the
deep range could extend well past one galactic year.

---

## Task 2: The orbit in the vertex shader

**Files:** modify `app/src/render/pointMaterial.ts`, `app/src/render/picking.ts`,
`app/src/layers/layerRenderer.ts`

The same closed form in GLSL, behind `uDeepTime` (0 = Phase 4 linear, 1 = orbit).
`uParsecsPerUnit` already exists on the material, so `R0` converts into the
layer's own unit without new plumbing; `uVelocityScale` already converts km/s.
Add `uSolarMotion` as a `vec3` in km/s.

**The picking shader must get the identical treatment.** It is a separate shader
that already had to be fixed once this phase for exactly this reason — mirror the
change and the uniforms, do not reimplement.

**The modeled population.** The 4,000,000 generated Milky Way points carry no
velocity, so under an orbit model they would sit rigid while the real stars shear
past them — the Galaxy would visibly come apart. Give them the circular velocity
implied by their own radius: it is derivable in the shader from position alone,
costs no memory and no re-bake, and is the kinematics the density model they came
from actually implies. Detect them by `FLAG_MODELED`, exactly as the dimming does.

This changes what is true about them, so it changes the disclosure — see Task 3.
Inside the Phase 4 range they must still not move at all.

**Far layers.** Over 250 Myr the Hubble flow stretches extragalactic distances by
about 1.8% (`H0 t` with a 13.97 Gyr Hubble time). It is small but it is real and
it is cheap: scale the Mly layers radially by `1 + t/T_HUBBLE`. Galaxy `Vpec` is
line-of-sight only, which stays true and stays disclosed.

**Verification:** read back a handful of transformed points from the GPU and
compare them against `orbitPosition` from Task 1 for the same inputs. A shader
that merely *looks* like it curves is not evidence. Report the agreement.

---

## Task 3: The mode, its disclosure, and the tests

**Files:** modify `app/src/ui/timeControls.ts`, `app/src/ui/timeControls.test.ts`,
`app/src/main.ts`, `e2e/render.spec.ts`

A "deep time" toggle. Off is exactly today's behaviour, `+/-1,000,000` years,
linear. On extends the slider to `+/-250,000,000` and switches the model. The
readout switches to millions of years past a threshold, so nobody has to read
`+248,000,000 years` off a slider.

`deepTimeDisclosure()` must say what the orbit model does not know:
- the potential is axisymmetric and static — no bar, no spiral arms, no
  scattering off molecular clouds, and no mergers
- `kappa` from a flat curve is about 10% higher than the locally measured value
- the modeled population now moves on **assumed circular orbits**, not measured
  motion — that is a different claim from Phase 4's "it does not move", and the
  wording must not carry over
- stars with no measured radial velocity start from a partly invented velocity,
  and an orbit amplifies that error rather than diluting it
- error against an exact integration is a few percent of R at this range, quoted
  as a number

**e2e:** the toggle extends the range; at 200 Myr the field is visibly sheared
rather than uniformly displaced (sample several points and show the displacement
is not a rigid translation — that is the difference an orbit model makes, and a
luminance check cannot see it); the deep disclosure appears only in deep mode;
and the Phase 4 tests still pass unchanged with the toggle off.

Then run the full suite, look at it in the browser, and report.
