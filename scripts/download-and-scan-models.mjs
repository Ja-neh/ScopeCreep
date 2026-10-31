import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const OUT_DIR = path.resolve('public/assets/level02');
fs.mkdirSync(OUT_DIR, { recursive: true });

const MODELS = [
  {
    id: 'pine-tree',
    file: 'pine-tree.glb',
    url: 'https://grab3d.com/dl/pine-tree/pine-tree.glb',
    replaces: 'https://sketchfab.com/3d-models/pine-forest-ece69535f7584e099488f65f2072264e',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'spruce-tree',
    file: 'spruce-tree.glb',
    url: 'https://grab3d.com/dl/spruce-tree/spruce-tree.glb',
    replaces: 'https://sketchfab.com/3d-models/pine-forest-ece69535f7584e099488f65f2072264e',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'grass-clump',
    file: 'grass-clump.glb',
    url: 'https://grab3d.com/dl/grass-clump/grass-clump.glb',
    replaces: 'https://sketchfab.com/3d-models/pine-forest-ece69535f7584e099488f65f2072264e',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'fern',
    file: 'fern.glb',
    url: 'https://grab3d.com/dl/fern/fern.glb',
    replaces: 'https://sketchfab.com/3d-models/pine-forest-ece69535f7584e099488f65f2072264e',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'basalt-lava-rock',
    file: 'basalt-lava-rock.glb',
    url: 'https://grab3d.com/dl/lava-rock/lava-rock.glb',
    replaces: 'https://sketchfab.com/3d-models/basalt-rocks-on-beach-39a49ad24271485a90872c3e631d30d4',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'basalt-sea-stack',
    file: 'basalt-sea-stack.glb',
    url: 'https://grab3d.com/dl/sea-stack/sea-stack.glb',
    replaces: 'https://sketchfab.com/3d-models/basalt-rocks-on-beach-39a49ad24271485a90872c3e631d30d4',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'boulder-rock-set',
    file: 'boulder-rock-set.glb',
    url: 'https://grab3d.com/dl/boulder-rock-set/boulder-rock-set.glb',
    replaces: 'https://sketchfab.com/3d-models/basalt-rocks-on-beach-39a49ad24271485a90872c3e631d30d4',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'ocean-wave-tile',
    file: 'ocean-wave-tile.glb',
    url: 'https://grab3d.com/dl/ocean-wave-tile/ocean-wave-tile.glb',
    replaces: 'https://sketchfab.com/3d-models/infinite-ocean-water-maya-file-360-for-maya-user-0661f50861564989b1da4e94bdbeace7',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'small-wreck-boat',
    file: 'small-wreck-boat.glb',
    url: 'https://grab3d.com/dl/rowboat/rowboat.glb',
    replaces: 'https://sketchfab.com/3d-models/small-wreck-boat-072d9c2e811049528c74a6bf0fe4176c',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'malpas-metal-boat-wreck',
    file: 'malpas-metal-boat-wreck.glb',
    url: 'https://grab3d.com/dl/fishing-boat/fishing-boat.glb',
    replaces: 'https://sketchfab.com/3d-models/malpas-metal-boat-wreck-7a2c49c1be2c48a3a4d80a3f27dae205',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'raf-helicopter',
    file: 'raf-helicopter.glb',
    url: 'https://grab3d.com/dl/helicopter/helicopter.glb',
    replaces: 'https://sketchfab.com/3d-models/raf-helicopter-104c9b6104ab4cf9bd87c0706920710f',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'f-86-sabre-jet',
    file: 'f-86-sabre-jet.glb',
    url: 'https://grab3d.com/dl/space-fighter/space-fighter.glb',
    replaces: 'https://sketchfab.com/3d-models/f-86-sabre-86e6ad8886544064b0ba95be6ca371d3',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'alien-spaceship',
    file: 'alien-spaceship.glb',
    url: 'https://grab3d.com/dl/sci-fi-spaceship/sci-fi-spaceship.glb',
    replaces: 'Level 1 -> Level 2 Captured Alien Spaceship',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'tactical-rifle-blaster',
    file: 'tactical-rifle-blaster.glb',
    url: 'https://grab3d.com/dl/laser-blaster/laser-blaster.glb',
    replaces: 'Player & Squad Heavy Recoil Tactical Rifle / Blaster',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'green-plasma-bomb',
    file: 'green-plasma-bomb.glb',
    url: 'https://grab3d.com/dl/energy-cell/energy-cell.glb',
    replaces: 'Green Thrown Plasma Bomb / Grenade',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'great-wall-segment',
    file: 'great-wall-segment.glb',
    url: 'https://grab3d.com/dl/castle-wall/castle-wall.glb',
    replaces: 'Great Wall of China Village Perimeter Rampart Segment',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'great-wall-tower',
    file: 'great-wall-tower.glb',
    url: 'https://grab3d.com/dl/castle-tower/castle-tower.glb',
    replaces: 'Great Wall of China Village Perimeter Watchtower Bastion',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'great-wall-gatehouse',
    file: 'great-wall-gatehouse.glb',
    url: 'https://grab3d.com/dl/gatehouse/gatehouse.glb',
    replaces: 'Great Wall of China Village Main Gatehouse',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'armored-truck-wreck',
    file: 'armored-truck-wreck.glb',
    url: 'https://grab3d.com/dl/armored-truck/armored-truck.glb',
    replaces: 'Land Wreckage Cover - Destroyed Armored Truck',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'cargo-plane-wreck',
    file: 'cargo-plane-wreck.glb',
    url: 'https://grab3d.com/dl/cargo-plane/cargo-plane.glb',
    replaces: 'Land Wreckage Cover - Downed Transport Plane',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'escape-pod-wreck',
    file: 'escape-pod-wreck.glb',
    url: 'https://grab3d.com/dl/escape-pod/escape-pod.glb',
    replaces: 'Land Wreckage Cover - Crashed Orbital Escape Pod',
    license: 'CC0 1.0 Universal (Grab3D)'
  },
  {
    id: 'tactical-cover-crate',
    file: 'tactical-cover-crate.glb',
    url: 'https://grab3d.com/dl/sci-fi-crate/sci-fi-crate.glb',
    replaces: 'Land Wreckage Cover - Armored Supply Container',
    license: 'CC0 1.0 Universal (Grab3D)'
  }
];

