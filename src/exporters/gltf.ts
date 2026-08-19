import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { World } from '../types';

export async function exportWorldGLTF(world: World, outputPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const { width, height, data } = world.heightmap;
  const step = Math.max(1, Math.floor(width / 256)); // Subdivide grid for 3D mesh
  const cols = Math.floor(width / step);
  const rows = Math.floor(height / step);

  const numVertices = (cols + 1) * (rows + 1);
  const positions = new Float32Array(numVertices * 3);
  const uvs = new Float32Array(numVertices * 2);

  let vIdx = 0;
  let uvIdx = 0;
  const heightScale = 120.0;

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const px = Math.min(width - 1, c * step);
      const py = Math.min(height - 1, r * step);
      const elevation = data[py * width + px] || 0;

      positions[vIdx] = c * step - width / 2;
      positions[vIdx + 1] = elevation * heightScale;
      positions[vIdx + 2] = r * step - height / 2;
      vIdx += 3;

      uvs[uvIdx] = c / cols;
      uvs[uvIdx + 1] = r / rows;
      uvIdx += 2;
    }
  }

  const indices: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i0 = r * (cols + 1) + c;
      const i1 = i0 + 1;
      const i2 = (r + 1) * (cols + 1) + c;
      const i3 = i2 + 1;

      indices.push(i0, i2, i1);
      indices.push(i1, i2, i3);
    }
  }

  const indexArray = new Uint32Array(indices);
  const posBuffer = Buffer.from(positions.buffer);
  const uvBuffer = Buffer.from(uvs.buffer);
  const idxBuffer = Buffer.from(indexArray.buffer);

  const totalBuffer = Buffer.concat([posBuffer, uvBuffer, idxBuffer]);
  const base64Buffer = totalBuffer.toString('base64');

  const gltf = {
    asset: { version: '2.0', generator: 'godot-map-tools' },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{ mesh: 0, name: 'Terrain' }],
    meshes: [
      {
        name: 'TerrainMesh',
        primitives: [
          {
            attributes: { POSITION: 0, TEXCOORD_0: 1 },
            indices: 2,
            mode: 4,
          },
        ],
      },
    ],
    buffers: [{ byteLength: totalBuffer.length, uri: `data:application/octet-stream;base64,${base64Buffer}` }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBuffer.length, target: 34962 },
      { buffer: 0, byteOffset: posBuffer.length, byteLength: uvBuffer.length, target: 34962 },
      { buffer: 0, byteOffset: posBuffer.length + uvBuffer.length, byteLength: idxBuffer.length, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126, // FLOAT
        count: numVertices,
        type: 'VEC3',
        max: [width / 2, heightScale, height / 2],
        min: [-width / 2, 0, -height / 2],
      },
      {
        bufferView: 1,
        componentType: 5126, // FLOAT
        count: numVertices,
        type: 'VEC2',
        max: [1.0, 1.0],
        min: [0.0, 0.0],
      },
      {
        bufferView: 2,
        componentType: 5125, // UNSIGNED_INT
        count: indices.length,
        type: 'SCALAR',
        max: [numVertices - 1],
        min: [0],
      },
    ],
  };

  await fs.writeFile(outputPath, JSON.stringify(gltf, null, 2), 'utf-8');
}