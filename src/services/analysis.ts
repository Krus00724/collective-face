/**
 * Facial analysis behind one interface, so the simulation can be swapped for real landmark
 * detection without touching the interface. See ARCHITECTURE.md for the production pipeline.
 */
export interface Analysis {
  /** Seeds the secret mutation. */
  seed: number;
  /** Overall strength of the mutation, around 1. */
  strength: number;
}

export interface FaceAnalyser {
  analyse(file: File): Promise<Analysis>;
}

export class RefusedPhoto extends Error {}

const MAX_BYTES = 12 * 1024 * 1024;

/**
 * SIMULATION. No face is detected. The photograph is reduced to a coarse brightness pattern,
 * mixed with randomness, and that number selects the mutation. Nothing leaves the browser and
 * the pixels are dropped as soon as the number exists.
 */
export class SimulatedAnalyser implements FaceAnalyser {
  async analyse(file: File): Promise<Analysis> {
    if (!file.type.startsWith('image/')) throw new RefusedPhoto('That file is not an image. Choose a JPEG or PNG portrait.');
    if (file.size > MAX_BYTES) throw new RefusedPhoto('That file is larger than 12 MB. Choose a smaller photograph.');
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new RefusedPhoto('This image could not be read. Try a JPEG or PNG.');
    }
    if (Math.min(bitmap.width, bitmap.height) < 240) {
      bitmap.close();
      throw new RefusedPhoto('This photograph is too small. Use one at least 240 pixels on its short side.');
    }
    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, size, size);
    bitmap.close();
    const { data } = ctx.getImageData(0, 0, size, size);
    let hash = 0x811c9dc5;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < data.length; i += 4) {
      const y = (data[i] * 54 + data[i + 1] * 183 + data[i + 2] * 19) >> 8;
      hash = Math.imul(hash ^ (y >> 3), 16777619);
      sum += y;
      sq += y * y;
    }
    ctx.clearRect(0, 0, size, size);
    const n = data.length / 4;
    const spread = Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2));
    const noise = crypto.getRandomValues(new Uint32Array(1))[0];
    return { seed: ((hash ^ noise) >>> 0) % 2 ** 31, strength: 0.85 + Math.min(0.35, spread / 180) };
  }
}

export const analyser: FaceAnalyser = new SimulatedAnalyser();