const SAFE_EXTENSIONS = new Set([
  'KHR_materials_unlit',
  'KHR_materials_pbrSpecularGlossiness',
  'KHR_materials_clearcoat',
  'KHR_materials_ior',
  'KHR_materials_specular',
  'KHR_materials_transmission',
  'KHR_materials_emissive_strength',
  'KHR_texture_transform',
  'KHR_mesh_quantization',
  'EXT_meshopt_compression'
]);

const SUSPICIOUS_PATTERNS = [
  /<script\b/i,
  /javascript:/i,
  /vbscript:/i,
  /data:text\/html/i,
  /powershell/i,
  /cmd\.exe/i,
  /WScript\.Shell/i,
  /ActiveXObject/i,
  /\beval\s*\(/i,
  /\bFunction\s*\(/i
];

/**
 * Inspects a raw GLB binary buffer in memory before saving to disk.
 */
function scanGlbBuffer(buffer, label) {
  if (buffer.byteLength < 20) {
    throw new Error(`[SECURITY REJECT] ${label}: file too small (${buffer.byteLength} bytes)`);
  }

  // 1. Check for executable / archive headers at start of file
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
    throw new Error(`[SECURITY REJECT] ${label}: Windows PE/MZ executable header detected!`);
  }
  if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    throw new Error(`[SECURITY REJECT] ${label}: ELF binary header detected!`);
  }
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    throw new Error(`[SECURITY REJECT] ${label}: ZIP/JAR archive header detected instead of GLB!`);
  }

  // 2. Verify GLB 12-byte header
  const magic = buffer.readUInt32LE(0);
  const version = buffer.readUInt32LE(4);
  const totalLength = buffer.readUInt32LE(8);
  if (magic !== 0x46546c67) {
    throw new Error(`[SECURITY REJECT] ${label}: invalid GLB magic 0x${magic.toString(16)}`);
  }
  if (version !== 2) {
    throw new Error(`[SECURITY REJECT] ${label}: unsupported GLB version ${version}`);
  }
  if (totalLength !== buffer.byteLength) {
    throw new Error(`[SECURITY REJECT] ${label}: declared length ${totalLength} !== actual ${buffer.byteLength}`);
  }

  // 3. Parse chunks (Chunk 0 must be JSON 0x4E4F534A, optional Chunk 1 BIN 0x004E4942)
  let offset = 12;
  let jsonText = null;
  let binLength = 0;
  let chunkIndex = 0;
  while (offset < buffer.byteLength) {
    if (offset + 8 > buffer.byteLength) {
      throw new Error(`[SECURITY REJECT] ${label}: truncated chunk header at ${offset}`);
    }
    const chunkLen = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + chunkLen > buffer.byteLength) {
      throw new Error(`[SECURITY REJECT] ${label}: chunk overflows file boundary`);
    }
    if (chunkIndex === 0) {
      if (chunkType !== 0x4e4f534a) {
        throw new Error(`[SECURITY REJECT] ${label}: first chunk is not JSON`);
      }
      jsonText = buffer.subarray(offset, offset + chunkLen).toString('utf8');
    } else if (chunkIndex === 1 && chunkType === 0x004e4942) {
      binLength = chunkLen;
    } else {
      throw new Error(`[SECURITY REJECT] ${label}: unexpected chunk #${chunkIndex} type 0x${chunkType.toString(16)}`);
    }
    offset += chunkLen;
    chunkIndex++;
  }

  if (!jsonText) {
    throw new Error(`[SECURITY REJECT] ${label}: missing glTF JSON chunk`);
  }

  // 4. Scan JSON string for script injection or suspicious strings
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(jsonText)) {
      throw new Error(`[SECURITY REJECT] ${label}: suspicious pattern ${pattern} in JSON chunk!`);
    }
  }

  const gltf = JSON.parse(jsonText);

  // 5. Verify extensions are strictly safe rendering extensions
  for (const list of [gltf.extensionsUsed || [], gltf.extensionsRequired || []]) {
    for (const ext of list) {
      if (!SAFE_EXTENSIONS.has(ext)) {
        throw new Error(`[SECURITY REJECT] ${label}: disallowed glTF extension "${ext}"`);
      }
    }
  }

  // 6. Verify no external URIs in buffers or images (prevents SSRF / local file reads)
  for (const buf of gltf.buffers || []) {
    if (buf.uri !== undefined) {
      throw new Error(`[SECURITY REJECT] ${label}: external buffer URI "${buf.uri}" is not allowed`);
    }
  }
  for (const img of gltf.images || []) {
    if (img.uri !== undefined) {
      throw new Error(`[SECURITY REJECT] ${label}: external image URI "${img.uri}" is not allowed`);
    }
    if (img.mimeType && !['image/png', 'image/jpeg', 'image/webp'].includes(img.mimeType)) {
      throw new Error(`[SECURITY REJECT] ${label}: disallowed image mimeType "${img.mimeType}"`);
    }
  }

  // 7. Count meshes / primitives for audit metadata
  let meshCount = (gltf.meshes || []).length;
  let nodeCount = (gltf.nodes || []).length;
  let materialCount = (gltf.materials || []).length;
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    status: 'CLEAN_VERIFIED_GLB',
    sha256,
    bytes: buffer.byteLength,
    jsonBytes: jsonText.length,
    binBytes: binLength,
    meshCount,
    nodeCount,
    materialCount
  };
}

