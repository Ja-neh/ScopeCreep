# Projectile System Developer Guide (Card 2.1 & Card 2.2 Integration)

> **Audience:** Combat / Ballistics Developer assigned to **Card 2.2** (*Wire up weapon firing inputs, rate of fire, recoil, turret mount controls*).  
> **Subsystem:** [ProjectilePool.js](file:///c:/School/3rd/Sem2/CGV/Project/ScopeCreep/src/entities/projectiles/ProjectilePool.js) & [Projectile.js](file:///c:/School/3rd/Sem2/CGV/Project/ScopeCreep/src/entities/projectiles/Projectile.js).  
> **Architecture Reference:** [ARCHITECTURE_AND_SYSTEMS.md](./ARCHITECTURE_AND_SYSTEMS.md) and [AGENTS.md](./AGENTS.md).

---

## 1. Overview & Architectural Role

The **Card 2.1 Projectile System** is a zero-allocation, high-performance ballistics engine designed to handle rapid flak fire (up to 12+ rounds per second) and heavy naval artillery shells with continuous collision detection (CCD) and zero Garbage Collection (GC) pauses.

As the developer implementing **Card 2.2** in [ArtilleryTurret.js](file:///c:/School/3rd/Sem2/CGV/Project/ScopeCreep/src/entities/ship-components/ArtilleryTurret.js) (aliased as `MainGun`) and [FlakTurret.js](file:///c:/School/3rd/Sem2/CGV/Project/ScopeCreep/src/entities/ship-components/FlakTurret.js), you do **not** need to create meshes, colliders, or physics raycasts when shooting. You only need to query muzzle positions and invoke the pre-allocated pool.

---

## 2. Accessing the Projectile Pool

In both `Level01` and `TestLevel`, `ProjectilePool` is registered as an active entity on `GameWorld` and published globally on:

```javascript
this.gameWorld.projectilePool
```

From within any turret or station subclassing `BaseStation`:

```javascript
const pool = this.gameWorld?.projectilePool;
if (!pool) return;
```

---

## 3. Public API Reference

The pool provides two specialized methods tailored for your turret weapons:

### 3.1 `fireFlak(options)` — Rapid-Fire Anti-Air & Bullets

Spawns a high-speed kinetic tracer round from the pre-allocated flak pool (defaults sourced directly from `src/config.json`).

```javascript
const projectile = this.gameWorld.projectilePool.fireFlak({
  origin,          // THREE.Vector3: World-space coordinates of muzzle tip
  direction,       // THREE.Vector3: Normalized world-space aiming vector
  spread: 0.012,   // Number (optional): Angular cone spread in radians (default: 0.012)
  speed: 460,      // Number (optional): Initial muzzle velocity in m/s (default: 460)
  source: this,    // Object (optional): Turret or ship entity to ignore self-collision
  excludeCollider  // Rapier.Collider (optional): Specific collider to bypass in raycast
});
```

- **Ballistics:** Velocity $460\text{ m/s}$, gravity $-10\text{ m/s}^2$, drag coefficient $0.002$.
- **Damage:** 35 points of `DamageType.KINETIC`.
- **Lifetime:** $2.4\text{ seconds}$ before automatic pool recycling.

---

### 3.2 `fireArtillery(options)` — Heavy Naval Cannon Shells

Spawns a heavy armor-piercing explosive shell with an authentic curved ballistic trajectory (30 shells pre-allocated).

```javascript
const projectile = this.gameWorld.projectilePool.fireArtillery({
  origin,          // THREE.Vector3: World-space coordinates of gun muzzle
  direction,       // THREE.Vector3: Normalized world-space aiming vector
  speed: 220,      // Number (optional): Initial muzzle velocity in m/s (default: 220)
  source: this,    // Object (optional): Firing entity
  excludeCollider  // Rapier.Collider (optional): Turret or deck collider
});
```

- **Ballistics:** Velocity $220\text{ m/s}$, gravity $-18\text{ m/s}^2$ (prominent ballistic drop curve over distance), drag coefficient $0.001$.
- **Damage:** 350 points of `DamageType.EXPLOSIVE`.
- **Lifetime:** $6.5\text{ seconds}$ before automatic pool recycling.

---

## 4. Step-by-Step Integration Guide for Card 2.2

### Step 1: Pre-allocate Math Scratchpads (Zero Heap Allocations)

> ⚠️ **CRITICAL RULE (AGENTS.md):** Never allocate temporary objects (`new THREE.Vector3()`) in frame updates or on fire events.

In your turret's `constructor()`:

```javascript
// Pre-allocated scratchpads for firing calculations
this._muzzleWorldPos = new THREE.Vector3();
this._barrelWorldDir = new THREE.Vector3();
```

---

### Step 2: Rate-of-Fire Timers

Manage firing cadences using delta timers in your turret update logic:

```javascript
// In constructor:
this.fireCooldown = 0;
this.fireRate = 0.1; // E.g., 10 RPS for Flak (~0.1s), or 1.8s for Artillery

// In gameplayUpdate(delta) or update(delta):
if (this.fireCooldown > 0) {
  this.fireCooldown -= delta;
}
```

---

### Step 3: Determining World-Space Muzzle Position and Aim Direction

When your turret is mounted and rotated, calculate the exact world position and orientation of the muzzle:

```javascript
// 1. Get the world position of the barrel root or muzzle marker
this.barrelMesh.getWorldPosition(this._muzzleWorldPos);

// 2. Get the forward orientation of the barrel in world space
this.barrelMesh.getWorldDirection(this._barrelWorldDir);

// Note on Three.js conventions:
// By default, getWorldDirection returns the +Z direction in world space.
// If your barrel points down -Z in local space, negate the direction:
this._barrelWorldDir.negate();

// 3. Offset to the tip of the barrel
const barrelLength = 3.5; // distance from barrel pivot to muzzle tip
this._muzzleWorldPos.addScaledVector(this._barrelWorldDir, barrelLength);
```

---

### Step 4: Fire Projectile on Input

Using semantic actions from `InputManager` (`isActionDown('fire')` or `isActionJustPressed('fire')`):

```javascript
const input = this.gameWorld.input;
const wantsFire = input.isActionDown('fire') || input.isKeyDown('KeyF');

if (wantsFire && this.fireCooldown <= 0 && this.isMounted) {
  this.fireCooldown = this.fireRate;

  // Fire from projectile pool
  this.gameWorld.projectilePool.fireFlak({
    origin: this._muzzleWorldPos,
    direction: this._barrelWorldDir,
    spread: 0.015,
    source: this
  });

  // Trigger your recoil kickback animation here
  this._triggerRecoil();
}
```

---

## 5. Visual Recoil Implementation Pattern

To achieve the acceptance criteria for visual recoil without breaking the physics or mounting hierarchy:

1. Keep a rest position for each barrel mesh:
   ```javascript
   this.barrelRestZ = this.barrelMesh.position.z;
   this.recoilOffset = 0;
   ```
2. When firing, push the barrel backward along its local axis:
   ```javascript
   this.recoilOffset = 0.45; // Kickback in meters (+Z or -Z depending on barrel axis)
   ```
3. In `gameplayUpdate(delta)`, smoothly interpolate back to 0:
   ```javascript
   if (this.recoilOffset > 0) {
     this.recoilOffset = Math.max(0, this.recoilOffset - delta * 2.5);
     this.barrelMesh.position.z = this.barrelRestZ + this.recoilOffset;
   }
   ```

---

## 6. How Collision Detection & Damage Work

You do **not** need to handle hit detection or damage logic in the turret.

1. **Continuous Collision Detection (CCD):**
   - Each active projectile casts a Rapier ray from its previous position $p_{t}$ to its current position $p_{t+\Delta t}$ every frame.
   - Prevents tunneling through ship decks or target colliders even at $460\text{ m/s}$.
2. **Damage Application:**
   - When a projectile strikes a Rapier collider, `ProjectilePool._onHit()` inspects the collider's `userData.entity` (or its parent object).
   - If the struck entity possesses a `HealthComponent`, `health.takeDamage(damageInfo)` is automatically invoked with the correct `DamageType` (`KINETIC` or `EXPLOSIVE`).
3. **Ocean Boundary:**
   - Any shell descending through $Y \le 0$ (water surface) triggers a water impact and despawns.

---

## 7. Lifecycle Checklist for Card 2.2

| Requirement | Lifecycle Phase | Hook / Location |
| :--- | :--- | :--- |
| Mouse look aiming & gun traverse | **Phase 5** (`gameplayUpdate`) | `turret.gameplayUpdate()` / `turret.update()` |
| Barrel elevation & recoil spring-back | **Phase 5** (`gameplayUpdate`) | `turret.gameplayUpdate()` / `turret.update()` |
| Projectile trajectory & CCD raycasts | **Phase 5** (`gameplayUpdate`) | Handled automatically by `ProjectilePool` |
| Camera aim alignment (Gun-sight / HUD) | **Phase 6** (`lateUpdate`) | `BaseStation` optical sight camera |

---

## 8. Summary Checklist for Card 2.2 Dev

- [ ] Query `this.gameWorld.projectilePool`.
- [ ] Use `fireFlak()` for [FlakTurret.js](file:///c:/School/3rd/Sem2/CGV/Project/ScopeCreep/src/entities/ship-components/FlakTurret.js) and `fireArtillery()` for [ArtilleryTurret.js](file:///c:/School/3rd/Sem2/CGV/Project/ScopeCreep/src/entities/ship-components/ArtilleryTurret.js).
- [ ] Pre-allocate `_muzzleWorldPos` and `_barrelWorldDir` (zero `new` in updates).
- [ ] Implement cooldown timers for rate of fire.
- [ ] Add smooth barrel kickback recoil animation.
- [ ] Run `npm run build` to verify clean bundle compilation.
