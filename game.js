(() => {
  "use strict";

  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d");
  const soundButton = document.querySelector("#soundToggle");
  const W = canvas.width;
  const H = canvas.height;
  const WORLD_W = 2440;
  const FLOOR = 438;
  const keys = new Set();
  const justPressed = new Set();

  let state = "title";
  let mode = 2;
  let cameraX = 0;
  let frame = 0;
  let shake = 0;
  let wave = 0;
  let waveTimer = 0;
  let bannerTimer = 0;
  let score = 0;
  let soundOn = true;
  let audioContext = null;
  let players = [];
  let enemies = [];
  let particles = [];
  let pickups = [];
  let decorations = [];

  const palette = {
    sky: "#21192f",
    sunset: "#d86b50",
    dark: "#17101f",
    stone: "#5b5266",
    gold: "#f0b44b",
    p1: "#d64f53",
    p2: "#4f9dd1",
    bone: "#f2dfb0",
    enemy: "#74456f",
  };

  const controlMap = [
    { left: "KeyA", right: "KeyD", up: "KeyW", down: "KeyS", attack: "KeyF", dash: "KeyG" },
    { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown", attack: "KeyK", dash: "KeyL" },
  ];

  const weaponDefs = {
    blade: { name: "铁刃", color: "#dce4e7", reach: 38, damage: 16, cooldown: 22, durability: 22 },
    spear: { name: "日矛", color: "#f0b44b", reach: 64, damage: 13, cooldown: 26, durability: 18 },
    hammer: { name: "岩锤", color: "#9e8c86", reach: 44, damage: 24, cooldown: 34, durability: 14 },
  };

  function seededNoise(n) {
    return ((Math.sin(n * 9283.17) * 43758.5453) % 1 + 1) % 1;
  }

  function tone(freq, duration = 0.08, type = "square", gain = 0.045, slide = 0) {
    if (!soundOn) return;
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, audioContext.currentTime);
    oscillator.frequency.linearRampToValueAtTime(freq + slide, audioContext.currentTime + duration);
    volume.gain.setValueAtTime(gain, audioContext.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
    oscillator.connect(volume).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  }

  class Fighter {
    constructor(x, index) {
      this.x = x;
      this.y = FLOOR - 55;
      this.vx = 0;
      this.vy = 0;
      this.w = 27;
      this.h = 55;
      this.index = index;
      this.facing = index === 0 ? 1 : -1;
      this.hp = 100;
      this.maxHp = 100;
      this.lives = 3;
      this.attackTimer = 0;
      this.attackCooldown = 0;
      this.dashTimer = 0;
      this.dashCooldown = 0;
      this.invulnerable = 0;
      this.hitFlash = 0;
      this.onGround = true;
      this.weapon = "blade";
      this.durability = weaponDefs.blade.durability;
      this.combo = 0;
      this.comboTimer = 0;
      this.dead = false;
      this.respawnTimer = 0;
    }

    update() {
      if (this.dead) {
        this.respawnTimer--;
        if (this.respawnTimer <= 0 && this.lives > 0) this.respawn();
        return;
      }

      const c = controlMap[this.index];
      const moving = (keys.has(c.right) ? 1 : 0) - (keys.has(c.left) ? 1 : 0);
      const speed = this.dashTimer > 0 ? 10.5 : 3.2;

      if (this.dashTimer <= 0) {
        this.vx += moving * 0.65;
        this.vx *= this.onGround ? 0.72 : 0.92;
        this.vx = Math.max(-speed, Math.min(speed, this.vx));
        if (moving) this.facing = moving;
      } else {
        this.vx = this.facing * speed;
        this.dashTimer--;
      }

      if (justPressed.has(c.up) && this.onGround) {
        this.vy = -11.2;
        this.onGround = false;
        tone(180, 0.06, "square", 0.025, 80);
      }

      if (justPressed.has(c.dash) && this.dashCooldown <= 0) {
        this.dashTimer = 11;
        this.dashCooldown = 55;
        this.invulnerable = 15;
        burst(this.x, this.y + 38, "#d8cba9", 7, 2.5);
        tone(95, 0.08, "sawtooth", 0.035, 100);
      }

      if (justPressed.has(c.attack) && this.attackCooldown <= 0) this.attack();

      this.vy += 0.62;
      this.x += this.vx;
      this.y += this.vy;
      this.x = Math.max(24, Math.min(WORLD_W - 24, this.x));
      if (this.y + this.h >= FLOOR) {
        this.y = FLOOR - this.h;
        this.vy = 0;
        this.onGround = true;
      }

      if (this.attackTimer > 0) this.attackTimer--;
      if (this.attackCooldown > 0) this.attackCooldown--;
      if (this.dashCooldown > 0) this.dashCooldown--;
      if (this.invulnerable > 0) this.invulnerable--;
      if (this.hitFlash > 0) this.hitFlash--;
      if (this.comboTimer > 0) this.comboTimer--; else this.combo = 0;
      this.collectPickups();
    }

    attack() {
      const weapon = weaponDefs[this.weapon];
      this.attackTimer = 11;
      this.attackCooldown = weapon.cooldown;
      this.vx += this.facing * 1.7;
      let hit = false;
      enemies.forEach((enemy) => {
        if (enemy.dead || enemy.invulnerable > 0) return;
        const dx = enemy.x - this.x;
        const dy = Math.abs((enemy.y + enemy.h / 2) - (this.y + this.h / 2));
        if (Math.sign(dx || this.facing) === this.facing && Math.abs(dx) < weapon.reach + enemy.w / 2 && dy < 42) {
          const comboBonus = Math.min(this.combo, 4) * 1.2;
          enemy.hurt(weapon.damage + comboBonus, this.facing, this.weapon === "hammer" ? 8 : 5);
          hit = true;
          this.combo++;
          this.comboTimer = 95;
          score += 10 * this.combo;
        }
      });
      tone(hit ? 145 : 220, 0.07, hit ? "sawtooth" : "square", hit ? 0.05 : 0.025, hit ? -50 : 60);
      if (hit) {
        this.durability--;
        shake = Math.max(shake, this.weapon === "hammer" ? 8 : 4);
        if (this.durability <= 0) {
          burst(this.x + this.facing * 25, this.y + 22, weapon.color, 10, 4);
          this.weapon = "blade";
          this.durability = weaponDefs.blade.durability;
        }
      }
    }

    hurt(damage, direction) {
      if (this.invulnerable > 0 || this.dead) return;
      this.hp -= damage;
      this.vx = direction * 6;
      this.vy = -4;
      this.invulnerable = 48;
      this.hitFlash = 8;
      shake = 7;
      burst(this.x, this.y + 20, "#df5b59", 9, 4);
      tone(80, 0.14, "sawtooth", 0.055, -35);
      if (this.hp <= 0) {
        this.lives--;
        this.dead = true;
        this.respawnTimer = this.lives > 0 ? 150 : 999999;
        burst(this.x, this.y + 20, this.index ? palette.p2 : palette.p1, 18, 6);
      }
    }

    respawn() {
      const living = players.find((p) => !p.dead);
      this.x = living ? living.x + (this.index ? 48 : -48) : 120;
      this.y = FLOOR - 120;
      this.hp = 100;
      this.dead = false;
      this.invulnerable = 120;
      this.vy = -2;
    }

    collectPickups() {
      pickups.forEach((item) => {
        if (item.taken || Math.abs(item.x - this.x) > 30 || Math.abs(item.y - (this.y + 35)) > 45) return;
        item.taken = true;
        if (item.type === "heart") this.hp = Math.min(this.maxHp, this.hp + 32);
        else {
          this.weapon = item.type;
          this.durability = weaponDefs[item.type].durability;
        }
        burst(item.x, item.y, item.type === "heart" ? "#e75b61" : weaponDefs[item.type].color, 12, 4);
        tone(item.type === "heart" ? 520 : 360, 0.12, "square", 0.04, 180);
      });
    }

    draw() {
      if (this.dead || (this.invulnerable > 0 && Math.floor(this.invulnerable / 4) % 2)) return;
      const x = Math.round(this.x - cameraX);
      const y = Math.round(this.y);
      const color = this.hitFlash ? "#fff" : (this.index ? palette.p2 : palette.p1);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(this.facing, 1);

      // Shadow, cape, body and helmet are deliberately chunky pixel forms.
      ctx.fillStyle = "#08070b66";
      ctx.fillRect(-17, 52, 36, 6);
      ctx.fillStyle = this.index ? "#254f75" : "#7a2630";
      ctx.fillRect(-14, 19, 10, 30);
      ctx.fillStyle = color;
      ctx.fillRect(-10, 19, 22, 27);
      ctx.fillStyle = "#d8a361";
      ctx.fillRect(-8, 10, 17, 13);
      ctx.fillStyle = "#d7d7d2";
      ctx.fillRect(-12, 3, 23, 9);
      ctx.fillRect(-9, -2, 15, 6);
      ctx.fillStyle = "#312638";
      ctx.fillRect(1, 10, 12, 4);
      ctx.fillStyle = "#f2e7c5";
      ctx.fillRect(8, 11, 3, 2);
      ctx.fillStyle = "#2b2431";
      const step = Math.sin(frame * 0.28 + this.index) * Math.min(5, Math.abs(this.vx));
      ctx.fillRect(-9, 44, 7, 11 + step);
      ctx.fillRect(6, 44, 7, 11 - step);

      const weapon = weaponDefs[this.weapon];
      ctx.rotate(this.attackTimer > 0 ? -0.9 + (11 - this.attackTimer) * 0.16 : 0.35);
      ctx.fillStyle = "#765039";
      ctx.fillRect(8, 24, 22, 4);
      ctx.fillStyle = weapon.color;
      if (this.weapon === "spear") {
        ctx.fillRect(27, 24, 43, 3);
        ctx.beginPath(); ctx.moveTo(70, 20); ctx.lineTo(82, 25); ctx.lineTo(70, 30); ctx.fill();
      } else if (this.weapon === "hammer") {
        ctx.fillRect(27, 16, 18, 20);
      } else {
        ctx.fillRect(27, 22, 34, 7);
        ctx.beginPath(); ctx.moveTo(61, 22); ctx.lineTo(69, 25); ctx.lineTo(61, 29); ctx.fill();
      }
      ctx.restore();
    }
  }

  class Enemy {
    constructor(x, type = "raider") {
      this.x = x;
      this.y = FLOOR - (type === "warden" ? 90 : 50);
      this.vx = 0;
      this.vy = 0;
      this.type = type;
      this.w = type === "warden" ? 58 : type === "brute" ? 38 : 28;
      this.h = type === "warden" ? 90 : type === "brute" ? 66 : 50;
      this.maxHp = type === "warden" ? 360 : type === "brute" ? 82 : 48;
      this.hp = this.maxHp;
      this.attackCooldown = 45 + Math.random() * 40;
      this.attackTimer = 0;
      this.invulnerable = 0;
      this.facing = -1;
      this.dead = false;
      this.hitFlash = 0;
      this.phase = 0;
    }

    update() {
      if (this.dead) return;
      const targets = players.filter((p) => !p.dead);
      if (!targets.length) return;
      const target = targets.reduce((best, p) => Math.abs(p.x - this.x) < Math.abs(best.x - this.x) ? p : best);
      const dx = target.x - this.x;
      this.facing = Math.sign(dx) || this.facing;
      const range = this.type === "warden" ? 72 : this.type === "brute" ? 48 : 38;

      if (Math.abs(dx) > range && this.attackTimer <= 0) {
        const pace = this.type === "warden" ? 1.4 : this.type === "brute" ? 1.25 : 1.85;
        this.vx += this.facing * 0.16;
        this.vx = Math.max(-pace, Math.min(pace, this.vx));
      } else {
        this.vx *= 0.72;
        if (this.attackCooldown <= 0) {
          this.attackTimer = this.type === "warden" ? 34 : 22;
          this.attackCooldown = this.type === "warden" ? 58 : 72 + Math.random() * 28;
        }
      }

      if (this.attackTimer > 0) {
        this.attackTimer--;
        const strikeFrame = this.type === "warden" ? 15 : 9;
        if (this.attackTimer === strikeFrame && Math.abs(dx) < range + 22) {
          target.hurt(this.type === "warden" ? 22 : this.type === "brute" ? 16 : 11, this.facing);
          if (this.type === "warden") {
            shake = 12;
            burst(this.x + this.facing * 50, FLOOR - 8, "#e3a34b", 18, 7);
          }
        }
      }

      this.vy += 0.6;
      this.x += this.vx;
      this.y += this.vy;
      if (this.y + this.h > FLOOR) { this.y = FLOOR - this.h; this.vy = 0; }
      if (this.attackCooldown > 0) this.attackCooldown--;
      if (this.invulnerable > 0) this.invulnerable--;
      if (this.hitFlash > 0) this.hitFlash--;

      if (this.type === "warden" && this.hp < this.maxHp / 2 && this.phase === 0) {
        this.phase = 1;
        this.attackCooldown = 0;
        this.vx = this.facing * 8;
        burst(this.x, this.y + 35, palette.gold, 30, 8);
        tone(65, 0.5, "sawtooth", 0.06, 120);
      }
    }

    hurt(damage, direction, force) {
      if (this.invulnerable > 0 || this.dead) return;
      this.hp -= damage;
      this.vx = direction * (this.type === "warden" ? force * 0.25 : force);
      this.vy = this.type === "warden" ? -1 : -3.5;
      this.invulnerable = 12;
      this.hitFlash = 6;
      burst(this.x, this.y + this.h * 0.4, this.type === "warden" ? palette.gold : "#c76f8b", 8, 4);
      if (this.hp <= 0) this.die();
    }

    die() {
      this.dead = true;
      score += this.type === "warden" ? 1500 : this.type === "brute" ? 260 : 120;
      burst(this.x, this.y + this.h / 2, this.type === "warden" ? palette.gold : palette.enemy, this.type === "warden" ? 48 : 18, 8);
      if (Math.random() < 0.38 || this.type === "warden") {
        const pool = this.type === "warden" ? ["heart", "heart"] : ["spear", "hammer", "heart"];
        pickups.push({ x: this.x, y: FLOOR - 22, type: pool[Math.floor(Math.random() * pool.length)], taken: false, bob: Math.random() * 6 });
      }
      tone(this.type === "warden" ? 55 : 105, this.type === "warden" ? 0.5 : 0.18, "sawtooth", 0.055, -50);
    }

    draw() {
      if (this.dead) return;
      const x = Math.round(this.x - cameraX);
      const y = Math.round(this.y);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(this.facing, 1);
      const flash = this.hitFlash > 0;

      ctx.fillStyle = "#08070b66";
      ctx.fillRect(-this.w / 2, this.h - 4, this.w, 7);
      if (this.type === "warden") {
        ctx.fillStyle = flash ? "#fff" : "#4b314e";
        ctx.fillRect(-27, 26, 54, 56);
        ctx.fillStyle = "#25202b";
        ctx.fillRect(-22, 82, 16, 8);
        ctx.fillRect(8, 82, 16, 8);
        ctx.fillStyle = flash ? "#fff" : "#bc7c42";
        ctx.fillRect(-24, 10, 49, 20);
        ctx.fillRect(-15, 2, 31, 10);
        ctx.fillStyle = "#fbca5b";
        ctx.fillRect(12, 17, 6, 4);
        ctx.fillStyle = "#2a172e";
        ctx.fillRect(-35, 34, 12, 40);
        const swing = this.attackTimer > 0 ? -1.1 + this.attackTimer * 0.04 : 0.4;
        ctx.rotate(swing);
        ctx.fillStyle = "#775036";
        ctx.fillRect(20, 35, 55, 7);
        ctx.fillStyle = "#b7a8a0";
        ctx.fillRect(65, 23, 26, 31);
      } else {
        const brute = this.type === "brute";
        ctx.fillStyle = flash ? "#fff" : brute ? "#674a65" : palette.enemy;
        ctx.fillRect(brute ? -17 : -12, brute ? 17 : 20, brute ? 34 : 25, brute ? 39 : 27);
        ctx.fillStyle = "#9c6d57";
        ctx.fillRect(brute ? -14 : -9, 8, brute ? 28 : 19, 14);
        ctx.fillStyle = "#3a283e";
        ctx.fillRect(-16, 3, brute ? 31 : 25, 8);
        ctx.fillStyle = "#e78b55";
        ctx.fillRect(6, 12, 4, 3);
        ctx.fillStyle = "#2b2030";
        ctx.fillRect(-13, this.h - 9, 9, 9);
        ctx.fillRect(5, this.h - 9, 9, 9);
        ctx.fillStyle = "#aeb8b5";
        const reach = this.attackTimer > 0 ? 42 : 25;
        ctx.fillRect(12, 27, reach, brute ? 8 : 5);
      }
      ctx.restore();

      if (this.hp < this.maxHp && this.type !== "warden") {
        const width = this.w + 8;
        ctx.fillStyle = "#170d18";
        ctx.fillRect(x - width / 2, y - 9, width, 4);
        ctx.fillStyle = "#d85c67";
        ctx.fillRect(x - width / 2, y - 9, width * Math.max(0, this.hp / this.maxHp), 4);
      }
    }
  }

  function burst(x, y, color, count, power) {
    for (let i = 0; i < count; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * power * 2,
        vy: (Math.random() - 0.75) * power,
        life: 18 + Math.random() * 24,
        maxLife: 42,
        color,
        size: 2 + Math.random() * 5,
      });
    }
  }

  function initDecorations() {
    decorations = [];
    for (let x = 60; x < WORLD_W; x += 110 + Math.random() * 120) {
      decorations.push({ x, type: Math.random() > 0.55 ? "pillar" : "grass", variant: Math.floor(Math.random() * 3) });
    }
  }

  function newGame() {
    players = [new Fighter(130, 0)];
    if (mode === 2) players.push(new Fighter(190, 1));
    enemies = [];
    particles = [];
    pickups = [];
    cameraX = 0;
    wave = 0;
    score = 0;
    waveTimer = 90;
    bannerTimer = 150;
    state = "playing";
    initDecorations();
    spawnWave();
    tone(220, 0.12, "square", 0.04, 180);
  }

  function spawnWave() {
    wave++;
    bannerTimer = 110;
    const center = Math.min(360 + wave * 480, WORLD_W - 260);
    const specs = {
      1: [["raider", 250], ["raider", 350], ["raider", 460]],
      2: [["raider", 0], ["brute", 130], ["raider", 260], ["raider", 360]],
      3: [["brute", 20], ["raider", 130], ["brute", 270], ["raider", 390], ["raider", 480]],
      4: [["warden", 220]],
    }[wave] || [];
    specs.forEach(([type, offset]) => enemies.push(new Enemy(center + offset, type)));
    players.forEach((p) => { if (!p.dead) p.x = Math.max(p.x, center - 330); });
  }

  function update() {
    frame++;
    if (state === "title") {
      if (justPressed.has("ArrowLeft") || justPressed.has("KeyA") || justPressed.has("ArrowRight") || justPressed.has("KeyD")) {
        mode = mode === 1 ? 2 : 1;
        tone(300, 0.05, "square", 0.025, 80);
      }
      if (justPressed.has("Enter") || justPressed.has("Space")) newGame();
      justPressed.clear();
      return;
    }

    if ((state === "gameover" || state === "victory") && (justPressed.has("Enter") || justPressed.has("Space"))) {
      state = "title";
      justPressed.clear();
      return;
    }

    if (justPressed.has("Enter") && (state === "playing" || state === "paused")) {
      state = state === "playing" ? "paused" : "playing";
      tone(260, 0.05, "square", 0.03, 40);
    }
    if (state !== "playing") { justPressed.clear(); return; }

    players.forEach((player) => player.update());
    enemies.forEach((enemy) => enemy.update());
    pickups.forEach((item) => { item.bob += 0.06; });
    pickups = pickups.filter((item) => !item.taken);

    particles.forEach((particle) => {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.23;
      particle.vx *= 0.97;
      particle.life--;
    });
    particles = particles.filter((particle) => particle.life > 0);

    const living = players.filter((p) => !p.dead);
    if (!living.length && players.every((p) => p.lives <= 0)) {
      state = "gameover";
      tone(110, 0.6, "sawtooth", 0.055, -80);
    }

    if (enemies.length && enemies.every((enemy) => enemy.dead)) {
      if (wave === 4) {
        waveTimer--;
        if (waveTimer <= 0) { state = "victory"; tone(330, 0.5, "square", 0.05, 330); }
      } else {
        waveTimer--;
        if (waveTimer <= 0) { waveTimer = 120; spawnWave(); }
      }
    }

    const focus = living.length ? living.reduce((sum, p) => sum + p.x, 0) / living.length : 0;
    const targetCamera = Math.max(0, Math.min(WORLD_W - W, focus - W * 0.42));
    cameraX += (targetCamera - cameraX) * 0.055;
    if (shake > 0) shake *= 0.84;
    if (bannerTimer > 0) bannerTimer--;
    justPressed.clear();
  }

  function rect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function text(value, x, y, size = 16, color = "#fff", align = "left") {
    ctx.save();
    ctx.font = `900 ${size}px "Courier New", monospace`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#09070d";
    ctx.fillText(value, x + 3, y + 3);
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
    ctx.restore();
  }

  function drawBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, "#171425");
    gradient.addColorStop(0.62, palette.sky);
    gradient.addColorStop(1, "#6d3f4c");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    rect(0, 118, W, 4, "#bb5d55");
    rect(0, 122, W, 3, "#6d3544");
    const sunX = 760 - cameraX * 0.04;
    rect(sunX, 80, 86, 86, "#e68b58");
    rect(sunX + 8, 88, 70, 70, "#efb965");

    for (let layer = 0; layer < 3; layer++) {
      const parallax = 0.08 + layer * 0.1;
      const base = 240 + layer * 48;
      ctx.fillStyle = ["#30243d", "#3d2b43", "#4b3447"][layer];
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = -80; x <= W + 100; x += 90) {
        const world = x + cameraX * parallax;
        const peak = base - seededNoise(Math.floor(world / 90) + layer * 10) * (80 - layer * 15);
        ctx.lineTo(x, peak);
        ctx.lineTo(x + 90, base + 18);
      }
      ctx.lineTo(W, H);
      ctx.fill();
    }

    // Distant fortress silhouettes.
    const fortOffset = -cameraX * 0.32;
    for (let x = fortOffset - 200; x < W + 300; x += 390) {
      rect(x, 282, 200, 95, "#2c2333");
      rect(x + 20, 245, 40, 132, "#2c2333");
      rect(x + 140, 228, 46, 149, "#2c2333");
      for (let i = 0; i < 4; i++) rect(x + 8 + i * 54, 270, 22, 18, "#2c2333");
      rect(x + 153, 252, 7, 14, "#dc7a50");
    }

    rect(0, FLOOR, W, H - FLOOR, "#3b303c");
    rect(0, FLOOR, W, 8, "#8a7266");
    rect(0, FLOOR + 8, W, 8, "#55424c");
    for (let x = -(cameraX % 64); x < W; x += 64) {
      rect(x, FLOOR + 16, 2, 62, "#2b222e");
      rect(x + 8, FLOOR + 34 + (Math.floor((x + cameraX) / 64) % 2) * 20, 32, 3, "#2b222e");
    }

    decorations.forEach((d) => {
      const x = d.x - cameraX;
      if (x < -80 || x > W + 80) return;
      if (d.type === "pillar") {
        rect(x, FLOOR - 73 - d.variant * 12, 28, 73 + d.variant * 12, "#6c6070");
        rect(x - 6, FLOOR - 78 - d.variant * 12, 40, 8, "#897982");
        rect(x - 4, FLOOR - 8, 36, 8, "#514653");
        rect(x + 9, FLOOR - 74 - d.variant * 12, 5, 65, "#4b414e");
      } else {
        ctx.fillStyle = "#6d704d";
        ctx.fillRect(x, FLOOR - 12, 3, 12);
        ctx.fillRect(x + 7, FLOOR - 18, 3, 18);
        ctx.fillRect(x + 14, FLOOR - 9, 3, 9);
      }
    });
  }

  function drawPickups() {
    pickups.forEach((item) => {
      const x = item.x - cameraX;
      const y = item.y + Math.sin(item.bob) * 5;
      rect(x - 13, y + 12, 28, 4, "#0d0a10aa");
      if (item.type === "heart") {
        rect(x - 9, y - 5, 18, 14, "#db4b58");
        rect(x - 6, y + 7, 12, 5, "#db4b58");
        rect(x - 9, y - 8, 7, 6, "#ef7580");
        rect(x + 2, y - 8, 7, 6, "#ef7580");
      } else {
        const color = weaponDefs[item.type].color;
        rect(x - 17, y - 2, 34, 5, color);
        rect(x - 20, y - 5, 6, 11, "#72513c");
        if (item.type === "hammer") rect(x + 8, y - 10, 16, 21, color);
        if (item.type === "spear") {
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.moveTo(x + 17, y - 7); ctx.lineTo(x + 27, y); ctx.lineTo(x + 17, y + 7); ctx.fill();
        }
      }
    });
  }

  function drawHud() {
    players.forEach((player, i) => {
      const side = i === 0 ? 1 : -1;
      const baseX = i === 0 ? 24 : W - 24;
      const align = i === 0 ? "left" : "right";
      text(`P${i + 1}`, baseX, 27, 18, i ? palette.p2 : palette.p1, align);
      const barX = i === 0 ? baseX : baseX - 220;
      rect(barX, 43, 220, 13, "#140d18");
      rect(barX + 3, 46, 214 * Math.max(0, player.hp / player.maxHp), 7, i ? palette.p2 : palette.p1);
      const weapon = weaponDefs[player.weapon];
      text(`${weapon.name} ${"◆".repeat(Math.max(1, Math.ceil(player.durability / 5)))}`, baseX, 72, 11, "#e9d7ad", align);
      text(`命 × ${player.lives}`, baseX + side * 145, 27, 11, "#c7b6c7", align);
      if (player.combo > 1 && player.comboTimer > 0) text(`${player.combo} 连击`, baseX, 94, 13, palette.gold, align);
    });

    text(String(score).padStart(6, "0"), W / 2, 28, 15, palette.gold, "center");
    text(`第 ${Math.min(wave, 4)} / 4 战`, W / 2, 48, 10, "#a794ae", "center");

    const boss = enemies.find((enemy) => enemy.type === "warden" && !enemy.dead);
    if (boss) {
      text("裂岩守卫 · VAAR", W / 2, 478, 13, "#e5c27c", "center");
      rect(W / 2 - 250, 494, 500, 13, "#140d18");
      rect(W / 2 - 247, 497, 494 * Math.max(0, boss.hp / boss.maxHp), 7, palette.gold);
    }
  }

  function drawParticles() {
    particles.forEach((particle) => {
      ctx.globalAlpha = Math.min(1, particle.life / 10);
      rect(particle.x - cameraX, particle.y, particle.size, particle.size, particle.color);
    });
    ctx.globalAlpha = 1;
  }

  function overlay(alpha = 0.72) {
    ctx.fillStyle = `rgba(9, 6, 13, ${alpha})`;
    ctx.fillRect(0, 0, W, H);
  }

  function drawTitle() {
    drawBackground();
    overlay(0.58);
    text("◆  刃 誓 双 雄  ◆", W / 2, 114, 19, "#f1bd59", "center");
    text("BLADEBOUND", W / 2, 176, 52, "#fff0cf", "center");
    text("DUO", W / 2, 224, 61, palette.gold, "center");
    text("原创同屏合作横版动作游戏", W / 2, 268, 13, "#b7a2bb", "center");

    const choices = [{ label: "单人远征", value: 1 }, { label: "双人同盟", value: 2 }];
    choices.forEach((choice, index) => {
      const x = W / 2 + (index ? 118 : -118);
      if (mode === choice.value) {
        rect(x - 92, 312, 184, 48, "#9b523c");
        rect(x - 88, 316, 176, 40, "#3d273d");
      } else rect(x - 90, 314, 180, 44, "#1c1523cc");
      text(choice.label, x, 336, 16, mode === choice.value ? "#ffe0a0" : "#75677d", "center");
    });

    if (Math.floor(frame / 34) % 2 === 0) text("← → 选择   ·   ENTER 开始", W / 2, 405, 14, "#f2e2bd", "center");
    text("击溃四道防线，夺回被裂岩军团封锁的火种", W / 2, 450, 11, "#89758d", "center");
  }

  function drawGame() {
    const sx = shake > 0.5 ? (Math.random() - 0.5) * shake : 0;
    const sy = shake > 0.5 ? (Math.random() - 0.5) * shake * 0.5 : 0;
    ctx.save();
    ctx.translate(sx, sy);
    drawBackground();
    drawPickups();
    enemies.forEach((enemy) => enemy.draw());
    players.forEach((player) => player.draw());
    drawParticles();
    ctx.restore();
    drawHud();

    if (bannerTimer > 0) {
      const alpha = Math.min(1, bannerTimer / 25, (110 - bannerTimer) / 18);
      ctx.globalAlpha = Math.max(0, alpha);
      rect(W / 2 - 170, 132, 340, 58, "#110b18dd");
      text(wave === 4 ? "最终战 · 裂岩守卫" : `第 ${wave} 战`, W / 2, 161, 23, wave === 4 ? palette.gold : "#fff0cf", "center");
      ctx.globalAlpha = 1;
    }

    if (state === "paused") {
      overlay(0.66);
      text("战斗暂停", W / 2, 244, 34, palette.gold, "center");
      text("按 ENTER 继续", W / 2, 290, 13, "#d9c8d8", "center");
    } else if (state === "gameover") {
      overlay(0.74);
      text("火种熄灭", W / 2, 220, 44, palette.p1, "center");
      text(`最终得分 ${score}`, W / 2, 277, 16, "#dfcfac", "center");
      text("按 ENTER 返回营地", W / 2, 330, 14, "#fff", "center");
    } else if (state === "victory") {
      overlay(0.6);
      text("◆ 火种重燃 ◆", W / 2, 205, 41, palette.gold, "center");
      text("裂岩军团败退，刃誓之路仍将延续", W / 2, 263, 14, "#fff0cf", "center");
      text(`远征得分 ${score}`, W / 2, 305, 18, "#d9c5a0", "center");
      text("按 ENTER 再战", W / 2, 365, 14, "#fff", "center");
    }
  }

  function loop() {
    update();
    ctx.imageSmoothingEnabled = false;
    if (state === "title") drawTitle(); else drawGame();
    requestAnimationFrame(loop);
  }

  window.addEventListener("keydown", (event) => {
    const blocked = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"];
    if (blocked.includes(event.code)) event.preventDefault();
    if (!keys.has(event.code)) justPressed.add(event.code);
    keys.add(event.code);
  });
  window.addEventListener("keyup", (event) => keys.delete(event.code));
  window.addEventListener("blur", () => { keys.clear(); if (state === "playing") state = "paused"; });
  canvas.addEventListener("pointerdown", () => { canvas.focus(); if (state === "title") newGame(); });
  soundButton.addEventListener("click", () => {
    soundOn = !soundOn;
    soundButton.textContent = `声音：${soundOn ? "开" : "关"}`;
    soundButton.setAttribute("aria-pressed", String(!soundOn));
    if (soundOn) tone(330, 0.08, "square", 0.03, 80);
  });

  initDecorations();
  loop();
})();