const report = [];

for (const item of MODELS) {
  process.stdout.write(`Downloading & scanning ${item.id} from ${item.url} ... `);
  const res = await fetch(item.url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${item.url}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Security scan in memory BEFORE writing to disk
  const scanResult = scanGlbBuffer(buffer, item.file);

  const outPath = path.join(OUT_DIR, item.file);
  fs.writeFileSync(outPath, buffer);
  console.log(`PASS (${(scanResult.bytes / 1024).toFixed(1)} KB, sha256: ${scanResult.sha256.slice(0, 16)}...)`);

  report.push({
    ...item,
    ...scanResult
  });
}

// Also scan existing public/assets/forest/coastal-pine.glb
const existingPine = path.resolve('public/assets/forest/coastal-pine.glb');
if (fs.existsSync(existingPine)) {
  const buf = fs.readFileSync(existingPine);
  const scanResult = scanGlbBuffer(buf, 'coastal-pine.glb');
  report.push({
    id: 'coastal-pine',
    file: 'public/assets/forest/coastal-pine.glb',
    url: 'https://grab3d.com/dl/pine-tree/pine-tree.glb',
    replaces: 'https://sketchfab.com/3d-models/pine-forest-ece69535f7584e099488f65f2072264e',
    license: 'CC0 1.0 Universal (Grab3D)',
    ...scanResult
  });
}

const reportPath = path.join(OUT_DIR, 'SECURITY_SCAN_REPORT.json');
fs.writeFileSync(reportPath, JSON.stringify({ scannedAt: new Date().toISOString(), models: report }, null, 2) + '\n');
console.log(`\nAll ${report.length} GLB models passed in-memory binary & JSON security inspection.`);
console.log(`Report written to ${reportPath}`);

